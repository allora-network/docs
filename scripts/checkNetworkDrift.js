/**
 * Detects drift between the versions recorded in public/api/networks.json and
 * the versions the live networks actually report over CometBFT RPC.
 *
 * Two facts are compared, because the build hash alone proved not to be enough.
 *
 * `abci_version` holds the raw `result.response.version` string from
 * `<rpc>abci_info` — allora-chain reports a build identifier there (for example
 * `HEAD-<commit sha>`) rather than a release tag.
 *
 * `emissions_namespace` holds the emissions module's REST namespace. The chain
 * does not advertise it, so it is probed: `<lcd>/emissions/v<N>/params` is asked
 * from the recorded namespace upward, and the highest routed one is what the
 * network serves; when nothing at or above the recorded namespace answers, the
 * walk looks below it, so a manifest recorded past the chain reports as drift
 * rather than as an unreachable network. This is the fact a reader actually feels — when mainnet
 * upgraded to v0.17.0, `emissions/v9` stopped being routed, every documented
 * mainnet LCD path began answering `501 Not Implemented`, and the nightly topics
 * job started failing, while a build-hash-only check reported a tidy hash change
 * and left the rest to a footnote.
 *
 * `deployed_version` remains the human-maintained release tag and is never
 * rewritten by this script: no endpoint reports one. A namespace move is
 * reported as the release upgrade it is, so the pull request asks for that
 * field by name instead of mentioning it in passing.
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

const dns = require('dns');
const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(__dirname, '../public/api/networks.json');
const requestTimeoutMs = 20000;
const maxAttempts = 3;
const retryBackoffMs = 2000;
const userAgent = 'allora-docs-network-drift/1.0 (+https://docs.allora.network)';

// The emissions module's REST namespace, e.g. `emissions/v10`.
const NAMESPACE_SHAPE = /^emissions\/v(\d+)$/;
// How far above the recorded namespace to look for a newer one. An upgrade
// moves it by one; three leaves room for a missed night without turning the
// probe into a scan.
const maxNamespaceLookahead = 3;

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

// The address half of the classifier, pulled out so the very same rules can be
// applied twice: once to whatever the manifest wrote, and once to whatever DNS
// answers for it. Two copies of these ranges would drift apart, and the copy
// that drifted would be the one nobody was reading.
//
// Returns `null` -- "that was not an address at all" -- rather than a verdict,
// because the two callers want opposite defaults for a name: a hostname is
// allowed to be a hostname, and a resolver answer is not.
function classifyAddress(host) {
  const v6 = parseIpv6(host);
  if (v6) {
    if (isForbiddenIpv6(v6)) return true;
    const embedded = embeddedIpv4(v6);
    return embedded ? isForbiddenIpv4(embedded) : false;
  }

  const v4 = parseIpv4(host) || parseIpv4Loose(host);
  return v4 ? isForbiddenIpv4(v4) : null;
}

function isForbiddenHost(hostname) {
  const host = canonicalHost(hostname);
  if (host === '') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // Names that only resolve inside a network: cloud metadata is published at
  // metadata.google.internal, and mDNS serves .local on the local segment.
  if (host === 'internal' || host.endsWith('.internal')) return true;
  if (host === 'local' || host.endsWith('.local')) return true;

  // A name that is not an address literal is allowed HERE and judged again
  // once it has been resolved -- see assertResolvedAddressesAllowed below.
  // This check alone cannot see where a name points.
  const verdict = classifyAddress(host);
  return verdict === null ? false : verdict;
}

// The same ranges, asked about an address a resolver handed back rather than
// about a string a manifest wrote. The default is inverted: a hostname may be a
// hostname, but there is no legitimate resolver answer that fails to parse as
// an address here, so anything that does is either a bug or something being
// smuggled through, and both get the same answer.
function isForbiddenAddress(address) {
  // A string, not something that stringifies into one. canonicalHost coerces,
  // so `{ toString: () => '8.8.8.8' }` would otherwise be read as a public
  // address and dialled. Nothing else here would catch it: it coerces to
  // something that parses perfectly.
  if (typeof address !== 'string') return true;
  // `fe80::1%eth0`: a zone id is not part of the address, and the address is
  // what decides. Stripped before parsing rather than after, so a zone id can
  // never be the reason something fails to parse and gets waved through as
  // "not an address".
  const host = canonicalHost(address).split('%')[0];
  // No explicit empty-string case: '' parses as nothing, and "parses as
  // nothing" is already the refusal below. A second line saying so would be a
  // line no test could ever fail on.
  const verdict = classifyAddress(host);
  return verdict === null ? true : verdict;
}

// Key names that mean something to the language rather than naming a chain. No
// network is called any of these, and every layer that touches such a key
// handles it differently -- JSON.parse makes `__proto__` an ordinary own
// property, an object literal makes it the prototype, Object.assign fires a
// setter -- so rather than reason about which spelling arrived, the name is
// refused. scripts/hardenDriftManifest.js already refuses to carry these across
// from the branch copy; refusing to derive an allowlist entry from one keeps the
// two sides of the boundary agreeing on what a network name is, instead of
// granting reach to a host no probeable network can name.
const RESERVED_NETWORK_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// The endpoint fields a probe is allowed to reach, and therefore the fields the
// allowlist is derived from. `rpc` answers `abci_info`; `lcd` answers the
// emissions-namespace check. A field that becomes a fetch target and is not
// listed here would be refused at the point of use, so the two must agree.
const PROBEABLE_ENDPOINT_KEYS = ['rpc', 'lcd'];

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
    if (RESERVED_NETWORK_KEYS.has(name)) continue;
    const entry = networks[name];
    if (!entry || typeof entry !== 'object') continue;
    for (const field of PROBEABLE_ENDPOINT_KEYS) {
      // hasOwnProperty, not a bare read: an entry whose PROTOTYPE carries an
      // `rpc` would otherwise widen the allowlist with a host that appears
      // nowhere in the manifest's own data.
      if (!Object.prototype.hasOwnProperty.call(entry, field)) continue;
      // A string, not something that merely stringifies into one: `new URL()`
      // coerces its argument, so an object with a toString would otherwise put
      // whatever it returns on the allowlist.
      if (typeof entry[field] !== 'string') continue;
      try {
        hosts.add(new URL(entry[field]).hostname.toLowerCase());
      } catch {
        /* a trusted entry that does not parse contributes no host */
      }
    }
  }
  return hosts;
}

