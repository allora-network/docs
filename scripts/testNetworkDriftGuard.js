#!/usr/bin/env node
//
// Adversarial tests for the probe guard in scripts/checkNetworkDrift.js.
//
// That guard is the last thing between a manifest and an outbound request. It
// is layer 3 of three: scripts/hardenDriftManifest.js keeps a machine-owned
// branch from choosing endpoints (layer 2, tested next door in
// scripts/testHardenDriftManifest.js), the workflow passes the trusted host set
// as --allowed-hosts (layer 1 of enforcement at the point of use), and this
// refuses anything that still resolves somewhere it should not.
//
// It shipped without tests while the other two had them, and a review found 13
// of 38 hostile hosts walking through it in isolation -- IPv4-mapped IPv6, a
// trailing root dot, the benchmarking range, multicast and broadcast -- plus a
// fetch that followed redirects, which hands the choice of the final host back
// to the server the guard just vetted. Every case below is one of those, or one
// that would come back if a rule were dropped.
//
// Zero dependencies, `node:assert`, no framework:
//
//   node scripts/testNetworkDriftGuard.js      (or `yarn testdrift`, which runs
//                                               this and the layer-2 tests)

const assert = require('assert');
const http = require('http');

const {
  isForbiddenHost,
  abciInfoUrl,
  hostsOf,
  probeRequestOptions,
  versionFromResponse,
} = require('./checkNetworkDrift.js');

let failures = 0;
let ran = 0;

function test(name, fn) {
  ran++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(
      () => console.log(`  ok    ${name}`),
      error => {
        failures++;
        console.log(`  FAIL  ${name}`);
        console.log(`        ${String(error.message).split('\n').join('\n        ')}`);
      }
    );
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${String(error.message).split('\n').join('\n        ')}`);
  }
  return Promise.resolve();
}

// The guard is asked about a hostname, but what reaches it in production is
// `new URL(...).hostname`. Both spellings are checked: the raw string, and the
// string after the URL parser has had it, because the parser rewrites decimal,
// octal and hex IPv4 literals into dotted quads and that rewriting is load
// bearing.
function hostnameFromUrl(host) {
  try {
    return new URL(`http://${host}/`).hostname;
  } catch {
    return null;
  }
}

function assertForbidden(host, why) {
  assert.ok(isForbiddenHost(host), `${JSON.stringify(host)} was allowed (${why})`);
  const viaUrl = hostnameFromUrl(host);
  if (viaUrl !== null) {
    assert.ok(
      isForbiddenHost(viaUrl),
      `${JSON.stringify(host)} was allowed as ${JSON.stringify(viaUrl)} after URL parsing (${why})`
    );
  }
}

console.log('checkNetworkDrift probe guard: adversarial cases\n');

// ---------------------------------------------------------------------------
// Hosts that must never be dialled. Grouped by the class each one represents,
// so a future edit that loses a class loses a named test rather than a number.
// ---------------------------------------------------------------------------

const FORBIDDEN = {
  'cloud metadata': ['169.254.169.254', '169.254.170.2', 'metadata.google.internal'],
  'metadata via decimal/octal/hex literal': ['2852039166', '0xa9fea9fe', '0251.0376.0251.0376'],
  'IPv4-mapped IPv6': [
    '[::ffff:169.254.169.254]',
    '::ffff:169.254.169.254',
    '[::ffff:a9fe:a9fe]',
    '[0:0:0:0:0:ffff:127.0.0.1]',
    '[::ffff:0:127.0.0.1]',
  ],
  'IPv4-compatible IPv6': ['[::127.0.0.1]', '[::169.254.169.254]'],
  'NAT64-embedded IPv4': ['[64:ff9b::169.254.169.254]', '[64:ff9b::7f00:1]'],
  loopback: ['127.0.0.1', '127.1', '2130706433', '0x7f000001', '0177.0.0.1', 'localhost', '[::1]'],
  'trailing root dot': ['localhost.', 'metadata.google.internal.', 'FOO.INTERNAL.'],
  'internal / mDNS names': ['foo.internal', 'internal', 'printer.local', 'LOCALHOST'],
  'this-host and unspecified': ['0.0.0.0', '0', '[::]'],
  private: ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1'],
  'carrier-grade NAT': ['100.64.0.1', '100.127.255.255'],
  benchmarking: ['198.18.0.1', '198.19.255.255'],
  multicast: ['224.0.0.1', '239.255.255.250', '[ff02::1]'],
  'broadcast and reserved': ['255.255.255.255', '240.0.0.1'],
  'IPv6 link-local and unique-local': ['[fe80::1]', '[FE80::1]', '[fd00::1]', '[fc00::1]'],
};

