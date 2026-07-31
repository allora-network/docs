const fs = require('fs');
const path = require('path');

// Compares public/api/versions.json against upstream release feeds and proposes
// bumps. Plain Node 20 (global fetch), no dependencies.
//
//   node scripts/bumpVersions.js            dry run — print proposals, exit 0
//   node scripts/bumpVersions.js --write    apply proposals to versions.json
//
// Under GitHub Actions (.github/workflows/version-bump.yml) `--write` also
// appends `changed` and a markdown `body` to $GITHUB_OUTPUT, which the workflow
// feeds to the pull-request step.
//
// Exit codes: 0 = ran successfully (with or without proposals), 1 = a source
// could not be reached or returned something unusable. A bump job that cannot
// reach upstream must fail loudly rather than quietly report "up to date".

const ROOT = path.resolve(__dirname, '..');
const VERSIONS_FILE = path.join(ROOT, 'public', 'api', 'versions.json');

const CHAIN_REPO = 'allora-network/allora-chain';
const BUILDER_KIT_REPO = 'allora-network/allora-forge-builder-kit';

// `verify: true` marks a key whose correct value is not simply "whatever
// upstream tagged last". The chain keys record the release each network is
// *running*, which lags the newest allora-chain tag by design — a human
// confirms the network actually upgraded before merging the bump.
const SOURCES = [
  {
    key: 'chain_testnet',
    label: 'allora-chain (testnet deployment)',
    verify: true,
    describe: `latest release of ${CHAIN_REPO}`,
    resolve: () => latestGitHubVersion(CHAIN_REPO),
  },
  {
    key: 'chain_mainnet',
    label: 'allora-chain (mainnet deployment)',
    verify: true,
    describe: `latest release of ${CHAIN_REPO}`,
    resolve: () => latestGitHubVersion(CHAIN_REPO),
  },
  {
    key: 'allora_sdk',
    label: 'allora_sdk (PyPI)',
    verify: false,
    describe: 'https://pypi.org/pypi/allora_sdk/json → info.version',
    resolve: latestPyPiVersion,
  },
  {
    key: 'builder_kit',
    label: 'allora-forge-builder-kit',
    verify: false,
    describe: `releases, then tags, then pyproject.toml on the default branch of ${BUILDER_KIT_REPO}`,
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

async function getJson(url, headers) {
  const response = await fetch(url, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'allora-docs-version-bump' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GET ${url} → HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
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

async function latestGitHubVersion(repo, { pyprojectFallback = false } = {}) {
  const headers = githubHeaders();

  const releases = await getJson(`https://api.github.com/repos/${repo}/releases?per_page=100`, headers);
  if (Array.isArray(releases) && releases.length > 0) {
    const version = newestStable(
      releases.filter(release => !release.draft && !release.prerelease).map(release => release.tag_name)
    );
    if (version) return { version, via: 'GitHub releases' };
  }

  const tags = await getJson(`https://api.github.com/repos/${repo}/tags?per_page=100`, headers);
  if (Array.isArray(tags) && tags.length > 0) {
    const version = newestStable(tags.map(tag => tag.name));
    if (version) return { version, via: 'git tags' };
  }

  if (!pyprojectFallback) {
    throw new Error(`${repo} exposes no usable releases or tags.`);
  }

  // The builder kit publishes neither releases nor tags; its packaging metadata
  // is the only machine-readable version it has. Keep this fallback last so it
  // is superseded automatically the day the repo starts tagging.
  const repoMeta = await getJson(`https://api.github.com/repos/${repo}`, headers);
  const branch = (repoMeta && repoMeta.default_branch) || 'main';
  const pyproject = await getText(`https://raw.githubusercontent.com/${repo}/${branch}/pyproject.toml`);
  const match = pyproject && pyproject.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  if (!match || !parseSemver(match[1])) {
    throw new Error(`${repo} exposes no releases, no tags, and no readable pyproject.toml version.`);
  }
  return { version: match[1], via: `pyproject.toml on ${branch}` };
}

async function latestPyPiVersion() {
  const data = await getJson('https://pypi.org/pypi/allora_sdk/json');
  const version = data && data.info && data.info.version;
  if (!version || !parseSemver(version)) {
    throw new Error(`PyPI returned no usable version for allora_sdk (got ${JSON.stringify(version)}).`);
  }
  return { version, via: 'PyPI' };
}

/** Keeps the "v" convention each key already uses, so the file stays consistent. */
function matchPrefix(current, next) {
  const bare = String(next).replace(/^v/, '');
  return String(current).startsWith('v') ? `v${bare}` : bare;
}

function renderBody(proposals) {
  const safe = proposals.filter(proposal => !proposal.verify);
  const gated = proposals.filter(proposal => proposal.verify);
  const lines = [];

  lines.push('Automated check of upstream releases against `public/api/versions.json`.');
  lines.push('');
  lines.push('**These are proposals for human review, not verified truth.** Nothing here');
  lines.push('is confirmed by the network itself — check each entry before merging.');
  lines.push('');

  if (safe.length > 0) {
    lines.push('### Published-package bumps');
    lines.push('');
    lines.push('These track the version an upstream package actually publishes, so they are');
    lines.push('usually safe to take as-is once the docs text still reads correctly.');
    lines.push('');
    lines.push('| Key | Current | Proposed | Source |');
    lines.push('| --- | --- | --- | --- |');
    safe.forEach(p => lines.push(`| \`${p.key}\` | \`${p.current}\` | \`${p.next}\` | ${p.via} |`));
    lines.push('');
  }

  if (gated.length > 0) {
    lines.push('### Deployment-gated bumps — confirm before merging');
    lines.push('');
    lines.push('`chain_testnet` and `chain_mainnet` record the release each network is');
    lines.push('**currently running**, which routinely lags the newest `allora-chain` tag.');
    lines.push('A new tag does **not** mean the network upgraded. Confirm the deployed');
    lines.push('version first — for example `allorad status` against the network endpoint, or');
    lines.push('the upgrade announcement — and drop the hunk if the network has not moved yet.');
    lines.push('');
    lines.push('| Key | Current | Proposed | Source |');
    lines.push('| --- | --- | --- | --- |');
    gated.forEach(p => lines.push(`| \`${p.key}\` | \`${p.current}\` | \`${p.next}\` | ${p.via} |`));
    lines.push('');
  }

  lines.push('Pages render these values through `<Version of="..."/>`');
  lines.push('(`components/Version.tsx`), so merging updates every page at once. Prose that');
  lines.push('describes *when* a feature landed is deliberately left alone.');

  return lines.join('\n');
}

function writeGitHubOutput(changed, body) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const delimiter = `EOF_${Date.now()}`;
  fs.appendFileSync(
    outputFile,
    `changed=${changed ? 'true' : 'false'}\nbody<<${delimiter}\n${body}\n${delimiter}\n`
  );
}

async function main() {
  const write = process.argv.includes('--write');
  const versions = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
  const proposals = [];

  for (const source of SOURCES) {
    const current = versions[source.key];
    if (current === undefined) {
      throw new Error(`public/api/versions.json has no key "${source.key}".`);
    }

    const { version, via } = await source.resolve();
    const next = matchPrefix(current, version);
    const comparison = compareSemver(next, current);

    if (comparison === null) {
      throw new Error(`Cannot compare "${current}" with "${next}" for key "${source.key}".`);
    }

    if (comparison > 0) {
      proposals.push({ key: source.key, label: source.label, current, next, via, verify: source.verify });
      console.log(`${source.key}: ${current} → ${next}  (${source.label}, via ${via})`);
    } else if (comparison < 0) {
      console.log(
        `${source.key}: ${current} is ahead of upstream ${next} (${via}) — left alone.`
      );
    } else {
      console.log(`${source.key}: ${current} is current (${source.label}, via ${via}).`);
    }
  }

  if (proposals.length === 0) {
    console.log('\nNo bumps proposed; public/api/versions.json matches upstream.');
    writeGitHubOutput(false, '');
    return;
  }

  const body = renderBody(proposals);

  if (write) {
    proposals.forEach(proposal => {
      versions[proposal.key] = proposal.next;
    });
    fs.writeFileSync(VERSIONS_FILE, `${JSON.stringify(versions, null, 2)}\n`);
    console.log(`\nWrote ${proposals.length} bump(s) to public/api/versions.json.`);
  } else {
    console.log(`\n${proposals.length} bump(s) proposed. Re-run with --write to apply.`);
  }

  writeGitHubOutput(true, body);
  console.log(`\n--- pull request body ---\n${body}`);
}

main().catch(error => {
  console.error(`Version bump check failed: ${error.message}`);
  process.exit(1);
});
