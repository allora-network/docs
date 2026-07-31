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

// Base URLs, chain IDs, and the per-network `emissions` API version segment.
// Source of truth: pages/reference/networks.mdx (the emissions version differs
// per network because the networks run different allora-chain releases).
const NETWORKS = [
  {
    network: 'testnet',
    chain_id: 'allora-testnet-1',
    emissions_api: 'v10',
    lcd: 'https://allora-api.testnet.allora.network',
  },
  {
    network: 'mainnet',
    chain_id: 'allora-mainnet-1',
    emissions_api: 'v9',
    lcd: 'https://allora-api.mainnet.allora.network',
  },
];

// Sandbox ("playground") topics: no whitelist, no penalties, intended for a
// first worker submission. The chain exposes no sandbox flag, so this is the
// documented list of sandbox topic IDs — keep it in sync with the
// "Start here: the sandbox topic" section of pages/build/forge/topics.mdx.
const SANDBOX_TOPIC_IDS = {
  testnet: [69, 77],
  mainnet: [],
};

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
      `response — re-check ${net.lcd}/emissions/${net.emissions_api} by hand.`
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

async function fetchNetworkTopics(net) {
  const base = `${net.lcd}/emissions/${net.emissions_api}`;
  const sandboxIds = new Set(SANDBOX_TOPIC_IDS[net.network] || []);

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
    `${net.network} (${net.chain_id}, emissions/${net.emissions_api}): ` +
      `${highestId} topics scanned, ${activeIds.length} active\n`
  );

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
      sandbox: sandboxIds.has(topicId),
    };
  });

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
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check');

  const perNetwork = [];
  for (const net of NETWORKS) {
    perNetwork.push(await fetchNetworkTopics(net));
  }

  const data = {
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: 'Cosmos LCD (REST) emissions API: next_topic_id, is_topic_active, topics',
    networks: NETWORKS.map((net, i) => ({
      network: net.network,
      chain_id: net.chain_id,
      emissions_api: net.emissions_api,
      lcd: net.lcd,
      active_topic_count: perNetwork[i].length,
    })),
    // Deterministic ordering: network (testnet, then mainnet), then numeric id.
    topics: perNetwork.flat(),
  };

  const existing = readExisting();
  const unchanged = existing !== null && payloadOf(existing) === payloadOf(data);
  const relativePath = path.relative(path.join(__dirname, '..'), OUTPUT_PATH);

  if (unchanged) {
    process.stdout.write(`${relativePath} is up to date (${data.topics.length} active topics)\n`);
    return;
  }

  if (checkOnly) {
    process.stderr.write(`${relativePath} is stale — run: node scripts/generateTopics.js\n`);
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
