const fs = require('fs');
const path = require('path');

// Guards the "one place for current versions" rule: every version string the
// docs present as *current* must come from public/api/versions.json, via the
// <Version of="..."/> component (components/Version.tsx) or the constants in
// components/versions.ts that derive from it.
//
// This checker does three things. First, it loads versions.json and fails if
// any of its values — with or without a leading "v" — is typed by hand in
// pages/, components/ or snippets/. Second, it fails on a hand-typed copy of a
// value those keys have already moved past, listed under the file's
// `superseded` key: knowing only today's values, the checker would let every
// stale "pip install allora_sdk==<the old one>" through the moment a bump made
// it stale, which is the one moment it matters. scripts/bumpVersions.js appends
// to that inventory whenever it writes a new value, so it maintains itself.
// Third, it fails if versions.json and public/api/networks.json disagree about
// the release a network is running (see checkManifestsAgree below). Run via
// `yarn checkversions`; chained into `yarn build` after the frontmatter check,
// and run in CI (.github/workflows/check-versions.yml). Exits non-zero on any
// violation.
//
// Not every mention of a version number is a claim about the current version.
// The exemptions below are deliberate and narrow:
//
//   1. Files that derive from versions.json by design (DERIVED_FILES).
//   2. Files that are historical records by definition (HISTORICAL_FILES) — a
//      changelog entry names the release it describes and must never move when
//      the network upgrades.
//   3. The `verified_against` frontmatter key — and only that key. It is a
//      point-in-time attestation of what the content was checked against; it
//      deliberately goes stale and is refreshed by a human at review time, not
//      by a version bump. The rest of the frontmatter is scanned: `title` and
//      `description` are displayed metadata, so a current-version literal there
//      is the same stale claim it would be in the body.
//   4. Historical constructions in prose ("since v0.17.0", "introduced in
//      v0.17.0", "before v0.17.0"). These state *when* a behaviour changed and
//      stay true forever; rewriting them to track the current release would
//      make them wrong. See HISTORICAL_PREFIX.
//   5. Any line carrying the escape hatch `version-literal-ok:` followed by a
//      reason, for the cases the rules above do not cover.
//
// Everything else — "the currently deployed version is X", a table cell, an
// install command, a pip pin — is a current-version claim and must use the
// component or the constants.

const ROOT = path.resolve(__dirname, '..');
const VERSIONS_FILE = path.join(ROOT, 'public', 'api', 'versions.json');
const NETWORKS_FILE = path.join(ROOT, 'public', 'api', 'networks.json');

// Trees to scan, and the extensions worth scanning in each.
const SCAN = [
  { dir: 'pages', extensions: ['.mdx', '.md'] },
  { dir: 'components', extensions: ['.js', '.jsx', '.ts', '.tsx'] },
  { dir: 'snippets', extensions: null }, // every runnable snippet, whatever the language
];

// Files that legitimately reference the JSON's values because they read them
// from the JSON (or describe the mechanism). Paths are repo-relative, POSIX.
const DERIVED_FILES = new Set([
  'components/Version.tsx',
  'components/versions.ts',
]);

// Files whose version mentions are historical by nature. A changelog is the
// canonical example: its headings *are* release numbers.
const HISTORICAL_FILES = new Set([
  'pages/reference/release-notes.mdx',
]);

