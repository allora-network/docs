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
  const args = { write: false, bodyFile: null, allowedHosts: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') {
      args.write = true;
    } else if (argv[i] === '--body-file') {
      args.bodyFile = argv[++i];
      if (!args.bodyFile) {
        throw new Error('--body-file requires a path');
      }
    } else if (argv[i].startsWith('--allowed-hosts=')) {
      const list = argv[i]
        .slice('--allowed-hosts='.length)
        .split(',')
        .map(host => host.trim().toLowerCase())
        .filter(Boolean);
      if (list.length === 0) {
        throw new Error('--allowed-hosts needs at least one host');
      }
      args.allowedHosts = new Set(list);
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Where this is allowed to send a request
//
// The manifest this reads is not always one this repository wrote. When a drift
// pull request is open, the nightly workflow merges that branch's copy in --
// scripts/hardenDriftManifest.js keeps the endpoints, but that leaves one
// script's correctness standing between a machine-owned branch and this fetch,
// and it has already been walked past once. So the target is checked again
// here, immediately before the request goes out: a gap upstream then stops at a
// loud error instead of reaching the network.
// ---------------------------------------------------------------------------

// Hosts no published chain RPC is ever served from, and precisely the ones an
// SSRF aims at: the cloud metadata service, the runner's own loopback, whatever
// else is reachable on the private network the runner sits in.
// Normalised the way the connection layer will see it, before anything is
// judged: an address that classifies as harmless in one spelling and is dialled
// in another is not a check, it is a decoration.
//
// `new URL` has already done much of this -- it canonicalises the decimal,
// octal and hex IPv4 literals (`http://2130706433/`, `http://0x7f000001/`,
// `http://0177.0.0.1/`, `http://127.1/`) into dotted quads, and lowercases and
// compresses IPv6 -- but it keeps the brackets on IPv6 and keeps the trailing
// root dot on a DNS name, so `localhost.` and `foo.internal.` arrive intact.
function canonicalHost(hostname) {
  let host = String(hostname).trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  // One trailing dot only: `localhost.` is the fully-qualified spelling of
  // `localhost` and resolves to the same place.
  if (host.endsWith('.') && !host.includes(':')) host = host.slice(0, -1);
  return host;
}

function parseIpv4(host) {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every(octet => octet <= 255) ? octets : null;
}

// The other spellings of an IPv4 address that the URL standard accepts:
// `2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`. In the deployed path
// `new URL` has already rewritten all of these into a dotted quad before the
// guard sees them -- but the guard is exported and reused, and a classifier
// that answers "harmless" to `0xa9fea9fe` is a trap for the next caller. So it
// decodes them itself, by the same rules the URL parser uses.
function parseIpv4Loose(host) {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;

  const numbers = [];
  for (const part of parts) {
    let value;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8);
    else if (/^(0|[1-9]\d*)$/.test(part)) value = Number(part);
    else return null; // any non-numeric label means this is a name, not an address
    if (!Number.isSafeInteger(value) || value < 0) return null;
    numbers.push(value);
  }

  // Every part but the last is one octet; the last fills what remains.
  const leading = numbers.slice(0, -1);
  if (leading.some(value => value > 255)) return null;
  const remaining = 4 - leading.length;
  const last = numbers[numbers.length - 1];
  if (last >= 256 ** remaining) return null;

  const octets = [...leading];
  for (let shift = remaining - 1; shift >= 0; shift--) {
    octets.push((last >>> (shift * 8)) & 0xff);
  }
  return octets;
}

