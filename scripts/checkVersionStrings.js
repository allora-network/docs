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

// Phrases that mark a version reference as historical rather than current.
// Matched immediately before the version, allowing markdown emphasis/backticks
// in between (e.g. "Starting in **v0.17.0**").
//
// Every entry is a complete time-anchoring construction. Bare "in" and "from"
// used to be on this list and are not any more: they exempted any sentence that
// happened to have one of them before the number, so "install the package in
// v1.0.6" — a current claim, and exactly the kind that goes stale on the next
// bump — was skipped silently. The whole gate turned off on a preposition.
const HISTORICAL_PREFIX =
  /(?:^|[\s(])(?:since|starting\s+in|starting\s+with|introduced\s+in|added\s+in|new\s+in|as\s+of|before|prior\s+to|until|up\s+to|such\s+as\s+the)[\s]*[*`_]{0,2}$/i;

// "In v0.17.0 this query was renamed" — a fronted time adverbial, which is
// historical, unlike the same preposition mid-sentence. Recognised only at the
// start of a line or a sentence (blockquote and list markers allowed), which is
// what separates it from "install the package in v1.0.6".
const HISTORICAL_SENTENCE_START =
  /(?:^|[.!?]\s+)\s*(?:>\s*)?(?:[-*+]\s+|\d+\.\s+)?(?:in|from)\s+[*`_]{0,2}$/i;

const HEADING_PREFIX = /^\s{0,3}#{1,6}\s+[*`_]{0,2}$/;

function isHistorical(before) {
  return HISTORICAL_PREFIX.test(before) || HISTORICAL_SENTENCE_START.test(before);
}

// The escape hatch is documented as `version-literal-ok: <reason>` and the
// reason is the whole point of it — a bare marker suppresses the gate while
// leaving no record of why, which is indistinguishable from a mistake. So the
// marker only counts when a word follows it. "A word" rather than "any
// non-whitespace" because the marker is always written inside a comment, and
// every comment syntax the repo uses closes with punctuation: `<!--
// version-literal-ok: -->` and `{/* version-literal-ok: */}` are bare markers
// whose terminator would otherwise pass for a reason.
const ESCAPE_HATCH = /version-literal-ok:\s*\w/;

// The SemVer 2.0.0 grammar, from the definition scripts/bumpVersions.js reads
// too — the bump job writes this file, so the two must agree on what a version
// is or the nightly opens a pull request that fails this very check.
const { isValid: isVersion } = require('./lib/semver');

// The one key in versions.json that is not a version id.
const SUPERSEDED_KEY = 'superseded';

const bareVersion = value => String(value).replace(/^v/, '');

// Valid JSON is not the same thing as a manifest. `null`, `[…]`, `"text"` and
// `5` all parse, and each then fails somewhere further in with a message about
// the wrong thing — `null` by crashing on a property read, an array by
// spreading its indices into what look like version keys. Checked once, here,
// so a malformed file is reported as a malformed file.
function requireObject(parsed, file) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(
      `Version check failed: ${path.relative(ROOT, file)} is valid JSON but not an object ` +
        `(got ${Array.isArray(parsed) ? 'an array' : JSON.stringify(parsed)}).`
    );
    process.exit(1);
  }
  return parsed;
}

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

  const { [SUPERSEDED_KEY]: superseded, ...current } = requireObject(parsed, VERSIONS_FILE);
  const entries = Object.entries(current);
  if (entries.length === 0) {
    console.error(`Version check failed: ${path.relative(ROOT, VERSIONS_FILE)} defines no versions.`);
    process.exit(1);
  }

  entries.forEach(([key, value]) => {
    if (typeof value !== 'string' || !isVersion(value)) {
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
      if (typeof value !== 'string' || !isVersion(value)) {
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

  const root = requireObject(parsed, NETWORKS_FILE);
  if (!root.networks || typeof root.networks !== 'object' || Array.isArray(root.networks)) {
    console.error(`Version check failed: ${relative} has no "networks" object.`);
    process.exit(1);
  }

  return root.networks;
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
    // The stale-namespace matcher derives its floor and its host map from
    // `emissions_namespace`. A missing or malformed value would not make it
    // fail — it would make it match nothing, which is the gate silently off at
    // exactly the moment the manifest is broken. So the shape is enforced
    // here, where a violation is a loud manifest problem, before any matcher
    // is trusted. scripts/generateTopics.js already refuses the same shape at
    // its point of use; the two must agree on what a namespace is.
    if (!NAMESPACE_SHAPE.test(String(network.emissions_namespace || ''))) {
      problems.push(
        `networks.json network "${name}" records emissions_namespace ` +
          `${JSON.stringify(network.emissions_namespace)}, which is not of the form "emissions/v<N>". ` +
          `The stale-namespace gate derives its rules from this field and cannot run without it.`
      );
    }
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
    `Version check failed: ${problems.length === 1 ? 'a network record' : 'network records'} in ` +
      `public/api/versions.json / public/api/networks.json ${problems.length === 1 ? 'is' : 'are'} ` +
      `inconsistent or malformed.`
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

// ---------------------------------------------------------------------------
// Emissions namespaces the networks have moved past
//
// `emissions_namespace` is the second fact networks.json owns that the docs
// state as current, and until this check it was the one nobody guarded. The
// release tag has `<Version of="chain-mainnet"/>` behind it and the check
// above; the namespace had nothing, so pages hand-typed it. When mainnet
// upgraded to v0.17.0 and its namespace moved v9 -> v10, `emissions/v9`
// survived in four pages and in two runnable curl examples that had by then
// started returning `501 Not Implemented`, and every gate in the repo passed.
//
// The banned set is derived, not declared. A namespace below the lowest one any
// network currently serves is stale by construction, so there is no list to
// maintain and nothing to forget on the next upgrade: the moment a manifest
// namespace moves, every hand-typed copy of the old one fails this check. That
// is deliberately the same insight the `superseded` inventory encodes for
// versions.json — knowing only today's value would let a literal through at
// exactly the moment it went stale.
//
// Namespaces at or above the floor are left alone. `emissions/v10` is correct
// on both networks today, and failing the ~15 legitimate mentions of it would
// buy nothing but churn and a wall of escape hatches.
const NAMESPACE_SHAPE = /^emissions\/v(\d+)$/;

function currentNamespaceFloor(networks) {
  const versions = Object.values(networks)
    .map(network => NAMESPACE_SHAPE.exec(String(network.emissions_namespace || '')))
    .filter(Boolean)
    .map(match => Number(match[1]));

  return versions.length > 0 ? Math.min(...versions) : null;
}

// The namespace shape also names a directory in the chain's own source tree:
// `.../x/emissions/proto/emissions/v1/reputer.proto`, reached through a GitHub
// permalink pinned to a commit, is a protobuf package path and not a REST
// namespace. Rewriting it would break a deliberate link to a historical commit.
// So a match inside a URL counts only when the URL is an Allora endpoint; a
// match with no URL around it is prose, and prose is always judged.
const TOKEN_DELIMITER = /[\s()<>`"']/;

function enclosingToken(line, index) {
  let start = index;
  while (start > 0 && !TOKEN_DELIMITER.test(line[start - 1])) start--;
  let end = index;
  while (end < line.length && !TOKEN_DELIMITER.test(line[end])) end++;
  return line.slice(start, end);
}

// The host of the URL a match sits inside, lowercased, or null when the match
// is not in a URL at all.
function urlHostAt(line, index) {
  const url = /^https?:\/\/([^/]+)/i.exec(enclosingToken(line, index));
  return url ? url[1].toLowerCase() : null;
}

function insideForeignUrl(line, index) {
  const host = urlHostAt(line, index);
  if (host === null) return false;
  return !/(^|\.)allora\.network$/i.test(host);
}

// Bounded like the version matcher is: a trailing digit would make `emissions/v1`
// match inside `emissions/v10`, which would condemn the current namespace.
function buildStaleNamespaceMatchers(networks) {
  const floor = currentNamespaceFloor(networks);
  if (floor === null) return [];

  // Which network an LCD host belongs to, so a namespace inside an endpoint URL
  // can be judged against that network rather than against the floor. This is
  // what closes the window the floor rule leaves open: while testnet is a
  // release ahead, every namespace testnet has moved past is still current on
  // mainnet, so the floor cannot condemn it — but a URL that says
  // `allora-api.testnet.allora.network` has named the network it is talking
  // about, and can be held to that network's namespace exactly.
  const byHost = new Map();
  for (const [name, network] of Object.entries(networks)) {
    if (typeof network.lcd !== 'string') continue;
    if (!NAMESPACE_SHAPE.test(String(network.emissions_namespace || ''))) continue;
    try {
      byHost.set(new URL(network.lcd).hostname.toLowerCase(), {
        network: name,
        namespace: network.emissions_namespace,
      });
    } catch {
      /* a manifest entry that does not parse names no host */
    }
  }

  return [
    {
      key: 'emissions_namespace',
      kind: 'stale-namespace',
      current: `emissions/v${floor}`,
      // Bounded so `emissions/v1` cannot match inside `emissions/v10`.
      pattern: /emissions\/v\d+(?!\d)/g,
      // A URL is foreign only if its host is neither a manifest endpoint nor
      // under allora.network. The manifest test runs first: if an LCD ever
      // moves to a host outside allora.network, its URLs must keep being
      // judged against that network rather than skipped as foreign.
      skip: (line, index) => !byHost.has(urlHostAt(line, index)) && insideForeignUrl(line, index),
      judge: (line, index, literal) => {
        const host = urlHostAt(line, index);
        const named = host ? byHost.get(host) : null;

        // The line named a network. Judge it against that network's namespace,
        // whichever direction it is wrong in — a URL one release behind and a
        // URL one release ahead are both endpoints that will not answer.
        if (named) {
          if (literal === named.namespace) return null;
          return { current: named.namespace, scope: named.network };
        }

        // No network named: prose. Only a namespace every network has moved
        // past is certainly stale; one that is still current somewhere may be
        // describing that network correctly.
        const version = Number(NAMESPACE_SHAPE.exec(literal)[1]);
        return version < floor ? { current: `emissions/v${floor}`, scope: null } : null;
      },
    },
  ];
}

// One matcher for one version value: the value with an optional leading "v",
// bounded only by what would make it part of a *longer version* — a digit or a
// dot before it, a digit or a dot-digit after it. So "1.0.6" matches in
// "allora_sdk 1.0.6." but not in "11.0.61", "1.0.60" or "1.0.6.1".
//
// The bounds used to be `\w`, which is the shape a version almost never appears
// in on its own. Every packaging convention this project documents glues a
// version to a word with punctuation `\w` covers or excludes wrongly, so the
// gate was blind to the exact strings it exists to catch:
//
//   allorad_0.17.0_linux_amd64        the release asset — the worked example in
//                                     components/Version.tsx's own docstring
//   alloranetwork/allorad:v0.17.0-amd64   a container tag
//   allora_sdk-1.0.6-py3-none-any.whl     a wheel
//
// A consequence, accepted deliberately: a genuine prerelease mention
// ("v0.17.0-rc.1") now matches its release prefix and needs the documented
// `version-literal-ok: <reason>` escape hatch. A loud false positive with an
// audit trail beats a silent miss on the forms the docs actually use.
//
// `kind` says whether the value is a key's current one or one it has moved
// past, which is all that separates the two reports at the end of a run.
function matcherFor(key, value, kind, current) {
  const bare = bareVersion(value);
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    key,
    value,
    bare,
    kind,
    current,
    pattern: new RegExp(`(?<![\\d.])v?${escaped}(?!\\d|\\.\\d)`, 'g'),
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
        if (isHistorical(before) || HEADING_PREFIX.test(before)) continue;
        if (matcher.skip && matcher.skip(line, match.index)) continue;
        // A matcher that needs the surrounding line to decide — the namespace
        // rule reads the host in the URL a match sits in — answers here.
        // Returning null means "this one is fine", which a pattern alone
        // cannot express.
        const judged = matcher.judge ? matcher.judge(line, match.index, match[0]) : {};
        if (!judged) continue;
        violations.push({
          file: relativePath,
          line: index + 1,
          key: matcher.key,
          kind: matcher.kind,
          current: judged.current !== undefined ? judged.current : matcher.current,
          scope: judged.scope,
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
  const staleNamespaces = buildStaleNamespaceMatchers(readNetworks());
  const matchers = [
    ...buildMatchers(entries),
    ...buildSupersededMatchers(entries, superseded),
    ...staleNamespaces,
  ];

  const files = SCAN.reduce(
    (collected, { dir, extensions }) => listFiles(dir, extensions, collected),
    []
  )
    .filter(file => !DERIVED_FILES.has(file) && !HISTORICAL_FILES.has(file))
    .sort();

  const violations = files.flatMap(file => checkFile(file, matchers));
  const hardcoded = violations.filter(violation => violation.kind === 'current');
  const stale = violations.filter(violation => violation.kind === 'superseded');
  const staleNamespace = violations.filter(violation => violation.kind === 'stale-namespace');

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

  if (staleNamespace.length > 0) {
    sections.push(() =>
      reportViolations(
        staleNamespace,
        'stale emissions-namespace string(s)',
        'These name an emissions namespace every network has already upgraded ' +
          'past, so the endpoint they describe now answers 501 Not Implemented. ' +
          'The namespace lives in public/api/networks.json; render it with ' +
          '<NetworkValue network="mainnet" field="emissions_namespace"/> ' +
          '(components/NetworkValue.tsx), or networkValueOf(...) inside a ' +
          'template literal, so it follows the next upgrade on its own.',
        ({ literal, current, scope }) =>
          scope
            ? `"${literal}" is in a ${scope} endpoint URL, but ${scope} serves ${current}`
            : `"${literal}" is below the namespace every network now serves (${current})`
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
      (staleNamespaces.length > 0
        ? `, nor an emissions namespace any network has moved past (floor ` +
          `${staleNamespaces[0].current}, endpoint URLs judged per network)`
        : '') +
      `; versions.json and networks.json agree on ${compared} deployed network version(s).`
  );
}

main();
