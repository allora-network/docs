const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Compares public/api/versions.json against upstream release feeds and reports
// what has moved. Plain Node 20 (global fetch), no dependencies.
//
//   node scripts/bumpVersions.js            dry run — print findings, exit 0
//   node scripts/bumpVersions.js --write    apply the applicable findings
//
// The governing rule: **the bot only writes a version a user could install
// today.** Anything else is reported for a human to decide, never pre-applied,
// because merging a pull request is a publishing action and the docs would then
// state something upstream has not actually made true. Findings therefore fall
// into three categories:
//
//   applied     — upstream published this exact version (a GitHub release or
//                 tag, or a PyPI release). Written to versions.json and shipped
//                 as the pull request's diff.
//   unreleased  — read from packaging metadata on a moving branch. That field
//                 is routinely set to the *next*, unpublished version before
//                 anything ships, so taking it would advertise a version nobody
//                 can install. Reported only.
//   deployment  — describes the release a network is *running*
//                 (`chain_testnet`, `chain_mainnet`). A new chain tag says
//                 nothing about whether either network upgraded, and the two
//                 networks are routinely on different releases, so resolving
//                 both from "latest allora-chain release" would flatten exactly
//                 the distinction pages/reference/networks.mdx exists to draw.
//                 Reported only; confirming a deployment is a human's job.
//
// Under GitHub Actions (.github/workflows/version-bump.yml) `--write` also
// appends outputs to $GITHUB_OUTPUT: `changed` + `marker` + `body` drive the
// pull request, and `review_changed` + `review_count` + `review_marker` +
// `review_body` drive the tracking issue that carries the reported-only
// findings. Each marker is a fingerprint of its finding set, so a proposal a
// human has already declined is not resurrected until its content actually
// changes; `review_count` reaching 0 is what lets the workflow close a tracking
// issue whose findings someone resolved without closing it.
//
// Exit codes: 0 = ran successfully (with or without findings), 1 = a source
// could not be reached or returned something unusable. A bump job that cannot
// reach upstream must fail loudly rather than quietly report "up to date".

const ROOT = path.resolve(__dirname, '..');
const VERSIONS_FILE = path.join(ROOT, 'public', 'api', 'versions.json');

const CHAIN_REPO = 'allora-network/allora-chain';
const BUILDER_KIT_REPO = 'allora-network/allora-forge-builder-kit';

const APPLIED = 'applied';
const UNRELEASED = 'unreleased';
const DEPLOYMENT = 'deployment';

// `deployment: true` marks a key whose correct value is not "whatever upstream
// tagged last" but "what a network is actually running".
const SOURCES = [
  {
    key: 'chain_testnet',
    label: 'allora-chain release vs. the testnet deployment',
    deployment: true,
    resolve: () => latestGitHubVersion(CHAIN_REPO),
  },
  {
    key: 'chain_mainnet',
    label: 'allora-chain release vs. the mainnet deployment',
    deployment: true,
    resolve: () => latestGitHubVersion(CHAIN_REPO),
  },
  {
    key: 'allora_sdk',
    label: 'allora_sdk on PyPI',
    resolve: latestPyPiVersion,
  },
  {
    key: 'builder_kit',
    label: 'allora-forge-builder-kit',
    resolve: () => latestGitHubVersion(BUILDER_KIT_REPO, { pyprojectFallback: true }),
  },
];

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'allora-docs-version-bump',
  };
  // Present in Actions; keeps the job off the 60/hour anonymous rate limit.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

// "Fail loudly rather than quietly report up to date" only holds if the job
// actually reaches a conclusion. A stalled endpoint has no timeout of its own,
// so without this the run hangs until the workflow's own budget kills it —
// which is a cancelled job, not a failed one, and the schedule loses the night.
// Bounded per request, and the error names the URL so the failure says which
// feed went quiet.
const REQUEST_TIMEOUT_MS = 30000;