// Expand an IPv6 address to its eight 16-bit groups, including the
// `::ffff:1.2.3.4` form with a dotted-quad tail. Returns null if it is not an
// IPv6 address at all.
function parseIpv6(host) {
  if (!host.includes(':')) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;

  const toGroups = text => {
    if (text === '') return [];
    const parts = text.split(':');
    const groups = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1 && part.includes('.')) {
        const quad = parseIpv4(part);
        if (!quad) return null;
        groups.push((quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(parseInt(part, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array(fill).fill(0), ...tail];
}

// An IPv4 address carried inside an IPv6 one. Every well-known translation
// prefix puts it in the low 32 bits, and the stack will dial the IPv4 host:
// `::ffff:169.254.169.254` is the metadata service wearing a different hat.
function embeddedIpv4(groups) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const low32 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  // ::/96 (v4-compatible), ::ffff:0:0/96 (v4-mapped), ::ffff:0:0:0/96
  // (v4-translated) -- and 64:ff9b::/96 plus 64:ff9b:1::/48 (NAT64).
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0;
  if (zeroPrefix && ((g4 === 0 && g5 === 0) || (g4 === 0 && g5 === 0xffff) || (g4 === 0xffff && g5 === 0))) {
    // `::` and `::1` are their own thing, not an embedded 0.0.0.0/0.0.0.1.
    if (g4 === 0 && g5 === 0 && g6 === 0 && g7 <= 1) return null;
    return low32;
  }
  if (g0 === 0x64 && g1 === 0xff9b) return low32;
  return null;
}

function isForbiddenIpv4([a, b]) {
  if (a === 0) return true; // 0.0.0.0/8 "this host on this network"
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, including 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast (224/4), reserved (240/4), broadcast
  return false;
}

function isForbiddenIpv6(groups) {
  const isZero = groups.every(group => group === 0);
  if (isZero) return true; // ::
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  return false;
}

function isForbiddenHost(hostname) {
  const host = canonicalHost(hostname);
  if (host === '') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // Names that only resolve inside a network: cloud metadata is published at
  // metadata.google.internal, and mDNS serves .local on the local segment.
  if (host === 'internal' || host.endsWith('.internal')) return true;
  if (host === 'local' || host.endsWith('.local')) return true;

  const v6 = parseIpv6(host);
  if (v6) {
    if (isForbiddenIpv6(v6)) return true;
    const embedded = embeddedIpv4(v6);
    return embedded ? isForbiddenIpv4(embedded) : false;
  }

  const v4 = parseIpv4(host) || parseIpv4Loose(host);
  return v4 ? isForbiddenIpv4(v4) : false;
}

// The hosts the trusted manifest names. The workflow passes these as
// --allowed-hosts, derived from the pre-merge copy, so "the endpoints come from
// the default branch" is enforced at the point of use and not only at the point
// of merge.
function hostsOf(manifest) {
  const hosts = new Set();
  const networks =
    manifest && typeof manifest === 'object' && !Array.isArray(manifest.networks)
      ? manifest.networks
      : null;
  if (!networks || typeof networks !== 'object') return hosts;
  for (const name of Object.keys(networks)) {
    // hasOwnProperty, not bracket access: a key called `__proto__` resolves to
    // Object.prototype otherwise, which is how the merge step was bypassed.
    if (!Object.prototype.hasOwnProperty.call(networks, name)) continue;
    const entry = networks[name];
    if (!entry || typeof entry !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(entry, 'rpc')) continue;
    if (typeof entry.rpc !== 'string') continue;
    try {
      hosts.add(new URL(entry.rpc).hostname.toLowerCase());
    } catch {
      /* a trusted entry that does not parse contributes no host */
    }
  }
  return hosts;
}

// `rpc` values in the manifest carry a trailing slash; new URL() handles both.
// Resolving is also where the target is vetted, so there is no path to a fetch
// that skips the check.
function abciInfoUrl(rpc, allowedHosts) {
  let url;
  try {
    url = new URL('abci_info', rpc);
  } catch {
    throw new Error(`rpc endpoint ${JSON.stringify(rpc)} is not a usable URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`rpc endpoint ${JSON.stringify(rpc)} is not http(s) (got "${url.protocol}")`);
  }
  if (!url.hostname) {
    throw new Error(`rpc endpoint ${JSON.stringify(rpc)} names no host`);
  }
  if (isForbiddenHost(url.hostname)) {
    throw new Error(
      `refusing to probe ${url.href}: ${url.hostname} is a loopback, link-local or private ` +
        `address, which no published network RPC is served from. A manifest naming one has ` +
        `been tampered with.`
    );
  }
  if (allowedHosts && !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(
      `refusing to probe ${url.href}: ${url.hostname} is not one of the hosts the trusted ` +
        `manifest names (${[...allowedHosts].join(', ')}).`
    );
  }
  return url.href;
}

// The request options every probe uses. Exported as one object so a test can
// make the same request the script makes, rather than a lookalike.
//
// `redirect: 'manual'` is the load-bearing part. Every check in abciInfoUrl vets
// the URL it resolved; following a redirect hands the choice of the next one
// back to the server, so a vetted host answering `abci_info` with
// `302 Location: http://169.254.169.254/` would walk straight through the whole
// guard. Re-validating each hop was the alternative, and there is nothing there
// worth preserving: `abci_info` is a JSON-RPC endpoint with no legitimate
// reason to redirect, so a redirect means a broken or hostile endpoint either
// way. Refusing is safer than a hop budget, and much shorter.
function probeRequestOptions() {
  return {
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    redirect: 'manual',
  };
}

// Everything that decides whether a response is an answer. Separated from the
// request so the decision can be tested without a network.
async function versionFromResponse(response) {
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `HTTP ${response.status} redirect to ${JSON.stringify(response.headers.get('location'))} ` +
        `-- abci_info must answer directly; redirects are not followed`
    );
  }
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
}

async function fetchAbciVersion(rpc, allowedHosts) {
  // Throws before any request is made if the target is not somewhere this is
  // allowed to reach; the caller reports that as a probe error for the network.
  const url = abciInfoUrl(rpc, allowedHosts);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...probeRequestOptions(),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      return await versionFromResponse(response);
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
    'before merging.',
    '',
    'If you do change `deployed_version`, change the matching `chain_<network>` key',
    'in `public/api/versions.json` in the same commit — `yarn checkversions` fails',
    'while the two files disagree.'
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

// Exported so scripts/testNetworkDriftGuard.js can exercise the host classifier
// directly. Everything below runs only when this file is the entry point, so a
// require() from the tests probes no network and writes no manifest.
module.exports = {
  isForbiddenHost,
  canonicalHost,
  abciInfoUrl,
  hostsOf,
  fetchAbciVersion,
  probeRequestOptions,
  versionFromResponse,
};

const main = async () => {
  // A tiny standalone mode, so the workflow can capture the trusted manifest's
  // host set BEFORE it merges an untrusted copy over it, and hand that set back
  // as --allowed-hosts. Keeping it here means the host logic lives in the one
  // file that acts on it.
  const printHosts = process.argv.indexOf('--print-hosts');
  if (printHosts !== -1) {
    const file = process.argv[printHosts + 1];
    if (!file) {
      console.error('--print-hosts requires a manifest path');
      process.exitCode = 2;
      return;
    }
    try {
      console.log([...hostsOf(JSON.parse(fs.readFileSync(file, 'utf8')))].join(','));
    } catch (error) {
      console.error(`Could not read ${file}: ${error.message}`);
      process.exitCode = 2;
    }
    return;
  }

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  // Parsed defensively because this job *writes* the manifest back: an
  // unreadable or wrongly-shaped file used to surface as a bare SyntaxError, or
  // as "Cannot read properties of null", with no mention of which file was at
  // fault — from a process whose next move is to overwrite it.
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${manifestPath}: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    console.error(`${manifestPath} is valid JSON but not an object.`);
    process.exitCode = 2;
    return;
  }

  const networks = Object.entries(
    manifest.networks && typeof manifest.networks === 'object' && !Array.isArray(manifest.networks)
      ? manifest.networks
      : {}
  );

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
      reported = await fetchAbciVersion(entry.rpc, args.allowedHosts);
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

  // Emitted only after the manifest and body have actually been written, so a
  // consumer that acts on `drift=true` can rely on those files existing. Any
  // earlier failure leaves every output unset; the workflow therefore gates its
  // failure step on this step's outcome rather than on these values.
  emitGithubOutputs({
    drift: drifted.length > 0 ? 'true' : 'false',
    networks: drifted.map(d => d.network).join(','),
    probe_errors: probeErrors.map(p => p.network).join(','),
  });

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
};

if (require.main === module) {
  main().catch(error => {
    console.error('An error occurred:', error);
    process.exitCode = 2;
  });
}
