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
// to the server the guard just vetted. A later review found that judging the
// string was never enough on its own: an ordinary-looking NAME that resolves to
// 127.0.0.1 passes every string check there is, so the target is resolved and
// every address it answers is judged too. Every case below is one of those, or
// one that would come back if a rule were dropped.
//
// A case has to fail when the behaviour it names is removed, or it is
// decoration. Two in this file did not, and both are called out where they were
// fixed: the hostsOf key case, whose hostile entry was thrown out by the URL
// check rather than by any key handling, and the `{ rpc: 42 }` type case, which
// the try/catch would have caught with no type check present at all.
//
// Zero dependencies, `node:assert`, no framework:
//
//   node scripts/testNetworkDriftGuard.js      (or `yarn testdrift`, which runs
//                                               this and the layer-2 tests)

const assert = require('assert');
const http = require('http');

const {
  isForbiddenHost,
  isForbiddenAddress,
  abciInfoUrl,
  assertTargetResolves,
  fetchAbciVersion,
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
  // `new URL('http://./')` parses, and `.` canonicalises to the empty string
  // once the trailing root dot comes off. Nothing below this line would then
  // recognise it as an address, so without the empty-host rule it reads as an
  // ordinary name and goes through.
  'no host at all': ['.', ''],
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

test('an rpc whose entire host is a root dot is refused', () => {
  // The reachable form of the empty-host case: this one parses, survives the
  // scheme check, and arrives at the classifier as `.`, which canonicalises to
  // nothing at all.
  refuses('http://./', null, 'loopback, link-local or private');
});

// ---------------------------------------------------------------------------
// hostsOf: what is allowed to enter the allowlist.
//
// Every case here has to be excluded for the reason its NAME gives, which is
// not free. The version of this section that shipped first gave its `__proto__`
// entry an rpc of `'not a url'` -- so the entry was dropped by the URL check,
// and the case passed exactly as happily against a hostsOf with no key handling
// in it at all. Each fixture below therefore asserts that it really is the
// shape it claims to be before it asserts the outcome: a hostile URL that
// actually parses, an rpc that actually is inherited, a value that actually
// does coerce into a URL.
// ---------------------------------------------------------------------------

const TRUSTED_HOST_ONLY = ['allora-rpc.testnet.allora.network'];

test('hostsOf reads the hosts the manifest names', () => {
  // The positive control. Without it every exclusion case below would pass
  // against a hostsOf that returned an empty set and allowed nothing at all.
  const manifest = {
    networks: {
      testnet: { rpc: TRUSTED_RPC },
      mainnet: { rpc: 'https://allora-rpc.mainnet.allora.network/' },
    },
  };
  assert.deepStrictEqual(
    [...hostsOf(manifest)],
    ['allora-rpc.testnet.allora.network', 'allora-rpc.mainnet.allora.network']
  );
});

for (const key of ['__proto__', 'constructor', 'prototype']) {
  test(`a network keyed ${key} carrying a VALID hostile URL stays out of the allowlist`, () => {
    // Built with JSON.parse, so the key is a genuine own enumerable property
    // that Object.keys returns and a bracket read resolves to -- not a
    // prototype assignment, which would serialise to nothing and leave this
    // case testing an empty input.
    const manifest = JSON.parse(
      `{"networks":{"testnet":{"rpc":${JSON.stringify(TRUSTED_RPC)}},` +
        `${JSON.stringify(key)}:{"rpc":"https://evil.example/"}}}`
    );
    assert.ok(
      Object.keys(manifest.networks).includes(key),
      `the fixture's ${key} entry is not an own enumerable key, so the loop never sees it`
    );
    // And the URL parses. That is the whole point: with a valid URL there is
    // nothing left to reject this entry except the handling of its key.
    assert.strictEqual(
      new URL(manifest.networks[key].rpc).hostname,
      'evil.example',
      'the hostile URL must parse, or the URL check excludes it instead of the key check'
    );
    assert.deepStrictEqual([...hostsOf(manifest)], TRUSTED_HOST_ONLY, `${key} widened the allowlist`);
  });
}

test('an entry whose rpc is inherited rather than its own stays out of the allowlist', () => {
  const manifest = {
    networks: {
      testnet: { rpc: TRUSTED_RPC },
      sneaky: Object.create({ rpc: 'https://evil.example/' }),
    },
  };
  assert.strictEqual(
    manifest.networks.sneaky.rpc,
    'https://evil.example/',
    'the fixture does not actually inherit an rpc, so this case proves nothing'
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(manifest.networks.sneaky, 'rpc'),
    'the fixture holds rpc as an own property, so the inheritance check is not exercised'
  );
  assert.deepStrictEqual([...hostsOf(manifest)], TRUSTED_HOST_ONLY, 'an inherited rpc widened the allowlist');
});

test('an rpc that merely stringifies into a URL stays out of the allowlist', () => {
  // `new URL()` coerces its argument, so an object with a toString reaches the
  // allowlist unless the type is checked before the parse. `{ rpc: 42 }` does
  // NOT prove this -- 42 stringifies to something that fails to parse, so the
  // try/catch would catch it with no type check present at all.
  const manifest = {
    networks: {
      testnet: { rpc: TRUSTED_RPC },
      sneaky: { rpc: { toString: () => 'https://evil.example/' } },
    },
  };
  assert.strictEqual(
    new URL(manifest.networks.sneaky.rpc).hostname,
    'evil.example',
    'the fixture does not actually coerce into a hostile URL, so this case proves nothing'
  );
  assert.deepStrictEqual([...hostsOf(manifest)], TRUSTED_HOST_ONLY, 'a coercible rpc widened the allowlist');
});

test('an rpc that does not parse costs only its own entry', () => {
  // Listed first, so a hostsOf that let the parse throw would take the whole
  // allowlist down with it rather than skipping one network.
  const manifest = { networks: { broken: { rpc: 'not a url' }, testnet: { rpc: TRUSTED_RPC } } };
  assert.deepStrictEqual([...hostsOf(manifest)], TRUSTED_HOST_ONLY);
});

// ---------------------------------------------------------------------------
// Where the name actually points.
//
// Every case above judges a string. `rpc.example.com` passes all of them and
// can still answer 127.0.0.1 -- and it walks past --allowed-hosts too, because
// that allowlist matches the NAME. These cases cover the second look, after
// resolution.
//
// Driven by a stub resolver rather than by real names. A case that needed
// somebody else's zone to keep pointing a public name at 127.0.0.1 would be a
// case that goes red the day that record is retired, which is not a property
// worth having in the job that guards this one.
// ---------------------------------------------------------------------------

const resolvesTo = (...addresses) => async () =>
  addresses.map(address => ({ address, family: String(address).includes(':') ? 6 : 4 }));

const resolverFails = code => async () => {
  const error = new Error('the stub resolver was asked and refused');
  error.code = code;
  throw error;
};

const TRUSTED_TARGET = new URL('https://allora-rpc.testnet.allora.network/abci_info');

// Addresses that must never be dialled even when a perfectly ordinary name
// resolved to them. Same ranges as the host classifier, asked the other way
// round, because a name is only as safe as what it answers.
const RESOLVED_FORBIDDEN = {
  loopback: ['127.0.0.1', '127.255.255.254', '::1'],
  'link-local and cloud metadata': ['169.254.169.254', 'fe80::1'],
  'link-local carrying a zone id': ['fe80::1%eth0'],
  private: ['10.0.0.1', '172.16.0.1', '192.168.1.1', 'fd00::1'],
  'carrier-grade NAT': ['100.64.0.1'],
  'IPv4-mapped IPv6': ['::ffff:127.0.0.1', '::ffff:169.254.169.254'],
  'this-host, multicast and broadcast': ['0.0.0.0', '224.0.0.1', '255.255.255.255'],
  benchmarking: ['198.18.0.1'],
};

let resolvedForbiddenCount = 0;
for (const [why, addresses] of Object.entries(RESOLVED_FORBIDDEN)) {
  for (const address of addresses) {
    resolvedForbiddenCount++;
    test(`a name resolving to ${address} (${why}) is refused`, () => {
      assert.ok(isForbiddenAddress(address), `${JSON.stringify(address)} was accepted as a resolver answer`);
    });
  }
}

for (const address of ['8.8.8.8', '1.1.1.1', '8.233.44.232', '2606:4700::1111']) {
  test(`a name resolving to the public address ${address} is allowed`, () => {
    assert.ok(!isForbiddenAddress(address), `${JSON.stringify(address)} was refused but is public`);
  });
}

// A hostname is allowed to be a hostname; a resolver answer is not. Anything
// that does not parse as an address here is a bug or a smuggling attempt, and
// both are answered the same way.
for (const answer of ['', 'not-an-address', 'example.com', '999.999.999.999', '::gg']) {
  test(`an unclassifiable resolver answer ${JSON.stringify(answer)} fails closed`, () => {
    assert.ok(
      isForbiddenAddress(answer),
      `${JSON.stringify(answer)} could not be parsed as an address and was allowed anyway`
    );
  });
}

test('a resolver answer that is not a string is refused even when it stringifies to one', () => {
  // The coercible object is the assertion that carries this case. `null`, `42`
  // and `{}` are refused by the fail-closed default whether the type is checked
  // or not, so on their own they would prove nothing -- but a value that
  // stringifies to `8.8.8.8` is read as a public address the moment the type
  // check goes, which is exactly the shape a decorative test would miss.
  assert.ok(
    isForbiddenAddress({ toString: () => '8.8.8.8' }),
    'an object that stringifies to a public address was accepted as a resolver answer'
  );
  assert.ok(isForbiddenAddress(null), 'null was accepted as a resolver answer');
  assert.ok(isForbiddenAddress(42), '42 was accepted as a resolver answer');
  assert.ok(isForbiddenAddress({}), 'an object was accepted as a resolver answer');
});

const resolutionTests = [];

resolutionTests.push(
  test('a name that resolves to public addresses is allowed through', async () => {
    // The positive control for this whole section: without it, every refusal
    // below would pass against a check that refused every name there is and
    // took the nightly job down with it.
    assert.deepStrictEqual(
      await assertTargetResolves(TRUSTED_TARGET, resolvesTo('8.233.44.232', '2606:4700::1111')),
      ['8.233.44.232', '2606:4700::1111']
    );
  })
);

resolutionTests.push(
  test('a hostname resolving into a forbidden range is refused, naming the name AND the address', async () => {
    await assert.rejects(
      () => fetchAbciVersion(TRUSTED_RPC, TRUSTED_HOSTS, resolvesTo('127.0.0.1')),
      error => {
        assert.ok(
          error.message.includes('allora-rpc.testnet.allora.network'),
          `the refusal must name the hostname: ${error.message}`
        );
        assert.ok(
          error.message.includes('127.0.0.1'),
          `the refusal must name the offending resolved address: ${error.message}`
        );
        return true;
      }
    );
  })
);

resolutionTests.push(
  test('ANY forbidden address refuses the name, not just the first one', async () => {
    // Happy Eyeballs picks from the whole answer, so checking records[0] is not
    // checking anything.
    await assert.rejects(
      () => fetchAbciVersion(TRUSTED_RPC, TRUSTED_HOSTS, resolvesTo('8.8.8.8', '2606:4700::1111', '10.1.2.3')),
      error => {
        assert.ok(
          error.message.includes('10.1.2.3'),
          `the private address later in the answer was not the one refused: ${error.message}`
        );
        return true;
      }
    );
  })
);

resolutionTests.push(
  test('a settled refusal is not retried into an answer', async () => {
    let calls = 0;
    const lookup = async (...args) => {
      calls++;
      return resolvesTo('127.0.0.1')(...args);
    };
    await assert.rejects(() => fetchAbciVersion(TRUSTED_RPC, TRUSTED_HOSTS, lookup));
    assert.strictEqual(calls, 1, `a refusal that cannot change was re-asked ${calls} times`);
  })
);

resolutionTests.push(
  test('a name resolving to nothing at all is refused', async () => {
    await assert.rejects(() => assertTargetResolves(TRUSTED_TARGET, async () => []), /resolved to no address/);
  })
);

resolutionTests.push(
  test('a resolver failure is a probe error, not a silent pass', async () => {
    await assert.rejects(
      () => assertTargetResolves(TRUSTED_TARGET, resolverFails('ENOTFOUND')),
      error => {
        assert.ok(
          error.message.includes('allora-rpc.testnet.allora.network'),
          `the failure must name what could not be resolved: ${error.message}`
        );
        assert.ok(error.message.includes('ENOTFOUND'), `the resolver's reason should survive: ${error.message}`);
        assert.ok(
          !error.forbiddenTarget,
          'a resolver that is briefly unreachable is retryable; only a refusal is settled'
        );
        return true;
      }
    );
  })
);

for (const literal of ['https://8.8.8.8/abci_info', 'https://[2606:4700::1111]/abci_info']) {
  resolutionTests.push(
    test(`the literal target ${literal} is classified directly, not resolved`, async () => {
      let called = false;
      const addresses = await assertTargetResolves(new URL(literal), async () => {
        called = true;
        return [];
      });
      assert.strictEqual(called, false, 'an address literal was handed to the resolver');
      assert.deepStrictEqual(addresses, [new URL(literal).hostname.replace(/^\[|\]$/g, '')]);
    })
  );
}

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

Promise.all([...resolutionTests, ...redirectTests]).then(() => {
  console.log(
    `\n${ran - failures}/${ran} passed ` +
      `(${forbiddenCount} hostile hosts, ${ALLOWED.length} legitimate hosts, ` +
      `${resolvedForbiddenCount} hostile resolver answers)`
  );
  if (failures > 0) {
    console.error(
      `\n${failures} case(s) FAILED. This guard is the last check before an outbound request ` +
        `from a job holding a write-capable token. Do not weaken a case to make it pass.`
    );
    process.exitCode = 1;
  }
});