function isTimeout(error) {
  return Boolean(error) && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function request(url, headers) {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (isTimeout(error)) {
      throw new Error(`GET ${url} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`GET ${url} failed: ${error.message}`);
  }
}

// The same deadline covers the body: a server that sends headers and then
// stalls mid-response hangs the run just as effectively as one that never
// answers, and the abort signal is still attached to the stream.
async function readBody(url, read) {
  try {
    return await read();
  } catch (error) {
    if (isTimeout(error)) {
      throw new Error(
        `GET ${url} timed out after ${REQUEST_TIMEOUT_MS / 1000}s while reading the response.`
      );
    }
    throw new Error(`GET ${url} → unreadable response: ${error.message}`);
  }
}

async function getJson(url, headers) {
  const response = await request(url, headers);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status} ${response.statusText}`);
  }
  return readBody(url, () => response.json());
}

async function getText(url) {
  const response = await request(url, { 'User-Agent': 'allora-docs-version-bump' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status} ${response.statusText}`);
  }
  return readBody(url, () => response.text());
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseSemver(value) {
  const match = SEMVER.exec(String(value).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** > 0 when a is newer than b, 0 when equal, < 0 when older. null if either is unparsable. */
function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** Picks the newest stable (non-prerelease, parsable) version from a list. */
function newestStable(candidates) {
  return candidates
    .filter(candidate => parseSemver(candidate) && !/[-+]/.test(candidate.replace(/^v/, '')))
    .sort((a, b) => compareSemver(b, a))[0];
}

// Both chain keys read the same repo; memoize so one run makes one set of calls.
const githubCache = new Map();

function latestGitHubVersion(repo, options = {}) {
  const cacheKey = `${repo}|${options.pyprojectFallback ? 'pyproject' : 'strict'}`;
  if (!githubCache.has(cacheKey)) {
    githubCache.set(cacheKey, resolveGitHubVersion(repo, options));
  }
  return githubCache.get(cacheKey);
}

async function resolveGitHubVersion(repo, { pyprojectFallback = false } = {}) {
  const headers = githubHeaders();

  const releases = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=100`, headers);
  if (Array.isArray(releases) && releases.length > 0) {
    const version = newestStable(
      releases.filter(release => !release.draft && !release.prerelease).map(release => release.tag_name)
    );
    if (version) return { version, via: 'GitHub releases', published: true };
  }

  const tags = await getJson(`https://api.github.com/repos/${repo}/tags?per_page=100`, headers);
  if (Array.isArray(tags) && tags.length > 0) {
    const version = newestStable(tags.map(tag => tag.name));
    if (version) return { version, via: 'git tags', published: true };
  }

  if (!pyprojectFallback) {
    throw new Error(`${repo} exposes no usable releases or tags.`);
  }

  // The builder kit publishes neither releases nor tags; its packaging metadata
  // is the only machine-readable version it has. `published: false` keeps the
  // value out of the diff — branch metadata routinely names an unreleased
  // version. Kept last so it is superseded the day the repo starts tagging.
  const repoMeta = await getJson(`https://api.github.com/repos/${repo}`, headers);
  const branch = (repoMeta && repoMeta.default_branch) || 'main';
  const pyproject = await getText(`https://raw.githubusercontent.com/${repo}/${branch}/pyproject.toml`);
  const match = pyproject && pyproject.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  if (!match || !parseSemver(match[1])) {
    throw new Error(`${repo} exposes no releases, no tags, and no readable pyproject.toml version.`);
  }
  return { version: match[1], via: `pyproject.toml on ${branch}`, published: false };
}

async function latestPyPiVersion() {
  const data = await getJson('https://pypi.org/pypi/allora_sdk/json');
  const version = data && data.info && data.info.version;
  if (!version || !parseSemver(version)) {
    throw new Error(`PyPI returned no usable version for allora_sdk (got ${JSON.stringify(version)}).`);
  }
  return { version, via: 'PyPI', published: true };
}

function categoryOf(source, resolved) {
  if (source.deployment) return DEPLOYMENT;
  return resolved.published ? APPLIED : UNRELEASED;
}

/** Keeps the "v" convention each key already uses, so the file stays consistent. */
function matchPrefix(current, next) {
  const bare = String(next).replace(/^v/, '');
  return String(current).startsWith('v') ? `v${bare}` : bare;
}

/**
 * A stable id for a set of findings. Embedded in the pull request and issue
 * bodies so the workflow can tell "the same proposal a human already declined"
 * from "a genuinely new proposal".
 */
function fingerprint(findings) {
  const canonical = findings
    .map(finding => `${finding.key}:${finding.current}>${finding.next}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function table(findings) {
  return [
    '| Key | Current | Upstream | Source |',
    '| --- | --- | --- | --- |',
    ...findings.map(f => `| \`${f.key}\` | \`${f.current}\` | \`${f.next}\` | ${f.via} |`),
  ];
}

