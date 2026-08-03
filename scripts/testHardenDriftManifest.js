#!/usr/bin/env node
//
// Adversarial tests for scripts/hardenDriftManifest.js.
//
// That script is a security boundary: it is the only thing standing between a
// manifest pushed to the machine-owned `networks-version-drift` branch and the
// URLs a scheduled job on the default branch will fetch, holding a write-capable
// PAT. It shipped once with a scratch test that used a friendly network name and
// ordinary `https://` URLs, and a review found a complete bypass — a network
// keyed `__proto__` carrying `"rpc": "http:169.254.169.254/"` walked through
// both of its filters and reached the cloud metadata service. Every case below
// exists because something like that was possible, or would be if a rule were
// dropped.
//
// Zero dependencies, `node:assert`, no framework. `yarn testdrift` runs this
// and the probe-guard tests next door; CI runs both on every pull request.
//
//   node scripts/testHardenDriftManifest.js

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HARDEN = path.join(__dirname, 'hardenDriftManifest.js');

const TRUSTED = {
  updated: '2026-01-01',
  docs: 'https://docs.allora.network/reference/networks',
  field_notes: { rpc: 'CometBFT RPC JSON endpoint.' },
  networks: {
    testnet: {
      name: 'Testnet',
      chain_id: 'allora-testnet-1',
      deployed_version: 'v0.17.0',
      rpc: 'https://allora-rpc.testnet.allora.network/',
      grpc: 'https://allora-grpc.testnet.allora.network/',
      lcd: 'https://allora-api.testnet.allora.network/',
      explorer: 'https://explorer.testnet.allora.network/allora-testnet-1',
      faucet: 'https://faucet.testnet.allora.network/',
      sandbox_topic_ids: [69, 77],
      abci_version: 'HEAD-trusted',
    },
  },
};

let failures = 0;
let ran = 0;

// What the script printed on the way to refusing, so a test can tell a
// deliberate refusal from a crash. Without it, `=== null` passes just as
// happily when the script dies of a typo.
let lastStderr = '';

// Runs the real script the way the workflow does, and returns what it wrote.
// `null` means it refused (non-zero exit), which for a malformed proposal is
// the correct answer -- see assertRefused, which also checks it said why.

