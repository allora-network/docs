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
//   * every URL-valued field is taken from the trusted manifest. If the trusted
//     manifest has no URL at that path, the field is dropped rather than
//     carried over -- an endpoint that only the branch knows about is exactly
//     the thing this exists to refuse.
//   * a network the trusted manifest does not define is dropped whole. It has
//     no trusted endpoint to probe, so there is nothing legitimate to compare.
//   * everything else (abci_version, deployed_version, prose) is taken from the
//     branch, which is the point: a reviewer's edits on the open pull request
//     survive, and an unchanged chain stays a no-op.
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

// A destination, not a value: a scheme followed by `//`. Matching the shape
// rather than a scheme allowlist means a protocol nobody thought of is caught
// too. The `//` matters: without it, ordinary prose beginning "Note: ..." or
// "Warning: ..." reads as a URL, and a field note the trusted manifest happens
// not to have would then be deleted from the file committed back to the branch.
function looksLikeUrl(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

// Walk the proposed document. Two rules, in this order:
//
//   1. wherever the TRUSTED document holds a string, the trusted string wins if
//      it is a URL. This is the invariant that matters: an endpoint main knows
//      about can never be redirected, whatever the branch put there -- prose,
//      a URL, or something that only resembles one.
//   2. otherwise, a value that looks like a URL and has no trusted counterpart
//      is dropped: an endpoint only the branch knows about is exactly the thing
//      this exists to refuse.
//
// Arrays are walked as well as objects. Nothing in an array is fetched today,
// but "endpoints come from the trusted side" is meant to be a property of the
// whole document, not of the fields that happen to exist right now.
function forceEndpoints(proposed, trusted, path, changes) {
  const keys = Array.isArray(proposed) ? proposed.map((_, i) => i) : Object.keys(proposed);
  for (const key of keys) {
    const here = path ? `${path}.${key}` : String(key);
    const mine = proposed[key];
    const theirs = trusted && typeof trusted === 'object' ? trusted[key] : undefined;

    if (looksLikeUrl(theirs)) {
      if (mine !== theirs) {
        changes.push(`${here}: replaced with the trusted endpoint`);
        proposed[key] = theirs;
      }
      continue;
    }
    if (looksLikeUrl(mine)) {
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

  if (!isPlainObject(trusted) || !isPlainObject(trusted.networks)) {
    fail(`The trusted manifest (${opts.trusted}) has no "networks" object.`);
  }
  if (!isPlainObject(proposed) || !isPlainObject(proposed.networks)) {
    fail(
      `The proposed manifest (${opts.proposed}) has no "networks" object, so it ` +
        `is not a networks manifest at all. Refusing to merge it.`
    );
  }

  const changes = [];

  // A network the trusted manifest does not define has no trusted endpoint, so
  // there is nothing to probe and nothing to compare.
  for (const network of Object.keys(proposed.networks)) {
    if (!isPlainObject(trusted.networks[network])) {
      delete proposed.networks[network];
      changes.push(`networks.${network}: dropped (not a network the trusted manifest defines)`);
    }
  }

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