function renderPrBody(applied, candidates, marker) {
  const lines = [marker, ''];

  lines.push('Automated check of upstream releases against `public/api/versions.json`.');
  lines.push('');
  lines.push('### Applied in this pull request');
  lines.push('');
  lines.push('Each of these versions is **published upstream** — a GitHub release or tag,');
  lines.push('or a PyPI release — so it is a version a reader could install today.');
  lines.push('Confirm the surrounding prose still reads correctly, then merge.');
  lines.push('');
  lines.push(...table(applied));
  lines.push('');

  if (candidates.length > 0) {
    lines.push('### Not applied — reported for information');
    lines.push('');
    lines.push('These moved too, but the bot cannot assert them, so they are deliberately');
    lines.push('**absent from the diff**. They are tracked in the version-candidates issue;');
    lines.push('see it for what each one needs.');
    lines.push('');
    lines.push(...table(candidates));
    lines.push('');
  }

  lines.push('Pages render these values through `<Version of="..."/>`');
  lines.push('(`components/Version.tsx`), so merging updates every page at once. Prose that');
  lines.push('describes *when* a feature landed is deliberately left alone.');

  return lines.join('\n');
}

function renderIssueBody(candidates, marker) {
  const deployment = candidates.filter(candidate => candidate.category === DEPLOYMENT);
  const unreleased = candidates.filter(candidate => candidate.category === UNRELEASED);
  const lines = [marker, ''];

  lines.push('Upstream has moved ahead of `public/api/versions.json` for keys the bump job');
  lines.push('**deliberately does not change on its own**. Nothing here is a verified fact —');
  lines.push('each needs a human to confirm it before `public/api/versions.json` is edited.');
  lines.push('');
  lines.push('Editing that one file updates every page that renders the value.');
  lines.push('');

  if (deployment.length > 0) {
    lines.push('### Deployed network versions — confirm the network actually upgraded');
    lines.push('');
    lines.push('`chain_testnet` and `chain_mainnet` record the release each network is');
    lines.push('**currently running**. The figure below is only the newest `allora-chain`');
    lines.push('tag: a tag does **not** mean either network upgraded, and the two networks');
    lines.push('are routinely on different releases. Confirm the deployed version per');
    lines.push('network — the upgrade announcement, or querying the network itself — and');
    lines.push('update only the keys that really moved.');
    lines.push('');
    lines.push('`public/api/networks.json` records the same fact per network in');
    lines.push('`deployed_version`, so update it in the same commit — `yarn checkversions`');
    lines.push('fails while the two files disagree.');
    lines.push('');
    lines.push(...table(deployment));
    lines.push('');
  }

  if (unreleased.length > 0) {
    lines.push('### Unreleased — read from a moving branch, not a release');
    lines.push('');
    lines.push('This repo publishes no releases or tags, so the only machine-readable');
    lines.push('version is packaging metadata on its default branch. That field is');
    lines.push('routinely bumped to the *next* version before anything ships, so taking it');
    lines.push('would advertise a version nobody can install yet. Confirm something was');
    lines.push('actually published before updating.');
    lines.push('');
    lines.push(...table(unreleased));
    lines.push('');
  }

  lines.push('This issue is updated in place while these findings hold, and closed');
  lines.push('automatically once none of them are left. Closing it by hand is respected');
  lines.push('too: it is not reopened until the proposed versions themselves change.');

  return lines.join('\n');
}

// Files the value a key is leaving behind under versions.json's `superseded`
// key, so scripts/checkVersionStrings.js keeps failing on it after the bump.
// Without this the bump silently widens what the docs may say: the moment
// 1.0.6 stops being current, every hand-typed 1.0.6 in an install command
// stops being checked, which is exactly when it becomes wrong.
const SUPERSEDED_KEY = 'superseded';

function recordSuperseded(versions, key, previous) {
  if (typeof previous !== 'string' || previous === '') return;

  const inventory = versions[SUPERSEDED_KEY];
  if (inventory === undefined || inventory === null || typeof inventory !== 'object' || Array.isArray(inventory)) {
    // Bail loudly rather than reshape a file a human maintains: a bump that
    // quietly dropped the inventory would take the check down with it.
    throw new Error(
      `public/api/versions.json has no "${SUPERSEDED_KEY}" object. Add one with an ` +
        'array per version key before the bump job can record what it replaces.'
    );
  }
  if (!Array.isArray(inventory[key])) {
    throw new Error(
      `public/api/versions.json "${SUPERSEDED_KEY}" has no array for key "${key}".`
    );
  }
  if (!inventory[key].includes(previous)) inventory[key].push(previous);
}

