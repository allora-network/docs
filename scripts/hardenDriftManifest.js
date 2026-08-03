#!/usr/bin/env node
//
// Merge an untrusted copy of public/api/networks.json onto the trusted one,
// keeping every endpoint from the trusted side.
//
// The nightly drift job compares each network's recorded version against what
// its RPC reports. When a drift pull request is already open it compares against
// what that pull request proposes, so the manifest from that branch has to reach
// the job somehow -- and that branch is machine-owned: anyone with repository
// write access can push to it. Handing its manifest to the checker unfiltered
// would let it choose the URLs a scheduled job on the default branch fetches:
// a link-local metadata address, a service bound to the runner's loopback, an
// endpoint that logs whatever is sent to it. The response is then written into
// the manifest and published in the pull request body, so a read is an
// exfiltration channel too.
//
// So the branch's copy decides values, never destinations:
//
//   * the set of networks is an ALLOWLIST taken from the trusted manifest. The
//     output is rebuilt from the trusted key set rather than filtered from the
//     proposed one, so no key the branch invents can appear in it at all -- not
//     an extra network, and not a key like `__proto__` that a filter written as
//     `if (!trusted.networks[name])` would wave through, because that lookup
//     finds Object.prototype rather than nothing.
//   * every URL-valued field is taken from the trusted manifest. If the trusted
//     manifest has no URL at that path, any value that PARSES as a URL is
//     dropped rather than carried over. Parsing, not pattern-matching: the
//     scheme-less `http:169.254.169.254/` does not look like a URL to a regex
//     that wants `://`, but `new URL('abci_info', that)` resolves it to
//     `http://169.254.169.254/abci_info`, which is a live fetch target.
//   * everything else (abci_version, deployed_version, prose) is taken from the
//     branch, which is the point: a reviewer's edits on the open pull request
//     survive, and an unchanged chain stays a no-op.
//
// Every key that comes from the proposed document is treated as hostile,
// including `__proto__`, `constructor` and `prototype`: reads from the trusted
// side always go through hasOwnProperty, and the objects this builds have a
// null prototype so there is nothing to inherit in the first place.
//
// scripts/testHardenDriftManifest.js holds the adversarial cases. Run it (or
// `yarn testharden`) after touching anything here.
//
// Usage:
//   node scripts/hardenDriftManifest.js --trusted <path> --proposed <path> --out <path>
//
// Exits 1 with a workflow-visible ::error:: when the proposed file is unusable.

const fs = require('fs');