// Words that mark a version reference as historical rather than current. Matched
// immediately before the version, allowing markdown emphasis/backticks and a
// heading marker in between (e.g. "Starting in **v0.17.0**", "## v0.17.0").
const HISTORICAL_PREFIX =
  /(?:^|[\s(])(?:since|starting\s+in|starting\s+with|introduced\s+in|added\s+in|new\s+in|as\s+of|before|prior\s+to|until|up\s+to|in|from|such\s+as\s+the)[\s]*[*`_]{0,2}$/i;

const HEADING_PREFIX = /^\s{0,3}#{1,6}\s+[*`_]{0,2}$/;

// The escape hatch is documented as `version-literal-ok: <reason>` and the
// reason is the whole point of it — a bare marker suppresses the gate while
// leaving no record of why, which is indistinguishable from a mistake. So the
// marker only counts when a word follows it. "A word" rather than "any
// non-whitespace" because the marker is always written inside a comment, and
// every comment syntax the repo uses closes with punctuation: `<!--
// version-literal-ok: -->` and `{/* version-literal-ok: */}` are bare markers
// whose terminator would otherwise pass for a reason.
const ESCAPE_HATCH = /version-literal-ok:\s*\w/;

// Anchored: the whole value must be a semantic version, optionally "v"-prefixed
// and optionally carrying a prerelease and/or build suffix ("1.0.6-rc.1",
// "v0.17.0+build.5", "1.0.6-rc.1+build.5"). Unanchored, "v0.17.0oops" passed
// here and then shipped through every generated view that reads this file.
const VERSION_VALUE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// The one key in versions.json that is not a version id.
const SUPERSEDED_KEY = 'superseded';

const bareVersion = value => String(value).replace(/^v/, '');

function readVersions() {
  if (!fs.existsSync(VERSIONS_FILE)) {
    console.error(`Version check failed: ${path.relative(ROOT, VERSIONS_FILE)} is missing.`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
  } catch (error) {
    console.error(`Version check failed: ${path.relative(ROOT, VERSIONS_FILE)} is not valid JSON.`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }

  const { [SUPERSEDED_KEY]: superseded, ...current } = parsed;
  const entries = Object.entries(current);
  if (entries.length === 0) {
    console.error(`Version check failed: ${path.relative(ROOT, VERSIONS_FILE)} defines no versions.`);
    process.exit(1);
  }

  entries.forEach(([key, value]) => {
    if (typeof value !== 'string' || !VERSION_VALUE.test(value)) {
      console.error(
        `Version check failed: ${path.relative(ROOT, VERSIONS_FILE)} key "${key}" ` +
          `is not a version string (got ${JSON.stringify(value)}).`
      );
      process.exit(1);
    }
  });

  return { entries, superseded: readSuperseded(superseded, entries) };
}

// The superseded inventory: for each version key, the values it has already
// moved past. scripts/bumpVersions.js appends to it whenever it writes a new
// value, so the record builds itself; it starts empty because this repo has
// published exactly one set of values so far, and inventing earlier ones would
// be inventing facts.
//
// Validated as strictly as the current values are — an inventory nobody can
// trust is worse than none, because the whole point is to fail a build on what
// it contains.
function readSuperseded(raw, entries) {
  const relative = path.relative(ROOT, VERSIONS_FILE);
  const fail = message => {
    console.error(`Version check failed: ${relative} "${SUPERSEDED_KEY}" ${message}.`);
    process.exit(1);
  };

  if (raw === undefined) {
    fail(
      `is missing. Add it with one array per version key ` +
        `(${entries.map(([key]) => `"${key}": []`).join(', ')}); it is how a version ` +
        'literal left behind by a bump is caught'
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(`must be an object keyed by version key (got ${JSON.stringify(raw)})`);
  }

  const keys = new Set(entries.map(([key]) => key));
  const currentValues = new Set(entries.map(([, value]) => bareVersion(value)));

  Object.keys(raw).forEach(key => {
    if (!keys.has(key)) fail(`has "${key}", which is not a version key in this file`);
    if (!Array.isArray(raw[key])) fail(`["${key}"] must be an array (got ${JSON.stringify(raw[key])})`);
    const seen = new Set();
    raw[key].forEach(value => {
      if (typeof value !== 'string' || !VERSION_VALUE.test(value)) {
        fail(`["${key}"] contains ${JSON.stringify(value)}, which is not a version string`);
      }
      if (seen.has(value)) fail(`["${key}"] lists ${JSON.stringify(value)} twice`);
      seen.add(value);
    });
  });

  entries.forEach(([key, value]) => {
    if (!Array.isArray(raw[key])) {
      fail(`has no array for version key "${key}"`);
    }
    if (raw[key].some(old => bareVersion(old) === bareVersion(value))) {
      fail(
        `["${key}"] lists ${JSON.stringify(value)}, which is that key's current value — ` +
          'a value cannot be both current and superseded'
      );
    }
  });

  // A value another key is currently on is a live version, whatever this key's
  // history says, so it can never be reported as stale.
  const stale = [];
  Object.entries(raw).forEach(([key, values]) => {
    values.forEach(value => {
      if (currentValues.has(bareVersion(value))) return;
      stale.push({ key, value });
    });
  });

  return stale;
}

function readNetworks() {
  const relative = path.relative(ROOT, NETWORKS_FILE);

  if (!fs.existsSync(NETWORKS_FILE)) {
    console.error(`Version check failed: ${relative} is missing.`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(NETWORKS_FILE, 'utf8'));
  } catch (error) {
    console.error(`Version check failed: ${relative} is not valid JSON.`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }

  if (!parsed.networks || typeof parsed.networks !== 'object' || Array.isArray(parsed.networks)) {
    console.error(`Version check failed: ${relative} has no "networks" object.`);
    process.exit(1);
  }

  return parsed.networks;
}

// versions.json's `chain_<network>` keys and networks.json's per-network
// `deployed_version` are two hand-maintained copies of one fact: the
// allora-chain release that network is running. Nothing keeps them in step on
// its own — the version-bump job never writes the chain keys (a release tag
// says nothing about what a network actually deployed) and the network-drift
// job only ever rewrites `abci_version`. Meanwhile
// pages/reference/networks.mdx takes its prose from the first file and its
// table from the second, so a divergence publishes a page that contradicts
// itself. Hence this check: the two files must move together, in one commit.
const CHAIN_KEY = /^chain_(.+)$/;

function checkManifestsAgree(entries) {
  const networks = readNetworks();
  const problems = [];
  let compared = 0;

  entries.forEach(([key, value]) => {
    const match = CHAIN_KEY.exec(key);
    if (!match) return;
    const name = match[1];
    const network = networks[name];

    if (!network) {
      problems.push(
        `versions.json has "${key}", but networks.json defines no network "${name}" ` +
          `(it defines: ${Object.keys(networks).join(', ') || 'none'}).`
      );
      return;
    }

    compared++;
    if (network.deployed_version !== value) {
      problems.push(
        `versions.json "${key}" is ${JSON.stringify(value)}, but networks.json ` +
          `networks.${name}.deployed_version is ${JSON.stringify(network.deployed_version)}.`
      );
    }
  });

  const keys = new Set(entries.map(([key]) => key));
  Object.entries(networks).forEach(([name, network]) => {
    if (network.deployed_version === undefined) return;
    if (keys.has(`chain_${name}`)) return;
    problems.push(
      `networks.json network "${name}" records deployed_version ` +
        `${JSON.stringify(network.deployed_version)}, but versions.json has no "chain_${name}" key.`
    );
  });

  return { problems, compared };
}

function reportManifestProblems(problems) {
  console.error(
    `Version check failed: public/api/versions.json and public/api/networks.json ` +
      `disagree about ${problems.length === 1 ? 'a deployed network version' : 'deployed network versions'}.`
  );
  console.error(
    'Both files record the allora-chain release each network is running, and ' +
      'nothing updates them for you: the version-bump job never writes the ' +
      'chain_* keys, and the network-drift job only rewrites abci_version. ' +
      'pages/reference/networks.mdx renders its prose from versions.json and its ' +
      'table from networks.json, so the two must be updated together.\n'
  );
  problems.forEach(problem => console.error(`  ${problem}`));
  console.error(
    '\nUpdate both files in the same commit: set versions.json "chain_<network>" ' +
      'and networks.json networks.<network>.deployed_version to the same value.'
  );
}

// One matcher for one version value: matches it with an optional leading "v",
// not preceded or followed by a character that would make it part of a longer
// version (so "1.0.6" matches in "allora_sdk 1.0.6." but not in "11.0.61" or
// "1.0.60"). A trailing "." is only disqualifying when a digit follows it, so
// a version at the end of a sentence still matches. `kind` says whether the
// value is a key's current one or one it has moved past, which is all that
// separates the two reports at the end of a run.
function matcherFor(key, value, kind, current) {
  const bare = bareVersion(value);
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    key,
    value,
    bare,
    kind,
    current,
    pattern: new RegExp(`(?<![\\w.])v?${escaped}(?!\\w|\\.\\d)`, 'g'),
  };
}

function buildMatchers(entries) {
  return entries.map(([key, value]) => matcherFor(key, value, 'current'));
}

// The same matcher, built for values a key has already moved past. Without
// these the checker can only see the version the file says *today*: bump
// `allora_sdk` from 1.0.6 to 1.0.7 and every hand-typed "pip install
// allora_sdk==1.0.6" left in the docs starts passing, because 1.0.6 is no
// longer a value it knows. The inventory is what remembers.
//
// Every exemption that applies to a current literal applies here too — a
// changelog, "since v0.16.0", a fenced example, the escape hatch — because an
// old version named as history is exactly as legitimate as it was before.
function buildSupersededMatchers(entries, superseded) {
  const currentOf = new Map(entries);
  return superseded.map(({ key, value }) => matcherFor(key, value, 'superseded', currentOf.get(key)));
}

function listFiles(dir, extensions, collected) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return collected;

  fs.readdirSync(absolute, { withFileTypes: true }).forEach(entry => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(relative, extensions, collected);
    } else if (!extensions || extensions.includes(path.extname(entry.name))) {
      collected.push(relative);
    }
  });

  return collected;
}

// Index of the last line of the leading `---` frontmatter block, or -1.
function frontmatterEnd(lines) {
  if (lines[0] !== '---') return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return i;
  }
  return -1;
}