function appendOutputs(fields) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const chunks = Object.entries(fields).map(([name, value]) => {
    if (!String(value).includes('\n')) return `${name}=${value}\n`;
    const delimiter = `EOF_${crypto.randomBytes(8).toString('hex')}`;
    return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  });
  fs.appendFileSync(outputFile, chunks.join(''));
}

function appendSummary(text) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  fs.appendFileSync(summaryFile, `${text}\n`);
}

async function main() {
  const write = process.argv.includes('--write');
  const versions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
  const findings = [];

  for (const source of SOURCES) {
    const current = versions[source.key];
    if (current === undefined) {
      throw new Error(`public/api/versions.json has no key "${source.key}".`);
    }

    const resolved = await source.resolve();
    const next = matchPrefix(current, resolved.version);
    const comparison = compareSemver(next, current);

    if (comparison === null) {
      throw new Error(`Cannot compare "${current}" with "${next}" for key "${source.key}".`);
    }

    if (comparison > 0) {
      const category = categoryOf(source, resolved);
      findings.push({ key: source.key, current, next, via: resolved.via, category });
      const suffix = category === APPLIED ? '' : `  [${category} — not applied]`;
      console.log(`${source.key}: ${current} → ${next}  (${source.label}, via ${resolved.via})${suffix}`);
    } else if (comparison < 0) {
      console.log(`${source.key}: ${current} is ahead of upstream ${next} (${resolved.via}) — left alone.`);
    } else {
      console.log(`${source.key}: ${current} is current (${source.label}, via ${resolved.via}).`);
    }
  }

  const applied = findings.filter(finding => finding.category === APPLIED);
  const candidates = findings.filter(finding => finding.category !== APPLIED);

  const marker = `<!-- version-bump: ${fingerprint(applied)} -->`;
  const reviewMarker = `<!-- version-candidates: ${fingerprint(candidates)} -->`;

  const body = applied.length > 0 ? renderPrBody(applied, candidates, marker) : '';
  const reviewBody = candidates.length > 0 ? renderIssueBody(candidates, reviewMarker) : '';

  if (applied.length > 0 && write) {
    applied.forEach(finding => {
      recordSuperseded(versions, finding.key, finding.current);
      versions[finding.key] = finding.next;
    });
    fs.writeFileSync(VERSIONS_FILE, `${JSON.stringify(versions, null, 2)}\n`);
    console.log(`\nWrote ${applied.length} published bump(s) to public/api/versions.json.`);
  } else if (applied.length > 0) {
    console.log(`\n${applied.length} published bump(s) ready. Re-run with --write to apply.`);
  } else {
    console.log('\nNo published bumps: public/api/versions.json matches every published source.');
  }

  if (candidates.length > 0) {
    console.log(
      `${candidates.length} finding(s) reported without changing the file ` +
        `(${candidates.map(candidate => `${candidate.key}=${candidate.category}`).join(', ')}).`
    );
  }

  appendOutputs({
    changed: applied.length > 0 ? 'true' : 'false',
    marker,
    body,
    review_changed: candidates.length > 0 ? 'true' : 'false',
    // Stated as a count, not only as the boolean above, so the workflow can act
    // on "there is nothing left to confirm" -- a long-lived tracking issue that
    // nobody closed by hand is stale the moment this reaches 0.
    review_count: String(candidates.length),
    review_marker: reviewMarker,
    review_body: reviewBody,
  });

  appendSummary(
    [
      '## Version check',
      '',
      applied.length > 0
        ? `Applied ${applied.length} published bump(s): ${applied.map(finding => finding.key).join(', ')}.`
        : 'No published bumps.',
      candidates.length > 0
        ? `Reported without changing the file: ${candidates
            .map(candidate => `\`${candidate.key}\` (${candidate.category})`)
            .join(', ')}.`
        : 'No findings needing human confirmation.',
    ].join('\n')
  );

  if (body) console.log(`\n--- pull request body ---\n${body}`);
  if (reviewBody) console.log(`\n--- tracking issue body ---\n${reviewBody}`);
}

main().catch(error => {
  console.error(`Version bump check failed: ${error.message}`);
  process.exit(1);
});
