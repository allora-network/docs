---
title: Existing Allora Network Topics
description: Live topic tables for Allora testnet and mainnet — topic IDs, metadata, epoch lengths, loss methods, and categories — plus how to verify a topic's status.
persona: ML builder
verified_against: public/api/topics.json, regenerated from live chain state via Cosmos LCD (testnet allora-testnet-1 emissions/v10, mainnet allora-mainnet-1 emissions/v9)
last_reviewed: 2026-07-30
---

# Existing Allora Network Topics

> Topics currently active on the Allora Network

The tables below list every topic that is **active** on each Allora network, with its topic ID,
on-chain metadata (name), epoch length (in blocks), loss method, and category (price / log-return /
volatility). Each [Forge competition](https://docs.allora.network/build/forge/competitions) targets one of these live topics.

These tables are generated from live chain state, not maintained by hand. A scheduled job queries the
[Cosmos LCD (REST) API](https://docs.allora.network/reference/networks) of each network (testnet `allora-testnet-1` via
`emissions/v10`, mainnet `allora-mainnet-1` via `emissions/v9`), keeps only topics whose
`is_topic_active` query returns `true`, and publishes the result at `/api/topics.json` — the same
data this page renders. The data below last changed
on **<TopicsGeneratedOn />**. Topics activate and deactivate over time, so
[verify a topic's status](#verify-a-topics-status) before building against it.

## Start here: the sandbox topic

Testnet topic **69** (`PLAYGROUND: 1 day BTC/USD Price Prediction`) is the no-penalty sandbox
onboarding topic: a playground for making your first worker submissions, with no whitelist
required. Testnet topic **77** (`PLAYGROUND FAST - 5 minute BTC/USD Price Prediction`) is its
fast-epoch counterpart for quicker feedback loops. Both are marked `sandbox` in the table below.

## Testnet topics (`allora-testnet-1`)

<TopicsCount network="testnet" /> active topics.

## Mainnet topics (`allora-mainnet-1`)

<TopicsCount network="mainnet" /> active topics.

**Warning**: Topic IDs are never guaranteed to be consistent between separate chains/deployments.
The same prediction task can have different topic IDs on testnet and mainnet (for example,
`BTC/USD - Log Returns - 8h` is topic 83 on testnet and topic 1 on mainnet).

## Verify a topic's status

Query the live chain to confirm a topic's current definition and active status. Note that the
`emissions` API version segment differs by network (see [Networks](https://docs.allora.network/reference/networks)):

```bash
# Testnet (emissions/v10)
curl -s https://allora-api.testnet.allora.network/emissions/v10/topics/69
curl -s https://allora-api.testnet.allora.network/emissions/v10/is_topic_active/69

# Mainnet (emissions/v9)
curl -s https://allora-api.mainnet.allora.network/emissions/v9/topics/1
curl -s https://allora-api.mainnet.allora.network/emissions/v9/is_topic_active/1
```

To consume the same list programmatically, fetch the published JSON instead of scraping this page:

```bash
curl -s https://docs.allora.network/api/topics.json
```

## Next

- Deploy a worker on the sandbox topic: [build a price prediction worker](https://docs.allora.network/build/worker/sdk-py)
- Compete on a live topic: [Forge competitions](https://docs.allora.network/build/forge/competitions)
- Need a topic that doesn't exist yet? [Create your own](https://docs.allora.network/operate/topics/create)