let forbiddenCount = 0;
for (const [why, hosts] of Object.entries(FORBIDDEN)) {
  for (const host of hosts) {
    forbiddenCount++;
    test(`${why}: ${host} is refused`, () => assertForbidden(host, why));
  }
}

// ---------------------------------------------------------------------------
// Hosts that must still be reachable. Without these the guard could pass every
// test above by refusing everything, which would take the nightly job down.
// ---------------------------------------------------------------------------

const ALLOWED = [
  'allora-rpc.testnet.allora.network',
  'allora-rpc.mainnet.allora.network',
  'rpc.example.com',
  '8.8.8.8',
  '1.1.1.1',
  '198.20.0.1', // just outside the benchmarking range
  '100.63.255.255', // just below carrier-grade NAT
  '100.128.0.1', // just above it
  '172.15.0.1', // just below the private block
  '172.32.0.1', // just above it
  '223.255.255.255', // just below multicast
  '[2606:4700::1111]', // ordinary public IPv6
  'internal.allora.network', // "internal" as a label, not the TLD
  'local.allora.network',
];

for (const host of ALLOWED) {
  test(`legitimate host ${host} is allowed`, () => {
    assert.ok(!isForbiddenHost(host), `${JSON.stringify(host)} was refused but is legitimate`);
  });
}

// ---------------------------------------------------------------------------
// abciInfoUrl: the scheme filter, the allowlist, and the happy path.
// ---------------------------------------------------------------------------

const TRUSTED_RPC = 'https://allora-rpc.testnet.allora.network/';
const TRUSTED_HOSTS = new Set(['allora-rpc.testnet.allora.network']);

function refuses(rpc, allowedHosts, expectedFragment) {
  assert.throws(
    () => abciInfoUrl(rpc, allowedHosts),
    error => {
      assert.ok(
        error.message.includes(expectedFragment),
        `expected a message mentioning ${JSON.stringify(expectedFragment)}, got: ${error.message}`
      );
      return true;
    },
    `${JSON.stringify(rpc)} was not refused`
  );
}

test('the happy path resolves to abci_info on the trusted host', () => {
  assert.strictEqual(
    abciInfoUrl(TRUSTED_RPC, TRUSTED_HOSTS),
    'https://allora-rpc.testnet.allora.network/abci_info'
  );
});

test('an rpc with a path keeps it and still resolves', () => {
  assert.strictEqual(
    abciInfoUrl('https://allora-rpc.testnet.allora.network/rpc/', TRUSTED_HOSTS),
    'https://allora-rpc.testnet.allora.network/rpc/abci_info'
  );
});

for (const scheme of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/']) {
  test(`scheme filter refuses ${scheme}`, () => refuses(scheme, null, 'not http(s)'));
}

test('an opaque-path scheme is refused before it can resolve', () => {
  // `new URL('abci_info', 'data:...')` throws rather than resolving, so this
  // one is caught a step earlier. Asserting the message it actually produces,
  // not the one the neighbouring cases produce.
  refuses('data:text/plain,x', null, 'not a usable URL');
});

test('a forbidden host is refused even with no allowlist', () => {
  refuses('http://169.254.169.254/', null, 'loopback, link-local or private');
});