// Line indices inside the frontmatter block that the scan skips. Only
// `verified_against` is exempt: it is a point-in-time attestation of what the
// content was checked against, so it deliberately goes stale. `title` and
// `description` are displayed metadata, and a current-version literal in either
// is the same stale claim it would be in the body — the fix there is to reword
// the value, since frontmatter cannot render the component.
function exemptFrontmatterLines(lines, lastFrontmatterLine) {
  const exempt = new Set();
  if (lastFrontmatterLine < 0) return exempt;

  let inExemptKey = false;
  for (let index = 1; index < lastFrontmatterLine; index++) {
    const key = lines[index].match(/^([A-Za-z0-9_-]+)\s*:/);
    if (key) inExemptKey = key[1] === 'verified_against';
    // An indented line continues the value of the key above it.
    else if (!/^\s/.test(lines[index])) inExemptKey = false;
    if (inExemptKey) exempt.add(index);
  }

  return exempt;
}

function checkFile(relativePath, matchers) {
  const lines = fs.readFileSync(path.join(ROOT, relativePath), 'utf8').split(/\r?\n/);
  const lastFrontmatterLine = /\.mdx?$/.test(relativePath) ? frontmatterEnd(lines) : -1;
  const exemptLines = exemptFrontmatterLines(lines, lastFrontmatterLine);
  const violations = [];

  lines.forEach((line, index) => {
    if (exemptLines.has(index)) return;
    if (ESCAPE_HATCH.test(line)) return;

    matchers.forEach(matcher => {
      matcher.pattern.lastIndex = 0;
      let match;
      while ((match = matcher.pattern.exec(line)) !== null) {
        const before = line.slice(0, match.index);
        if (HISTORICAL_PREFIX.test(before) || HEADING_PREFIX.test(before)) continue;
        violations.push({
          file: relativePath,
          line: index + 1,
          key: matcher.key,
          kind: matcher.kind,
          current: matcher.current,
          literal: match[0],
          text: line.trim(),
        });
      }
    });
  });

  return violations;
}

