/**
 * Detects drift between the versions recorded in public/api/networks.json and
 * the versions the live networks actually report over CometBFT RPC.
 *
 * Each network's `abci_version` field holds the raw `result.response.version`
 * string from `<rpc>abci_info`. allora-chain reports a build identifier there
 * (for example `HEAD-<commit sha>`) rather than a release tag, so that string is
 * the only value that can be compared automatically; `deployed_version` remains
 * the human-maintained release tag and is never rewritten by this script.
 *
 * Networks are probed and judged independently: an unreachable RPC is reported
 * as a probe error for that network only, and never stops the other networks
 * from being compared or from getting a drift PR.
 *
 * Usage:
 *   node scripts/checkNetworkDrift.js
 *       Report only. Exit 0 when every probed network matches, 1 on drift.
 *
 *   node scripts/checkNetworkDrift.js --write [--body-file <path>]
 *       Same probe, but rewrite the manifest in place with the reported
 *       versions and write a pull-request body to --body-file. Exits 0 with or
 *       without drift so a workflow can branch on the emitted `drift` output.
 *
 * Either mode exits 2 if any network could not be probed — after the healthy
 * networks have been compared and, in --write mode, written — so the failure is
 * visible without withholding the work that did succeed.
 *
 * Plain Node 20 — no dependencies. Set GITHUB_OUTPUT to have `drift`,
 * `networks` and `probe_errors` written as step outputs.
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(__dirname, '../public/api/networks.json');
const requestTimeoutMs = 20000;
const maxAttempts = 3;
const retryBackoffMs = 2000;
const userAgent = 'allora-docs-network-drift/1.0 (+https://docs.allora.network)';

function parseArgs(argv) {
  const args = { write: false, bodyFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') {
      args.write = true;
    } else if (argv[i] === '--body-file') {
      args.bodyFile = argv[++i];
      if (!args.bodyFile) {
        throw new Error('--body-file requires a path');
      }
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// `rpc` values in the manifest carry a trailing slash; new URL() handles both.
function abciInfoUrl(rpc) {
  return new URL('abci_info', rpc).href;
}

async function fetchAbciVersion(rpc) {
  const url = abciInfoUrl(rpc);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const version = payload && payload.result && payload.result.response
        ? payload.result.response.version
        : undefined;
      if (typeof version !== 'string' || version === '') {
        throw new Error('abci_info response had no result.response.version string');
      }
      return version;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(retryBackoffMs * attempt);
      }
    }
  }

  throw new Error(`${url}: ${lastError && lastError.message ? lastError.message : 'unknown error'}`);
}

function emitGithubOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    return;
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

function buildPullRequestBody(drifted, probeErrors) {
  const lines = [
    'The scheduled network drift check found that at least one Allora network is',
    'reporting a different build over RPC than `public/api/networks.json` records.',
    '',
    '| Network | RPC | Recorded `abci_version` | Reported by `abci_info` |',
    '|---|---|---|---|',
  ];

  for (const { network, rpc, recorded, reported } of drifted) {
    lines.push(`| ${network} | \`${abciInfoUrl(rpc)}\` | \`${recorded || '(unset)'}\` | \`${reported}\` |`);
  }

  lines.push(
    '',
    'This PR updates `abci_version` for the networks above.',
    '',
    'The `deployed_version` release tag is **not** changed automatically: `abci_info`',
    'reports a build identifier rather than a release tag. Check the',
    '[allora-chain releases](https://github.com/allora-network/allora-chain/releases)',
    'and, if a new release is live, update `deployed_version` (and the',
    '`emissions_namespace` if the upgrade bumped the emissions module) in this PR',
    'before merging.'
  );

  if (probeErrors.length > 0) {
    lines.push(
      '',
      '> [!WARNING]',
      '> This run could not reach every network, so the comparison is partial and',
      '> the networks below may also have drifted:',
      '>'
    );
    for (const { network, message } of probeErrors) {
      lines.push(`> - \`${network}\`: ${message}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

(async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const networks = Object.entries(manifest.networks || {});

  if (networks.length === 0) {
    console.error(`No networks defined in ${manifestPath}`);
    process.exitCode = 2;
    return;
  }

  // Each network is probed and judged on its own. A network that cannot be
  // reached is reported as a probe error and makes the run exit non-zero, but it
  // never suppresses a healthy network's comparison: one permanently unreachable
  // RPC must not hide real drift on the other chain forever.
  const drifted = [];
  const probeErrors = [];

  for (const [network, entry] of networks) {
    if (!entry.rpc) {
      console.error(`ERROR ${network}: no rpc endpoint in the manifest`);
      probeErrors.push({ network, message: 'no rpc endpoint in the manifest' });
      continue;
    }
    let reported;
    try {
      reported = await fetchAbciVersion(entry.rpc);
    } catch (error) {
      console.error(`ERROR ${network}: ${error.message}`);
      probeErrors.push({ network, message: error.message });
      continue;
    }

    const recorded = entry.abci_version;
    if (recorded === reported) {
      console.log(`ok    ${network}: ${reported}`);
    } else {
      console.log(`DRIFT ${network}: recorded ${recorded || '(unset)'} -> reported ${reported}`);
      drifted.push({ network, rpc: entry.rpc, recorded, reported });
    }
  }

  emitGithubOutputs({
    drift: drifted.length > 0 ? 'true' : 'false',
    networks: drifted.map(d => d.network).join(','),
    probe_errors: probeErrors.map(p => p.network).join(','),
  });

  if (drifted.length > 0 && args.write) {
    for (const { network, reported } of drifted) {
      manifest.networks[network].abci_version = reported;
    }
    manifest.updated = new Date().toISOString().slice(0, 10);

    // Match the file's existing formatting: two-space indent, trailing newline.
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log('');
    console.log(`Updated ${manifestPath} for: ${drifted.map(d => d.network).join(', ')}`);

    if (args.bodyFile) {
      fs.writeFileSync(args.bodyFile, buildPullRequestBody(drifted, probeErrors), 'utf8');
      console.log(`Wrote pull-request body to ${args.bodyFile}`);
    }
  }

  console.log('');
  if (drifted.length === 0) {
    const checked = networks.length - probeErrors.length;
    console.log(`No drift: ${checked}/${networks.length} networks report the version recorded in the manifest.`);
  }

  if (probeErrors.length > 0) {
    console.error(`Could not probe ${probeErrors.length} of ${networks.length} networks:`);
    probeErrors.forEach(({ network, message }) => console.error(`  ${network}: ${message}`));
    console.error('The networks that did respond were still compared.');
    process.exitCode = 2;
    return;
  }

  if (drifted.length > 0 && !args.write) {
    console.error('Run with --write to update public/api/networks.json.');
    process.exitCode = 1;
  }
})().catch(error => {
  console.error('An error occurred:', error);
  process.exitCode = 2;
});