function harden(proposed) {
  lastStderr = '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-test-'));
  try {
    const trustedPath = path.join(dir, 'trusted.json');
    const proposedPath = path.join(dir, 'proposed.json');
    const outPath = path.join(dir, 'out.json');
    fs.writeFileSync(trustedPath, JSON.stringify(TRUSTED, null, 2));
    fs.writeFileSync(
      proposedPath,
      typeof proposed === 'string' ? proposed : JSON.stringify(proposed, null, 2)
    );
    try {
      execFileSync(process.execPath, [
        HARDEN,
        `--trusted=${trustedPath}`,
        `--proposed=${proposedPath}`,
        `--out=${outPath}`,
      ], { stdio: 'pipe' });
    } catch (error) {
      lastStderr = String(error.stderr || '');
      return null;
    }
    return JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function test(name, fn) {
  ran++;
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message.split('\n').join('\n        ')}`);
  }
}

// A proposal built from the trusted manifest with one thing changed, which is
// what a real drift branch looks like.
function proposalWith(mutate) {
  const copy = JSON.parse(JSON.stringify(TRUSTED));
  mutate(copy);
  return copy;
}

// Every URL the output could possibly send a request to, whatever the shape.
function urlsIn(value, found = []) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    let parsed = null;
    try {
      parsed = new URL(trimmed);
    } catch {
      /* not a URL */
    }
    if (parsed || trimmed.startsWith('//')) found.push(trimmed);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) urlsIn(value[key], found);
  }
  return found;
}

function canonicalUrl(value) {
  const text = String(value).trim();
  try {
    return new URL(text).href;
  } catch {
    return text;
  }
}

const TRUSTED_URLS = new Set(urlsIn(TRUSTED).map(canonicalUrl));

// The whole URL, not just its host. A host comparison calls
// `https://allora-rpc.testnet.allora.network/evil/` safe because the host
// matches -- and that is a different request target, which is precisely what
// the exact-endpoint invariant exists to pin down. Path, query, port, scheme
// and userinfo all move where the request lands, so the only URLs allowed to
// appear in the output are the ones the trusted manifest actually contains.
function assertOnlyTrustedUrls(out, note) {
  for (const url of urlsIn(out)) {
    assert.ok(
      TRUSTED_URLS.has(canonicalUrl(url)),
      `${note}: output carries ${JSON.stringify(url)}, which is not one of the trusted manifest's URLs`
    );
  }
}

console.log('hardenDriftManifest: adversarial cases\n');

// ---------------------------------------------------------------------------
// Prototype-polluting keys. The `__proto__` case is the reported bypass: a
// filter written as `if (!trusted.networks[name])` finds Object.prototype for
// that key and lets the network through.
// ---------------------------------------------------------------------------

for (const key of ['__proto__', 'constructor', 'prototype', 'toString']) {
  test(`a network keyed ${key} is dropped`, () => {
    // A COMPUTED key, which creates an own property and therefore survives
    // JSON.stringify. Written as a bare `__proto__:` it would set the prototype
    // and serialise to nothing, and the case would silently test an empty
    // input -- see the field case below, which had exactly that bug.
    const raw = JSON.stringify({
      ...TRUSTED,
      networks: {
        testnet: TRUSTED.networks.testnet,
        [key]: { rpc: 'http:169.254.169.254/', abci_version: 'x' },
      },
    });
    assert.ok(raw.includes(`"${key}"`), `the hostile input does not actually carry a ${key} key`);
    const out = harden(raw);
    assert.ok(out, 'the script should have produced an output file');
    assert.deepStrictEqual(
      Object.keys(out.networks),
      ['testnet'],
      `${key} survived into the merged manifest`
    );
    assertOnlyTrustedUrls(out, key);
  });
}

test('a prototype-keyed FIELD cannot smuggle an endpoint', () => {
  // A COMPUTED key. Written as a plain `__proto__:` in an object literal it
  // sets the prototype instead of creating a property, JSON.stringify then
  // emits nothing at all, and this case tests an input it does not contain --
  // which is how it passed against the very code it was written to catch.
  const entry = { ...TRUSTED.networks.testnet, ['__proto__']: { rpc: 'http://evil.example/' } };
  assert.ok(
    Object.prototype.hasOwnProperty.call(entry, '__proto__'),
    'the hostile input does not actually carry a __proto__ own key'
  );
  const raw = JSON.stringify({ ...TRUSTED, networks: { testnet: entry } });
  assert.ok(raw.includes('"__proto__"'), 'the hostile input did not survive serialisation');

  const out = harden(raw);
  assert.ok(out, 'the script should have produced an output file');
  assertOnlyTrustedUrls(out, '__proto__ field');
});

// ---------------------------------------------------------------------------
// URL forms. The scheme-less one is the other half of the reported bypass:
// `new URL('abci_info', 'http:169.254.169.254/')` resolves to a live target,
// but it does not match a pattern that expects `://`.
// ---------------------------------------------------------------------------

const HOSTILE_URLS = [
  'http:169.254.169.254/',            // scheme, no slashes -- the reported bypass
  'https:evil.example/',              // same shape over https
  'http://169.254.169.254/',          // the plain form
  'http://127.0.0.1:8500/',           // the runner's loopback
  'https://evil.example/',            // a different host entirely
  'https://allora-rpc.testnet.allora.network.evil.example/', // suffix lookalike
  'https://user:pw@allora-rpc.testnet.allora.network/',      // credentials bolted on
  'HTTP:169.254.169.254/',            // case
  '  http:169.254.169.254/  ',        // padded
  // Same host, different target. These are the ones a host-only comparison
  // calls safe, and every one of them moves where `new URL('abci_info', rpc)`
  // actually lands.
  'https://allora-rpc.testnet.allora.network/evil/',        // path
  'https://allora-rpc.testnet.allora.network/?to=evil',     // query
  'https://allora-rpc.testnet.allora.network:8443/',        // port
  'http://allora-rpc.testnet.allora.network/',              // scheme downgrade
  'https://allora-rpc.testnet.allora.network/#evil',        // fragment
];

for (const hostile of HOSTILE_URLS) {
  test(`rpc = ${JSON.stringify(hostile)} is replaced by the trusted endpoint`, () => {
    const out = harden(proposalWith(m => {
      m.networks.testnet.rpc = hostile;
    }));
    assert.ok(out, 'the script should have produced an output file');
    assert.strictEqual(
      out.networks.testnet.rpc,
      TRUSTED.networks.testnet.rpc,
      'the branch chose the endpoint'
    );
    assertOnlyTrustedUrls(out, hostile);
  });
}

test('a scheme-relative URL in a new field is dropped', () => {
  const out = harden(proposalWith(m => {
    m.networks.testnet.rpc_backup = '//evil.example/abci_info';
  }));
  assert.ok(out, 'the script should have produced an output file');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(out.networks.testnet, 'rpc_backup'),
    'a //-relative destination survived'
  );
  assertOnlyTrustedUrls(out, 'scheme-relative');
});