function parseArgs(argv) {
  const opts = { trusted: null, proposed: null, out: null };
  for (const arg of argv) {
    const match = arg.match(/^--(trusted|proposed|out)=(.*)$/);
    if (match) opts[match[1]] = match[2];
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  for (const [name, value] of Object.entries(opts)) {
    if (!value) {
      console.error(`Missing --${name}=<path>`);
      process.exit(2);
    }
  }
  return opts;
}

function fail(message) {
  // ::error:: so it lands as an annotation on the workflow run, not just in the
  // step log where a scheduled job's failure is easy to miss.
  console.error(`::error::${message}`);
  process.exit(1);
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail(`Could not read the ${label} manifest (${file}): ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`The ${label} manifest (${file}) is not valid JSON: ${error.message}`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Reads from the trusted side always go through this. `trusted[key]` alone is
// how the first version of this file was bypassed: for key `__proto__` it
// returns Object.prototype instead of undefined, and every "is there a trusted
// counterpart?" test then answers yes.
const hasOwn = (object, key) =>
  Boolean(object) && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);

const own = (object, key) => (hasOwn(object, key) ? object[key] : undefined);

// Does this value resolve to somewhere a request could be sent? Answered by
// parsing, not by matching a shape. `new URL()` is the same resolver the drift
// checker uses, so anything it accepts is a destination by definition --
// including `http:169.254.169.254/`, which has no `//` and fooled the regex
// this replaces. Prose ("Note: ...", "Warning: ...") does not parse, so it is
// still just a value.
function asUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

// A scheme-relative reference (`//host/path`) is not an absolute URL, so it
// does not parse on its own -- but it names a host, and resolving it against
// any base would reach that host. Treated as a destination for the same reason.
function isSchemeRelative(value) {
  return typeof value === 'string' && value.trim().startsWith('//');
}

// A destination this job could actually be made to request. `new URL()` accepts
// far more than that -- `note:` and `warning:` parse perfectly well, which is
// why an earlier version of this test dropped ordinary prose out of the
// manifest -- so the question is narrowed to what `fetch` will act on: http and
// https. A value with any other scheme cannot become a request, because
// resolving a relative path against an opaque-path base throws before fetch is
// even reached.
function isDestination(value) {
  const url = asUrl(value);
  if (url) return url.protocol === 'http:' || url.protocol === 'https:';
  return isSchemeRelative(value);
}

// Whether a proposed value may stand where the trusted manifest holds a URL.
//
// Only the trusted string itself, character for character. Comparing scheme and
// host was not enough: `https://user:pw@allora-rpc.testnet.allora.network/` has
// the same scheme and the same `host` -- userinfo is not part of it -- and so
// did any change to the path, the port or the query, each of which redirects
// where `new URL('abci_info', rpc)` actually lands. There is no version of "a
// different endpoint that is still the same endpoint", and the documented
// contract is already that endpoints move on the default branch, not on the
// machine branch.
function matchesTrustedEndpoint(proposedValue, trustedValue) {
  return typeof proposedValue === 'string' && proposedValue.trim() === String(trustedValue).trim();
}

// Walk the proposed document. Two rules, in this order:
//
//   1. wherever the TRUSTED document holds a URL, the proposed value must parse
//      to the same scheme and host or it is replaced by the trusted one. This
//      is the invariant that matters: an endpoint main knows about can never be
//      redirected, whatever the branch put there.
//   2. otherwise, a value that resolves to a destination and has no trusted
//      counterpart is dropped: an endpoint only the branch knows about is
//      exactly the thing this exists to refuse.
//
// Arrays are walked as well as objects. Nothing in an array is fetched today,
// but "endpoints come from the trusted side" is meant to be a property of the
// whole document, not of the fields that happen to exist right now.
function forceEndpoints(proposed, trusted, path, changes) {
  const keys = Array.isArray(proposed) ? proposed.map((_, index) => index) : Object.keys(proposed);
  for (const key of keys) {
    const here = path ? `${path}.${key}` : String(key);
    const mine = Array.isArray(proposed) ? proposed[key] : own(proposed, key);
    const theirs = Array.isArray(trusted) ? trusted[key] : own(trusted, key);
    // Rule 1 keys on the TRUSTED side parsing as a URL of any scheme: if main
    // says this field is a destination, the branch does not get to move it.
    // (Unlike rule 2 below, this only ever pins a value to the trusted one, so
    // a scheme like `note:` matching here costs nothing.)
    const trustedUrl = asUrl(theirs);

    if (trustedUrl) {
      if (!matchesTrustedEndpoint(mine, theirs)) {
        changes.push(`${here}: replaced with the trusted endpoint`);
        proposed[key] = theirs;
      }
      continue;
    }
    if (isDestination(mine)) {
      changes.push(`${here}: dropped (the trusted manifest has no endpoint here)`);
      if (Array.isArray(proposed)) proposed[key] = null;
      else delete proposed[key];
      continue;
    }

    if (mine && typeof mine === 'object') forceEndpoints(mine, theirs, here, changes);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const trusted = readJson(opts.trusted, 'trusted');
  const proposed = readJson(opts.proposed, 'proposed');

  // own() rather than dot access even here, so this file contains no bare read
  // of a manifest-supplied structure anywhere -- there is no second place for
  // the prototype-lookup bug to come back.
  const trustedNetworks = own(trusted, 'networks');
  const proposedNetworks = own(proposed, 'networks');

  if (!isPlainObject(trusted) || !isPlainObject(trustedNetworks)) {
    fail(`The trusted manifest (${opts.trusted}) has no "networks" object.`);
  }
  if (!isPlainObject(proposed) || !isPlainObject(proposedNetworks)) {
    fail(
      `The proposed manifest (${opts.proposed}) has no "networks" object, so it ` +
        `is not a networks manifest at all. Refusing to merge it.`
    );
  }

  const changes = [];

  // Rebuild the network set from the TRUSTED key list rather than filtering the
  // proposed one. An allowlist cannot be walked past: a key the branch invents
  // is not merely rejected, it is never consulted. The previous version filtered
  // -- `if (!isPlainObject(trusted.networks[name])) delete ...` -- and a network
  // keyed `__proto__` survived it, because that lookup returns Object.prototype
  // and Object.prototype is, by every structural test, a plain object.
  //
  // Null prototype on the rebuilt map for the same reason: assigning a key
  // called `__proto__` on an ordinary object mutates the prototype instead of
  // adding a property, which is not a behaviour worth reasoning about here.
  const mergedNetworks = Object.create(null);
  for (const network of Object.keys(trustedNetworks)) {
    const trustedEntry = own(trustedNetworks, network);
    if (!isPlainObject(trustedEntry)) continue;
    const proposedEntry = own(proposedNetworks, network);
    mergedNetworks[network] = isPlainObject(proposedEntry) ? proposedEntry : trustedEntry;
    if (!isPlainObject(proposedEntry)) {
      changes.push(
        `networks.${network}: taken from the trusted manifest (the proposed one has no usable entry)`
      );
    }
  }
  for (const network of Object.keys(proposedNetworks)) {
    if (!hasOwn(mergedNetworks, network)) {
      changes.push(`networks.${network}: dropped (not a network the trusted manifest defines)`);
    }
  }
  proposed.networks = mergedNetworks;

  forceEndpoints(proposed, trusted, '', changes);

  fs.writeFileSync(opts.out, `${JSON.stringify(proposed, null, 2)}\n`, 'utf8');

  if (changes.length === 0) {
    console.log(
      'Merged the proposed manifest: every endpoint in it already matched the trusted manifest.'
    );
  } else {
    console.log(`Merged the proposed manifest, overriding ${changes.length} field(s):`);
    changes.forEach(change => console.log(`  ${change}`));
  }
  console.log(
    'Values (abci_version, deployed_version, prose) come from the proposed manifest; ' +
      'every endpoint comes from the trusted one.'
  );
}

main();