test('a forbidden host is refused even when the allowlist names it', () => {
  // The allowlist is a narrowing, never a widening: a trusted manifest that
  // somehow named a link-local address must still not be dialled.
  refuses('http://169.254.169.254/', new Set(['169.254.169.254']), 'loopback, link-local or private');
});

test('an off-allowlist public host is refused', () => {
  refuses('https://evil.example/', TRUSTED_HOSTS, 'not one of the hosts the trusted manifest names');
});

test('an unparseable rpc is refused', () => {
  refuses('not a url', TRUSTED_HOSTS, 'not a usable URL');
});

test('hostsOf reads the trusted host set, ignoring hostile keys', () => {
  const manifest = JSON.parse(
    JSON.stringify({
      networks: {
        testnet: { rpc: TRUSTED_RPC },
        broken: { rpc: 42 },
        nourl: { rpc: 'not a url' },
      },
    }).replace('"nourl"', '"__proto__"')
  );
  assert.deepStrictEqual([...hostsOf(manifest)], ['allora-rpc.testnet.allora.network']);
});

// ---------------------------------------------------------------------------
// Redirects are not followed. A server the guard just vetted must not be able
// to nominate the next host.
// ---------------------------------------------------------------------------

function withServer(handler, run) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', async () => {
      try {
        await run(server.address().port);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

// Two halves, because loopback is (correctly) refused by the host guard, so
// fetchAbciVersion cannot be pointed at a local test server:
//
//   * the DECISION is unit-tested on a Response, offline and exactly;
//   * the REQUEST is integration-tested against a real redirecting server using
//     `probeRequestOptions()` -- the same object the script passes to fetch, not
//     a copy of it -- so "we asked fetch not to follow" is verified rather than
//     assumed.
//
// Together those cover "a redirect cannot move the target", which neither half
// proves on its own.

const redirectTests = [];

for (const status of [301, 302, 303, 307, 308]) {
  redirectTests.push(
    test(`a ${status} response is refused and names where it was being sent`, async () => {
      const response = new Response(null, {
        status,
        headers: { location: 'http://169.254.169.254/abci_info' },
      });
      let threw = null;
      try {
        await versionFromResponse(response);
      } catch (error) {
        threw = error;
      }
      assert.ok(threw, `a ${status} was accepted as an answer`);
      assert.ok(/redirect/i.test(threw.message), `expected a redirect message, got: ${threw.message}`);
      assert.ok(
        threw.message.includes('169.254.169.254'),
        `the refusal should name where it was being sent: ${threw.message}`
      );
    })
  );
}

redirectTests.push(
  test('the probe options really do stop fetch following a redirect', () =>
    withServer(
      (req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: '/followed' });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ followed: true }));
      },
      async port => {
        const response = await fetch(`http://127.0.0.1:${port}/redirect`, probeRequestOptions());
        assert.strictEqual(
          response.status,
          302,
          'fetch followed the redirect -- probeRequestOptions() is no longer redirect:manual'
        );
        assert.strictEqual(response.headers.get('location'), '/followed');
      }
    ))
);

redirectTests.push(
  test('a direct 200 answer is still read as the version', async () => {
    const response = new Response(JSON.stringify({ result: { response: { version: 'HEAD-abc123' } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    assert.strictEqual(await versionFromResponse(response), 'HEAD-abc123');
  })
);

redirectTests.push(
  test('a 200 with no version in the payload is refused', async () => {
    const response = new Response(JSON.stringify({ result: {} }), { status: 200 });
    await assert.rejects(() => versionFromResponse(response), /no result.response.version/);
  })
);

// ---------------------------------------------------------------------------

Promise.all(redirectTests).then(() => {
  console.log(
    `\n${ran - failures}/${ran} passed ` +
      `(${forbiddenCount} hostile hosts, ${ALLOWED.length} legitimate hosts)`
  );
  if (failures > 0) {
    console.error(
      `\n${failures} case(s) FAILED. This guard is the last check before an outbound request ` +
        `from a job holding a write-capable token. Do not weaken a case to make it pass.`
    );
    process.exitCode = 1;
  }
});
