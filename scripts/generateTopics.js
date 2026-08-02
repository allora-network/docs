#!/usr/bin/env node
/**
 * Generates `public/api/topics.json` (served at `/api/topics.json`) from live
 * chain state, so the topics table in the docs can be rendered from data
 * instead of being maintained by hand.
 *
 * Query method (Cosmos LCD / REST, identical to the `curl` commands documented
 * on the "Existing Allora Network Topics" page and to the `allorad q emissions`
 * RPC methods documented under Operate → Topics):
 *
 *   1. GET {lcd}/emissions/{v}/next_topic_id      -> GetNextTopicId
 *   2. for id in 1 .. next_topic_id - 1:
 *        GET {lcd}/emissions/{v}/is_topic_active/{id}  -> IsTopicActive
 *   3. for every active id:
 *        GET {lcd}/emissions/{v}/topics/{id}           -> GetTopic
 *
 * `{lcd}` and `emissions/{v}` come from public/api/networks.json, one entry per
 * network — never from a copy kept here (see readNetworks below).
 *
 * No dependencies (Node 20 global `fetch`), no credentials: every endpoint is
 * a public read.
 *
 * Usage:
 *   node scripts/generateTopics.js            # write public/api/topics.json
 *   node scripts/generateTopics.js --check    # exit 1 if the file is stale
 *
 * The file is only rewritten when the topic data actually changed, so a nightly
 * run against an unchanged chain produces an empty diff. `generated_at` is
 * therefore the timestamp of the last run that *changed* the data.
 */

const fs = require('fs');
const path = require('path');

// Where to query, read from public/api/networks.json — the endpoints manifest
// /reference/networks renders and the network-drift job maintains.
//
// These used to be hardcoded here, which made this file a second, silent copy
// of facts the manifest already owns. The emissions namespace differs per
// network because the networks run different allora-chain releases, so it moves
// with every upgrade: once the manifest said `emissions/v11` and this constant
// still said v10, the nightly job went on querying a retired API — every
// request failing against a namespace nobody serves any more, and the published
// topic tables quietly frozen at whatever they last were. One manifest, one
// answer.
const NETWORKS_MANIFEST = path.join(__dirname, '..', 'public', 'api', 'networks.json');
const MANIFEST_RELATIVE = path.relative(path.join(__dirname, '..'), NETWORKS_MANIFEST);

// The documented shape of `emissions_namespace` — the manifest's own
// field_notes give `<lcd>/emissions/v10/params` as the example. The version
// segment is pulled back out of it for the `emissions_api` field this script
// publishes, so anything else has to stop the run rather than be guessed at.
const EMISSIONS_NAMESPACE = /^emissions\/(v\d+)$/;