// `rpc` values in the manifest carry a trailing slash; new URL() handles both.
// Resolving is also where the target is vetted, so there is no path to a fetch
// that skips the check.
// One vetting path, parameterised by the manifest field the endpoint came from,
// rather than one per probe. A second copy of these checks is precisely the
// hazard this file already names for the address ranges: the copy that drifted
// would be the one nobody was reading, and here it would be a copy of the SSRF
// guard. The field name only shapes the wording of the three parse errors.
function vettedProbeUrl(endpoint, relativePath, field, allowedHosts) {
  let url;
  try {
    url = new URL(relativePath, endpoint);
  } catch {
    throw new Error(`${field} endpoint ${JSON.stringify(endpoint)} is not a usable URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(
      `${field} endpoint ${JSON.stringify(endpoint)} is not http(s) (got "${url.protocol}")`
    );
  }
  if (!url.hostname) {
    throw new Error(`${field} endpoint ${JSON.stringify(endpoint)} names no host`);
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

function abciInfoUrl(rpc, allowedHosts) {
  return vettedProbeUrl(rpc, 'abci_info', 'rpc', allowedHosts);
}

// `<lcd>/emissions/v<N>/params` — the cheapest query every emissions version
// serves, used only to ask whether that namespace is routed at all.
function emissionsParamsUrl(lcd, namespace, allowedHosts) {
  if (!NAMESPACE_SHAPE.test(String(namespace))) {
    throw new Error(
      `emissions_namespace ${JSON.stringify(namespace)} is not of the form "emissions/v<N>"`
    );
  }
  return vettedProbeUrl(lcd, `${namespace}/params`, 'lcd', allowedHosts);
}

// ---------------------------------------------------------------------------
// Where the name actually points
//
// Everything above judges a string. A DNS name is not a string whose meaning
// the manifest owns: `rpc.example.com` passes every check on this page and can
// still answer `127.0.0.1`, which puts the request on the runner itself -- and
// it walks past --allowed-hosts too, because that allowlist matches the NAME.
// So the target is resolved before the request goes out and every address the
// resolver returns is put through the same classifier the literal would have
// been put through.
//
// `dns.lookup` deliberately, not `dns.resolve`: lookup is getaddrinfo, which is
// the same resolver the connection underneath fetch will use, so this asks the
// question the connection is about to ask. `dns.resolve` talks to the
// nameservers directly and would miss /etc/hosts and nsswitch entirely -- and
// an /etc/hosts entry pointing a public name at 127.0.0.1 is exactly one of the
// things being refused here.
//
// What this does NOT close: the gap between this lookup and the one the
// connection makes a moment later. Node 20's fetch resolves the name again
// itself and offers no supported way to be told which address to use -- a
// `lookup` hook passed in the request init is accepted and silently ignored,
// and the dispatcher that would accept one belongs to undici, which is bundled
// into the runtime but not requirable, so pinning the address would mean either
// a new dependency or replacing fetch with http.request (which does honour
// `lookup`, and would then also need `agent: false`, because a pooled
// keep-alive socket skips the hook altogether). A name that answers a public
// address to this lookup and a private one to the next is therefore still
// possible. Reaching that window at all needs a hostname that is already in the
// default branch's manifest -- a reviewed file -- so what remains sits behind a
// code-review boundary rather than an open one.
//
// Split into a resolver half and a decision half so the decision can be tested
// without a network, and without depending on somebody else's DNS zone still
// pointing where a test expects it to.
// ---------------------------------------------------------------------------

// Marks a refusal that retrying cannot turn into an answer, so the retry loop
// stops on it instead of spending its backoff re-asking a settled question and
// burying the reason under two more failures.
function forbiddenTarget(message) {
  const error = new Error(message);
  error.forbiddenTarget = true;
  return error;
}

// Every address, not just the first one. A resolver that answers a public
// address and a loopback address for the same name has still handed the
// connection a loopback address to choose, and Happy Eyeballs will happily
// choose it.
function assertResolvedAddressesAllowed(url, hostname, records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw forbiddenTarget(`refusing to probe ${url.href}: ${hostname} resolved to no address at all.`);
  }
  for (const record of records) {
    const address = record && record.address;
    if (isForbiddenAddress(address)) {
      throw forbiddenTarget(
        `refusing to probe ${url.href}: ${hostname} resolves to ${JSON.stringify(address)}, which ` +
          `is a loopback, link-local, private or unclassifiable address. No published network RPC ` +
          `is served from one, and a NAME that resolves into those ranges is how a request reaches ` +
          `the runner past a host allowlist -- so the name is refused, not only the literal.`
      );
    }
  }
  return records.map(record => record.address);
}

// `lookup` is a parameter with a real default rather than a hard-wired call, so
// the tests can drive the refusal path with a stub. A test that needed a real
// name in somebody else's zone to resolve to 127.0.0.1 would be a test that
// goes red the day that record moves.
async function assertTargetResolves(url, lookup = dns.promises.lookup) {
  const hostname = canonicalHost(url.hostname);
  // An address literal was already classified directly by isForbiddenHost;
  // resolving it would only hand the same address straight back.
  if (classifyAddress(hostname) !== null) return [hostname];

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    // Not a pass. A name that will not resolve is a network that cannot be
    // probed, and it is reported as one -- loudly, and by name.
    throw new Error(
      `could not resolve ${hostname} to check where it points ` +
        `(${(error && (error.code || error.message)) || 'unknown resolver error'})`
    );
  }
  return assertResolvedAddressesAllowed(url, hostname, records);
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

async function fetchAbciVersion(rpc, allowedHosts, lookup = dns.promises.lookup) {
  // Throws before any request is made if the target is not somewhere this is
  // allowed to reach; the caller reports that as a probe error for the network.
  const url = abciInfoUrl(rpc, allowedHosts);
  const target = new URL(url);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Inside the loop rather than before it, for two reasons. The name is
      // re-resolved and re-judged on every attempt, so a retry can never be the
      // thing that carries a request to an address the first attempt would have
      // refused. And a resolver that is briefly unreachable stays exactly as
      // retryable as a connection that is briefly unreachable, which is what it
      // is -- before this check existed, fetch was doing that lookup inside the
      // same loop anyway.
      await assertTargetResolves(target, lookup);
      const response = await fetch(url, {
        ...probeRequestOptions(),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      return await versionFromResponse(response);
    } catch (error) {
      // A refusal is an answer, not a failure to get one.
      if (error && error.forbiddenTarget) throw error;
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(retryBackoffMs * attempt);
      }
    }
  }

  throw new Error(`${url}: ${lastError && lastError.message ? lastError.message : 'unknown error'}`);
}

// ---------------------------------------------------------------------------
// Which emissions namespace the chain actually serves
//
// `abci_version` is a build identifier, so comparing it catches that a network
// changed and nothing more. The consequence a reader feels is the namespace:
// when mainnet upgraded to v0.17.0, `emissions/v9` stopped being routed and
// every documented mainnet LCD path began answering `501 Not Implemented`,
// while this check reported a tidy hash change and left a footnote asking a
// human to consider the rest. The namespace is queryable, so it is queried.
//
// Unlike the build hash it cannot simply be read off an endpoint: the chain
// does not advertise its emissions version, it either routes a namespace or it
// does not. So it is probed — the recorded one first, then upward until a
// namespace is not routed, and the highest routed one is what the network
// serves; if nothing at or above the recorded one answers, the walk looks
// below it before giving up.
// ---------------------------------------------------------------------------

// An HTTP answer is an answer. A namespace the gateway does not route replies
// 501 (or 404), and re-asking twice more on a two-second backoff would only
// spend thirty seconds confirming it. A redirect is a deterministic refusal:
// the LCD must answer directly, and a gateway that redirects tonight will
// redirect on the retry too, so it is thrown with `deterministic` set and the
// retry loop rethrows it the way it does a forbidden target. What remains
// retryable is a transport failure, a non-501 5xx, and a 2xx whose body does
// not hold up -- a proxy can 200 an error page transiently, and if it does so
// three times the run reports a probe error rather than believing it.
//
// A 2xx alone is NOT proof the namespace is routed. A catch-all gateway that
// answers 200 to every path would otherwise walk the probe to the top of its
// lookahead and have --write record a namespace nothing serves. The params
// query this probe uses returns `{"params":{...}}` on every emissions version,
// so that is the shape a routed answer must produce.
async function namespaceRoutedFromResponse(response) {
  if (response.status >= 300 && response.status < 400) {
    const error = new Error(
      `HTTP ${response.status} redirect to ${JSON.stringify(response.headers.get('location'))} ` +
        `-- the LCD must answer directly; redirects are not followed`
    );
    error.deterministic = true;
    throw error;
  }
  if (response.ok) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('HTTP 200 with a body that is not JSON -- not accepted as a routed namespace');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        !payload.params || typeof payload.params !== 'object' || Array.isArray(payload.params)) {
      throw new Error(
        'HTTP 200 without an emissions params object -- not accepted as a routed namespace'
      );
    }
    return true;
  }
  if (response.status === 501 || response.status === 404) return false;
  throw new Error(`HTTP ${response.status}`);
}

async function probeNamespaceRouted(lcd, namespace, allowedHosts, lookup = dns.promises.lookup) {
  const url = emissionsParamsUrl(lcd, namespace, allowedHosts);
  const target = new URL(url);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await assertTargetResolves(target, lookup);
      const response = await fetch(url, {
        ...probeRequestOptions(),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      return await namespaceRoutedFromResponse(response);
    } catch (error) {
      if (error && (error.forbiddenTarget || error.deterministic)) throw error;
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(retryBackoffMs * attempt);
      }
    }
  }

  throw new Error(`${url}: ${lastError && lastError.message ? lastError.message : 'unknown error'}`);
}

// Walks up from the recorded namespace and returns the highest one the network
// routes. In the steady state that is two requests: the recorded namespace
// answers and the one above it does not.
// `probe` is a parameter with a real default, the way `lookup` is above it, so
// the walk can be tested without a network — the part worth testing here is
// which namespaces get asked and which answer is believed, not fetch.
async function fetchServedNamespace(
  lcd,
  recorded,
  allowedHosts,
  lookup = dns.promises.lookup,
  probe = probeNamespaceRouted
) {
  const shape = NAMESPACE_SHAPE.exec(String(recorded || ''));
  if (!shape) {
    throw new Error(
      `emissions_namespace ${JSON.stringify(recorded)} is not of the form "emissions/v<N>", ` +
        `so there is no namespace to probe from`
    );
  }

  const from = Number(shape[1]);
  // Past Number.MAX_SAFE_INTEGER, `version++` stops changing the value and the
  // walk below never terminates. The manifest can arrive from the machine-owned
  // drift branch, so a hostile or corrupted namespace number must be an error,
  // not a hang in the nightly. The ceiling is checked as well as the start: a
  // `from` that is itself safe can still have `from + maxNamespaceLookahead`
  // land outside the range, which reintroduces the same non-terminating walk
  // one step further along.
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(from + maxNamespaceLookahead)) {
    throw new Error(
      `emissions_namespace ${JSON.stringify(recorded)} carries a version number too large ` +
        `to walk from`
    );
  }
  let served = null;

  for (let version = from; version <= from + maxNamespaceLookahead; version++) {
    const namespace = `emissions/v${version}`;
    const routed = await probe(lcd, namespace, allowedHosts, lookup);
    if (routed) served = namespace;
    // The first unrouted namespace above a routed one is the ceiling. Below the
    // first routed one it proves nothing yet -- that is the upgrade case, where
    // the recorded namespace is the one that stopped being served.
    else if (served !== null) break;
  }

  // Nothing at or above the recorded namespace answered. Before calling the
  // network unreachable, look below: a manifest recorded past what the chain
  // serves -- a hand-bump that overshot, or a rollback -- has every upward
  // probe answer 501, and the namespace actually routed sits just under the
  // recorded one. Found there, it is reported as ordinary drift and --write
  // repairs the manifest; only a network routing nothing in either direction
  // is a probe error.
  if (served === null) {
    for (let version = from - 1; version >= Math.max(1, from - maxNamespaceLookahead); version--) {
      const namespace = `emissions/v${version}`;
      const routed = await probe(lcd, namespace, allowedHosts, lookup);
      if (routed) {
        served = namespace;
        break;
      }
    }
  }

  if (served === null) {
    const lowest = Math.max(1, from - maxNamespaceLookahead);
    throw new Error(
      `no emissions namespace is routed at ${lcd} between emissions/v${lowest} and ` +
        `emissions/v${from + maxNamespaceLookahead}; the recorded ${recorded} is not served and ` +
        `no nearby version answered either`
    );
  }

  return served;
}

function emitGithubOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    return;
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
}

function buildPullRequestBody(drifted, namespaceDrifted, probeErrors) {
  const lines = [
    'The scheduled network drift check found that at least one Allora network is',
    'reporting a different build or serving a different emissions namespace than',
    '`public/api/networks.json` records.',
  ];

  if (drifted.length > 0) {
    lines.push(
      '',
      '### Build',
      '',
      '| Network | RPC | Recorded `abci_version` | Reported by `abci_info` |',
      '|---|---|---|---|'
    );
    for (const { network, rpc, recorded, reported } of drifted) {
      lines.push(
        `| ${network} | \`${abciInfoUrl(rpc)}\` | \`${recorded || '(unset)'}\` | \`${reported}\` |`
      );
    }
  }

  // The namespace section is deliberately not a footnote. The version of this
  // body that only mentioned `emissions_namespace` in a paragraph of follow-up
  // advice shipped a PR that updated two hashes while mainnet's recorded
  // namespace stayed at `emissions/v9` -- by then unrouted, so every documented
  // mainnet LCD path in the docs answered 501, and the nightly topics job had
  // started failing on the same call. A namespace move is a module upgrade, and
  // it is the signal that the hand-maintained half of the manifest is stale.
  if (namespaceDrifted.length > 0) {
    lines.push(
      '',
      '### Emissions namespace — this was a module upgrade',
      '',
      '| Network | LCD | Recorded `emissions_namespace` | Actually routed |',
      '|---|---|---|---|'
    );
    for (const { network, lcd, recorded, served } of namespaceDrifted) {
      lines.push(`| ${network} | \`${lcd}\` | \`${recorded || '(unset)'}\` | \`${served}\` |`);
    }
    lines.push(
      '',
      '> [!IMPORTANT]',
      '> The recorded namespace is no longer routed on the network(s) above, so every',
      '> documented LCD path using it now answers `501 Not Implemented`. This PR',
      '> updates `emissions_namespace`, which also fixes the nightly topics job —',
      '> `scripts/generateTopics.js` reads the namespace from this manifest.',
      '>',
      '> **A namespace move means the chain took a release upgrade, so the',
      '> hand-maintained fields are almost certainly stale too.** Before merging,',
      '> confirm which release each network below is running and update',
      '> `deployed_version` here and the matching `chain_<network>` key in',
      '> `public/api/versions.json` in the same commit.',
      '>'
    );
    for (const { network, deployed_version: deployed } of namespaceDrifted) {
      lines.push(`> - \`${network}\` still records \`deployed_version: ${deployed || '(unset)'}\``);
    }
    lines.push(
      '>',
      '> The applied upgrade plan is the authority on which release actually ran:',
      '> `<lcd>/cosmos/upgrade/v1beta1/applied_plan/<tag>` returns a non-zero height',
      '> only for a plan that executed.'
    );
  }

  lines.push(
    '',
    'The `deployed_version` release tag is **not** changed automatically: `abci_info`',
    'reports a build identifier rather than a release tag. Check the',
    '[allora-chain releases](https://github.com/allora-network/allora-chain/releases)',
    'and, if a new release is live, update `deployed_version` in this PR before',
    'merging.',
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
  isForbiddenAddress,
  canonicalHost,
  abciInfoUrl,
  assertTargetResolves,
  hostsOf,
  fetchAbciVersion,
  probeRequestOptions,
  versionFromResponse,
  emissionsParamsUrl,
  namespaceRoutedFromResponse,
  fetchServedNamespace,
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
  const namespaceDrifted = [];
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

    // Judged separately from the build hash, and reported separately: a
    // namespace move is a module upgrade, which is the case where the rest of
    // the manifest -- deployed_version, and versions.json with it -- needs a
    // human. A build hash that moved on its own does not imply that.
    if (!entry.lcd) {
      console.error(`ERROR ${network}: no lcd endpoint in the manifest`);
      probeErrors.push({ network, message: 'no lcd endpoint in the manifest' });
      continue;
    }
    let servedNamespace;
    try {
      servedNamespace = await fetchServedNamespace(entry.lcd, entry.emissions_namespace, args.allowedHosts);
    } catch (error) {
      console.error(`ERROR ${network}: ${error.message}`);
      probeErrors.push({ network, message: error.message });
      continue;
    }

    if (entry.emissions_namespace === servedNamespace) {
      console.log(`ok    ${network}: serves ${servedNamespace}`);
    } else {
      console.log(
        `DRIFT ${network}: recorded ${entry.emissions_namespace || '(unset)'} -> serves ${servedNamespace}`
      );
      namespaceDrifted.push({
        network,
        lcd: entry.lcd,
        recorded: entry.emissions_namespace,
        served: servedNamespace,
        deployed_version: entry.deployed_version,
      });
    }
  }

  if ((drifted.length > 0 || namespaceDrifted.length > 0) && args.write) {
    for (const { network, reported } of drifted) {
      manifest.networks[network].abci_version = reported;
    }
    for (const { network, served } of namespaceDrifted) {
      manifest.networks[network].emissions_namespace = served;
    }
    manifest.updated = new Date().toISOString().slice(0, 10);

    // Match the file's existing formatting: two-space indent, trailing newline.
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log('');
    const touched = [...new Set([...drifted, ...namespaceDrifted].map(d => d.network))];
    console.log(`Updated ${manifestPath} for: ${touched.join(', ')}`);

    if (args.bodyFile) {
      fs.writeFileSync(
        args.bodyFile,
        buildPullRequestBody(drifted, namespaceDrifted, probeErrors),
        'utf8'
      );
      console.log(`Wrote pull-request body to ${args.bodyFile}`);
    }
  }

  // Emitted only after the manifest and body have actually been written, so a
  // consumer that acts on `drift=true` can rely on those files existing. Any
  // earlier failure leaves every output unset; the workflow therefore gates its
  // failure step on this step's outcome rather than on these values.
  emitGithubOutputs({
    drift: drifted.length > 0 || namespaceDrifted.length > 0 ? 'true' : 'false',
    networks: [...new Set([...drifted, ...namespaceDrifted].map(d => d.network))].join(','),
    namespace_drift: namespaceDrifted.map(d => d.network).join(','),
    probe_errors: probeErrors.map(p => p.network).join(','),
  });

  console.log('');
  if (drifted.length === 0 && namespaceDrifted.length === 0) {
    const checked = networks.length - probeErrors.length;
    console.log(
      `No drift: ${checked}/${networks.length} networks report the build and serve the emissions ` +
        `namespace recorded in the manifest.`
    );
  }

  if (probeErrors.length > 0) {
    console.error(`Could not probe ${probeErrors.length} of ${networks.length} networks:`);
    probeErrors.forEach(({ network, message }) => console.error(`  ${network}: ${message}`));
    console.error('The networks that did respond were still compared.');
    process.exitCode = 2;
    return;
  }

  if ((drifted.length > 0 || namespaceDrifted.length > 0) && !args.write) {
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