const ESCAPE_HATCH_HINT =
  '\nIf the mention is historical ("introduced in v0.17.0") and the wording ' +
  'does not already make that clear, add a `version-literal-ok: <reason>` ' +
  'comment on the line.';

function reportViolations(violations, headline, explanation, describe) {
  console.error(
    `Version check failed: ${violations.length} ${headline} ` +
      `found in ${new Set(violations.map(violation => violation.file)).size} file(s).`
  );
  console.error(`${explanation}\n`);
  violations.forEach(violation => {
    console.error(`  ${violation.file}:${violation.line} — ${describe(violation)}`);
    const { text } = violation;
    console.error(`    ${text.length > 120 ? `${text.slice(0, 117)}...` : text}`);
  });
  console.error(ESCAPE_HATCH_HINT);
}

function main() {
  const { entries, superseded } = readVersions();
  const matchers = [...buildMatchers(entries), ...buildSupersededMatchers(entries, superseded)];

  const files = SCAN.reduce(
    (collected, { dir, extensions }) => listFiles(dir, extensions, collected),
    []
  )
    .filter(file => !DERIVED_FILES.has(file) && !HISTORICAL_FILES.has(file))
    .sort();

  const violations = files.flatMap(file => checkFile(file, matchers));
  const hardcoded = violations.filter(violation => violation.kind === 'current');
  const stale = violations.filter(violation => violation.kind === 'superseded');

  // Every class of problem is reported in one run, so a maintainer fixing the
  // manifests is not sent back for a hand-typed literal on the next build.
  const { problems, compared } = checkManifestsAgree(entries);
  const sections = [];

  if (problems.length > 0) {
    sections.push(() => reportManifestProblems(problems));
  }

  if (hardcoded.length > 0) {
    sections.push(() =>
      reportViolations(
        hardcoded,
        'hand-typed current-version string(s)',
        'Current versions live only in public/api/versions.json. Use ' +
          '<Version of="chain-testnet"/> (components/Version.tsx) in prose, or the ' +
          'constants in components/versions.ts inside template literals.',
        ({ literal, key }) => `"${literal}" matches versions.json key "${key}"`
      )
    );
  }

  if (stale.length > 0) {
    sections.push(() =>
      reportViolations(
        stale,
        'stale version string(s)',
        'These name a version the docs have already moved past, in a place that ' +
          'reads as a current claim. Replace each with <Version of="…"/> or the ' +
          'components/versions.ts constant, which follow the bump on their own.',
        ({ literal, key, current }) =>
          `"${literal}" is a superseded value of versions.json key "${key}" ` +
          `(now ${current})`
      )
    );
  }

  sections.forEach((report, index) => {
    if (index > 0) console.error('');
    report();
    process.exitCode = 1;
  });

  if (process.exitCode === 1) return;

  const supersededCount = superseded.length;
  console.log(
    `Version check OK: ${files.length} files carry no hand-typed copy of ` +
      `${entries.map(([key]) => key).join(', ')}` +
      (supersededCount > 0 ? `, nor any of the ${supersededCount} superseded value(s)` : '') +
      `; versions.json and networks.json agree on ${compared} deployed network version(s).`
  );
}

main();