function manifestField(network, entry, field) {
  const value = entry[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${MANIFEST_RELATIVE} networks.${network} has no "${field}" string ` +
        `(got ${JSON.stringify(value)}). That file decides where this job queries; ` +
        'fix it there rather than hardcoding a value here.'
    );
  }
  return value.trim();
}

function readNetworks() {
  if (!fs.existsSync(NETWORKS_MANIFEST)) {
    throw new Error(`${MANIFEST_RELATIVE} is missing, so there is nowhere to query.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(NETWORKS_MANIFEST, 'utf8'));
  } catch (error) {
    throw new Error(`${MANIFEST_RELATIVE} is not valid JSON: ${error.message}`);
  }

  const networks = parsed && parsed.networks;
  if (!networks || typeof networks !== 'object' || Array.isArray(networks)) {
    throw new Error(`${MANIFEST_RELATIVE} has no "networks" object.`);
  }

  const names = Object.keys(networks);
  if (names.length === 0) {
    throw new Error(`${MANIFEST_RELATIVE} defines no networks.`);
  }

  return names.map(name => {
    const entry = networks[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${MANIFEST_RELATIVE} networks.${name} is not an object.`);
    }

    const namespace = manifestField(name, entry, 'emissions_namespace');
    const version = EMISSIONS_NAMESPACE.exec(namespace);
    if (!version) {
      throw new Error(
        `${MANIFEST_RELATIVE} networks.${name}.emissions_namespace is ` +
          `${JSON.stringify(namespace)}, which is not of the form "emissions/v<N>". ` +
          'Refusing to guess which API version to query.'
      );
    }

    return {
      network: name,
      chain_id: manifestField(name, entry, 'chain_id'),
      emissions_api: version[1],
      namespace,
      // The manifest writes the LCD with a trailing slash; the query paths
      // below add their own separator.
      lcd: manifestField(name, entry, 'lcd').replace(/\/+$/, ''),
      sandbox: sandboxIds(name, entry),
    };
  });
}

// Sandbox ("playground") topics: no whitelist, no penalties, intended for a
// first worker submission. The chain exposes no sandbox flag, so the fact has
// to be declared by hand — but it was declared in three places at once (a
// constant here, and the topic IDs spelled out in the prose of two pages), so
// activating a new sandbox topic meant remembering all three. Miss this one and
// topics.json simply omits the flag: the badge disappears from the table and no
// gate says a word.
//
// Now it is declared once, in public/api/networks.json beside the network's
// other hand-maintained facts. This job marks the rows; every page renders the
// list from the marked rows. One declaration, one answer.
function sandboxIds(network, entry) {
  const ids = entry.sandbox_topic_ids;
  if (!Array.isArray(ids)) {
    throw new Error(
      `${MANIFEST_RELATIVE} networks.${network} has no "sandbox_topic_ids" array ` +
        `(got ${JSON.stringify(ids)}). Use [] for a network with no sandbox topics; ` +
        'this file is the only place the list is declared.'
    );
  }
  ids.forEach(id => {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error(
        `${MANIFEST_RELATIVE} networks.${network}.sandbox_topic_ids contains ` +
          `${JSON.stringify(id)}, which is not a topic ID.`
      );
    }
  });
  return new Set(ids);
}

const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'api', 'topics.json');

const CONCURRENCY = 8;
const RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Category shown in the topics table. The chain stores no category field, so
 * it is derived from the topic's on-chain `metadata` string using the same
 * three buckets the hand-maintained table used.
 */
function categoryFor(metadata) {
  const m = metadata.toLowerCase();
  if (m.includes('volatility')) return 'volatility';
  if (m.includes('log return') || m.includes('log-return')) return 'log-return';
  return 'price';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error(`GET ${url} failed after ${RETRIES} attempts: ${lastError.message}`);
}

/** Runs `worker` over `items` with a bounded number of in-flight requests. */
async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Every response shape is asserted before its values are used. A renamed or
 * dropped field must fail the run loudly: silently coercing a missing
 * `is_active` to `false` would publish an empty table and the nightly job
 * would open a green PR deleting every row.
 */
function fail(net, message) {
  throw new Error(
    `${net.network}: ${message}. Refusing to publish a topics table from this ` +
      `response — re-check ${net.lcd}/${net.namespace} by hand.`
  );
}

/** A Cosmos LCD numeric field: a string of digits (or a plain number). */
function requireUint(net, value, where) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(net, `${where} is not an unsigned integer (got ${JSON.stringify(value)})`);
  }
  return parsed;
}

function requireString(net, value, where) {
  if (typeof value !== 'string') {
    fail(net, `${where} is not a string (got ${JSON.stringify(value)})`);
  }
  return value;
}

// A topic's name is free text set by whoever created it — the only value in
// this file that comes from outside the repository. It is published verbatim in
// topics.json (JSON escapes it safely) and normalised where it becomes
// documentation syntax, in scripts/lib/docsPages.js.
//
// Nothing here rejects a topic over its name: anyone able to create one could
// then stop the docs refreshing for everybody, which is a worse outcome than an
// odd-looking row. It does say so, though — a control character or a name this
// long deserves a human's attention even when it renders harmlessly.
const NOTEWORTHY_TEXT = /[\p{Cc}\p{Cf}]/u;
const LONG_TEXT = 200;

function noteUntrustedText(net, topics) {
  topics
    .filter(
      topic => NOTEWORTHY_TEXT.test(topic.metadata) || topic.metadata.length > LONG_TEXT
    )
    .forEach(topic => {
      process.stdout.write(
        `${net.network}: topic ${topic.id} has metadata carrying control characters or ` +
          `over ${LONG_TEXT} characters (${JSON.stringify(topic.metadata.slice(0, 60))}…) — ` +
          'published as-is in topics.json, normalised in the generated markdown\n'
      );
    });
}

async function fetchNetworkTopics(net) {
  const base = `${net.lcd}/${net.namespace}`;

  const nextTopicIdResponse = await getJson(`${base}/next_topic_id`);
  if (!nextTopicIdResponse || !('next_topic_id' in nextTopicIdResponse)) {
    fail(net, 'next_topic_id response has no next_topic_id field');
  }
  const highestId = requireUint(net, nextTopicIdResponse.next_topic_id, 'next_topic_id') - 1;
  if (highestId < 1) {
    fail(net, `next_topic_id is ${nextTopicIdResponse.next_topic_id}, so no topic exists`);
  }

  const candidateIds = Array.from({ length: highestId }, (_, i) => i + 1);
  const activeFlags = await mapWithConcurrency(candidateIds, async id => {
    const response = await getJson(`${base}/is_topic_active/${id}`);
    if (!response || typeof response.is_active !== 'boolean') {
      fail(net, `is_topic_active/${id} returned no boolean is_active field`);
    }
    return response.is_active;
  });
  const activeIds = candidateIds.filter((_, i) => activeFlags[i]);

  // Sanity floor: a network with zero active topics is far more likely a query
  // or response-shape regression than reality, and publishing it would wipe the
  // table. Refuse to write rather than silently emptying the page.
  if (activeIds.length === 0) {
    fail(net, `0 of ${highestId} topics reported active`);
  }

  process.stdout.write(
    `${net.network} (${net.chain_id}, ${net.namespace}): ` +
      `${highestId} topics scanned, ${activeIds.length} active\n`
  );

  // A declared sandbox topic that is no longer active is worth saying out loud
  // now that the manifest is the only copy of that list — but not worth failing
  // over: a topic can be deactivated at any time, and wedging the nightly
  // refresh would stop every other topic from updating too.
  const active = new Set(activeIds);
  const missing = [...net.sandbox].filter(id => !active.has(id));
  if (missing.length > 0) {
    process.stdout.write(
      `${net.network}: ${MANIFEST_RELATIVE} lists sandbox_topic_ids ${missing.join(', ')}, ` +
        `which ${missing.length === 1 ? 'is' : 'are'} not active — the sandbox flag will be ` +
        'absent for them until they are reactivated or the manifest is updated\n'
    );
  }

  const topics = await mapWithConcurrency(activeIds, async id => {
    const response = await getJson(`${base}/topics/${id}`);
    const topic = response && response.topic;
    if (!topic || typeof topic !== 'object') {
      fail(net, `topics/${id} returned no topic object`);
    }
    const topicId = requireUint(net, topic.id, `topics/${id}.id`);
    if (topicId !== id) {
      fail(net, `topics/${id} returned topic id ${topicId}`);
    }
    const metadata = requireString(net, topic.metadata, `topics/${id}.metadata`);
    return {
      network: net.network,
      chain_id: net.chain_id,
      id: topicId,
      metadata,
      epoch_length: requireUint(net, topic.epoch_length, `topics/${id}.epoch_length`),
      loss_method: requireString(net, topic.loss_method, `topics/${id}.loss_method`),
      category: categoryFor(metadata),
      sandbox: net.sandbox.has(topicId),
    };
  });

  noteUntrustedText(net, topics);
  topics.sort((a, b) => a.id - b.id);
  return topics;
}

/** Everything except `generated_at` — the part that decides whether to rewrite. */
function payloadOf(data) {
  const { generated_at: _ignored, ...rest } = data;
  return JSON.stringify(rest);
}

function readExisting() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The exact shape this script writes, which is also the shape everything
 * downstream assumes: components/TopicsTable.js calls `.slice(0, 10)` on it to
 * render the date, and scripts/lib/docsPages.js reads it to put that date into
 * the generated corpus.
 */
const GENERATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** The instant, in the one spelling this script writes. */
function isoSecond(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function hasUsableTimestamp(data) {
  const value = data.generated_at;
  if (typeof value !== 'string' || !GENERATED_AT.test(value)) return false;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  // Date.parse is not a calendar check: it rolls a day past the end of its
  // month forward instead of rejecting it, so "2026-02-31T00:00:00Z" parses
  // happily as March 3rd. Shape and parseability together still admit a date
  // that never existed. Round-tripping the parsed instant back to a string is
  // the check that actually holds — a normalised date no longer matches what
  // was written.
  return isoSecond(parsed) === value;
}

/** Why the committed file needs rewriting, or null when it does not. */
function stalenessOf(existing, data) {
  if (existing === null) return 'is missing or unreadable';
  // `generated_at` is excluded from the payload comparison so an unchanged
  // chain produces an empty diff. That exclusion also meant a missing or
  // malformed timestamp read as "unchanged" forever: the file was never
  // rewritten, and the page that renders it crashed on `.slice` instead. A
  // timestamp this script cannot vouch for is a reason to rewrite, not a
  // detail to skip over.
  if (!hasUsableTimestamp(existing)) {
    return `has no usable generated_at (got ${JSON.stringify(existing.generated_at)})`;
  }
  if (payloadOf(existing) !== payloadOf(data)) return 'no longer matches chain state';
  return null;
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  // Read inside main() so a malformed manifest surfaces through the same
  // one-line error path as every other failure, rather than as a stack trace at
  // require time.
  const networks = readNetworks();

  const perNetwork = [];
  for (const net of networks) {
    perNetwork.push(await fetchNetworkTopics(net));
  }

  const data = {
    generated_at: isoSecond(new Date()),
    source: 'Cosmos LCD (REST) emissions API: next_topic_id, is_topic_active, topics',
    networks: networks.map((net, i) => ({
      network: net.network,
      chain_id: net.chain_id,
      emissions_api: net.emissions_api,
      lcd: net.lcd,
      active_topic_count: perNetwork[i].length,
    })),
    // Deterministic ordering: manifest order (testnet, then mainnet), then
    // numeric id within each network.
    topics: perNetwork.flat(),
  };

  const stale = stalenessOf(readExisting(), data);
  const relativePath = path.relative(path.join(__dirname, '..'), OUTPUT_PATH);

  if (stale === null) {
    process.stdout.write(`${relativePath} is up to date (${data.topics.length} active topics)\n`);
    return;
  }

  if (checkOnly) {
    process.stderr.write(`${relativePath} ${stale} — run: node scripts/generateTopics.js\n`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
  process.stdout.write(`Wrote ${relativePath} (${data.topics.length} active topics)\n`);
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