test('an endpoint the trusted manifest does not have at all is dropped', () => {
  const out = harden(proposalWith(m => {
    m.networks.testnet.metrics = 'https://evil.example/metrics';
  }));
  assert.ok(out, 'the script should have produced an output file');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(out.networks.testnet, 'metrics'),
    'an invented endpoint survived'
  );
  assertOnlyTrustedUrls(out, 'invented endpoint');
});

test('URLs hidden in an array are dropped', () => {
  const out = harden(proposalWith(m => {
    m.networks.testnet.rpc_fallbacks = ['http://evil.example/a', 'http:169.254.169.254/'];
  }));
  assert.ok(out, 'the script should have produced an output file');
  assertOnlyTrustedUrls(out, 'array');
});

// ---------------------------------------------------------------------------
// Every URL-bearing field, not just rpc: the response is echoed into the pull
// request body, so any of them is an exfiltration channel.
// ---------------------------------------------------------------------------

for (const field of ['rpc', 'grpc', 'lcd', 'explorer', 'faucet']) {
  test(`a host swap on ${field} is reverted`, () => {
    const out = harden(proposalWith(m => {
      m.networks.testnet[field] = 'https://evil.example/';
    }));
    assert.ok(out, 'the script should have produced an output file');
    assert.strictEqual(out.networks.testnet[field], TRUSTED.networks.testnet[field]);
    assertOnlyTrustedUrls(out, `host swap on ${field}`);
  });
}

test('the top-level docs URL is reverted', () => {
  const out = harden(proposalWith(m => {
    m.docs = 'https://evil.example/collect';
  }));
  assert.ok(out, 'the script should have produced an output file');
  assert.strictEqual(out.docs, TRUSTED.docs);
  assertOnlyTrustedUrls(out, 'docs');
});

// ---------------------------------------------------------------------------
// Wrong types where a shape is expected. None of these may crash the script or
// let a value through untouched.
// ---------------------------------------------------------------------------

test('a non-string rpc is replaced by the trusted endpoint', () => {
  for (const value of [42, null, true, ['https://evil.example/'], { href: 'https://evil.example/' }]) {
    const out = harden(proposalWith(m => {
      m.networks.testnet.rpc = value;
    }));
    assert.ok(out, `the script refused ${JSON.stringify(value)} instead of replacing it`);
    assert.strictEqual(out.networks.testnet.rpc, TRUSTED.networks.testnet.rpc);
    assertOnlyTrustedUrls(out, JSON.stringify(value));
  }
});

test('an array where a network entry belongs falls back to the trusted entry', () => {
  const out = harden(proposalWith(m => {
    m.networks.testnet = ['https://evil.example/'];
  }));
  assert.ok(out, 'the script should have produced an output file');
  assert.strictEqual(out.networks.testnet.rpc, TRUSTED.networks.testnet.rpc);
  assertOnlyTrustedUrls(out, 'array network entry');
});

// `=== null` only says the script exited non-zero, which a crash also does.
// Each of these also checks it refused on purpose, with a workflow-visible
// annotation naming the reason.
function assertRefused(proposed, because) {
  assert.strictEqual(harden(proposed), null, 'the script produced an output file instead of refusing');
  assert.ok(
    lastStderr.includes('::error::'),
    `expected a deliberate ::error:: refusal, got: ${lastStderr.trim() || '(nothing)'}`
  );
  assert.ok(
    lastStderr.includes(because),
    `expected the refusal to mention ${JSON.stringify(because)}, got: ${lastStderr.trim()}`
  );
}

test('an array where the networks map belongs is refused outright', () => {
  assertRefused({ ...TRUSTED, networks: [] }, 'no "networks" object');
});

test('a proposal with no networks map is refused outright', () => {
  assertRefused({ nope: true }, 'no "networks" object');
});

test('invalid JSON is refused outright', () => {
  assertRefused('{not json', 'not valid JSON');
});

// ---------------------------------------------------------------------------
// The other half of the contract. If the merge only ever returned the trusted
// manifest it would pass every test above and be useless: the whole reason the
// branch copy is read is that a reviewer's edits on the open pull request have
// to survive.
// ---------------------------------------------------------------------------

test('a legitimate value-only edit crosses over untouched', () => {
  const out = harden(proposalWith(m => {
    m.networks.testnet.abci_version = 'HEAD-proposed-by-the-branch';
    m.networks.testnet.deployed_version = 'v0.17.1';
    m.updated = '2026-02-02';
  }));
  assert.ok(out, 'the script should have produced an output file');
  assert.strictEqual(out.networks.testnet.abci_version, 'HEAD-proposed-by-the-branch');
  assert.strictEqual(out.networks.testnet.deployed_version, 'v0.17.1');
  assert.strictEqual(out.updated, '2026-02-02');
  assert.strictEqual(out.networks.testnet.rpc, TRUSTED.networks.testnet.rpc);
});

test('prose that merely looks scheme-like is left alone', () => {
  const out = harden(proposalWith(m => {
    m.field_notes.rpc = 'Note: the CometBFT RPC endpoint.';
    m.field_notes.added = 'Warning: prose the trusted manifest has never had.';
  }));
  assert.ok(out, 'the script should have produced an output file');
  assert.strictEqual(out.field_notes.rpc, 'Note: the CometBFT RPC endpoint.');
  assert.strictEqual(out.field_notes.added, 'Warning: prose the trusted manifest has never had.');
});

test('a non-URL array is preserved', () => {
  const out = harden(proposalWith(m => {
    m.networks.testnet.sandbox_topic_ids = [69, 77, 88];
  }));
  assert.ok(out, 'the script should have produced an output file');
  assert.deepStrictEqual(out.networks.testnet.sandbox_topic_ids, [69, 77, 88]);
});

test('an unchanged proposal comes back unchanged', () => {
  const out = harden(proposalWith(() => {}));
  assert.ok(out, 'the script should have produced an output file');
  assert.deepStrictEqual(out.networks.testnet, TRUSTED.networks.testnet);
});

// ---------------------------------------------------------------------------

console.log(`\n${ran - failures}/${ran} passed`);
if (failures > 0) {
  console.error(
    `\n${failures} adversarial case(s) FAILED. scripts/hardenDriftManifest.js is the only thing ` +
      `between a machine-owned branch and the URLs the nightly drift job fetches while holding a ` +
      `write-capable token. Do not weaken a case to make it pass.`
  );
  process.exitCode = 1;
}
