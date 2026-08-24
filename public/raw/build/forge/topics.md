---
title: Existing Allora Network Topics
description: Live topic tables for Allora testnet and mainnet — topic IDs, metadata, epoch lengths, loss methods, and categories — plus how to verify a topic's status.
persona: ML builder
verified_against: public/api/topics.json, regenerated from live chain state via the Cosmos LCD namespace public/api/networks.json records for each network
last_reviewed: 2026-08-19
---

# Existing Allora Network Topics

> Topics currently active on the Allora Network

The tables below list every topic that is **active** on each Allora network, with its topic ID,
on-chain metadata (name), epoch length (in blocks), loss method, and category (price / log-return /
volatility). Each [Forge competition](https://docs.allora.network/build/forge/competitions) targets one of these live topics.

These tables are generated from live chain state, not maintained by hand. A scheduled job queries the
[Cosmos LCD (REST) API](https://docs.allora.network/reference/networks) of each network, using the emissions namespace
recorded for that network in `/api/networks.json`, and keeps only topics whose
`is_topic_active` query returns `true`, and publishes the result at `/api/topics.json` — the same
data this page renders. The data below last changed
on **2026-07-31**. Topics activate and deactivate over time, so
[verify a topic's status](#verify-a-topics-status) before building against it.

## Start here: the sandbox topic

Testnet's sandbox topics are the no-penalty onboarding playground: somewhere to make your first
worker submissions, with no whitelist required and nothing at stake if you get one wrong.

- **69** — `PLAYGROUND: 1 day BTC/USD Price Prediction`
- **77** — `PLAYGROUND FAST - 5 minute BTC/USD Price Prediction`

The `PLAYGROUND FAST` topic is the short-epoch counterpart of the daily one, for quicker feedback
while you iterate. Both are marked `sandbox` in the table below and carry a `sandbox` flag in
`/api/topics.json`, which is where the list above is read from — so it cannot fall out of step
with the tables.

## Testnet topics (`allora-testnet-1`)

39 active topics.

| Topic ID | Metadata | Epoch Length (blocks) | Category | Loss Method |
| --- | --- | --- | --- | --- |
| 1 | ETH 10min Prediction | 120 | price | mse |
| 2 | ETH 24h Prediction | 17280 | price | mse |
| 3 | BTC 10min Prediction | 120 | price | mse |
| 8 | BNB 20min Prediction | 240 | price | mse |
| 9 | ARB 20min Prediction | 240 | price | mse |
| 13 | ETH 5min Prediction | 60 | price | mse |
| 14 | BTC 5min Prediction | 60 | price | mse |
| 18 | BTC 8h Prediction | 5760 | price | mse |
| 37 | SOL/USD - 5min Price Prediction | 35 | price | mse |
| 38 | SOL/USD - 8h Price Prediction | 35 | price | mse |
| 41 | ETH/USD - 8h Price Prediction | 35 | price | mse |
| 42 | BTC/USD - 8h Price Prediction | 35 | price | mse |
| 56 | 1 hour BERA/USD Log-Return Prediction | 655 | log-return | ztae |
| 58 | 8 hour SOL/USD Log-Return Prediction | 52 | log-return | czar |
| 60 | 24 hour XAU/USD Log-Return Prediction | 60 | log-return | czar |
| 61 | 1 day BTC/USD Log-Return Prediction | 60 | log-return | czar |
| 62 | 1 day SOL/USD Log-Return Prediction | 60 | log-return | czar |
| 63 | 1 day ETH/USD Log-Return Prediction | 60 | log-return | czar |
| 64 | 8h BTC/USD Log-Return Prediction (5min Updates) | 54 | log-return | czar |
| 65 | 8h BTC/USD Log-Return Prediction (2h Updates) | 1286 | log-return | czar |
| 66 | 7 day SOL/USD Log-Return Prediction | 720 | log-return | czar |
| 67 | 7 day BTC/USD Log-Return Prediction | 720 | log-return | czar |
| 68 | 7 day ETH/USD Log-Return Prediction | 720 | log-return | czar |
| **69** (sandbox) | PLAYGROUND: 1 day BTC/USD Price Prediction | 54 | price | mse |
| 70 | 7 day NEAR/USD Log-Return Prediction | 720 | log-return | czar |
| 71 | 8 hour NEAR/USD Log-Return Prediction | 60 | log-return | czar |
| 72 | 1 hour BTC/USD Log-Return Prediction | 60 | log-return | czar |
| 73 | 1 hour ETH/USD Log-Return Prediction | 60 | log-return | czar |
| 74 | 15 minute BTC/USD Log-Return Prediction | 60 | log-return | czar |
| 75 | 15 minute ETH/USD Log-Return Prediction | 60 | log-return | czar |
| 76 | 15 minute SOL/USD Log-Return Prediction | 60 | log-return | czar |
| **77** (sandbox) | PLAYGROUND FAST - 5 minute BTC/USD Price Prediction | 60 | price | czar |
| 79 | 15 minute BTC/USD - Volatility Prediction | 60 | volatility | mse |
| 80 | 15 minute ETH/USD - Volatility Prediction | 60 | volatility | mse |
| 81 | 15 minute XRP/USD - Volatility Prediction | 60 | volatility | mse |
| 82 | 15 minute SOL/USD - Volatility Prediction | 60 | volatility | mse |
| 83 | BTC/USD - Log Returns - 8h | 60 | log-return | czar |
| 84 | ETH/USD - Log Returns - 8h | 60 | log-return | czar |
| 85 | 4 hour ETH/USD - Volatility Prediction | 60 | volatility | mse |

## Mainnet topics (`allora-mainnet-1`)

15 active topics.

| Topic ID | Metadata | Epoch Length (blocks) | Category | Loss Method |
| --- | --- | --- | --- | --- |
| 1 | BTC/USD - Log Returns - 8h | 75 | log-return | czar |
| 2 | ETH/USD - Log Returns - 8h | 75 | log-return | czar |
| 3 | SOL/USD - Log Returns - 8h | 75 | log-return | czar |
| 9 | ETH/USD - Price Prediction - 8h | 60 | price | mse |
| 10 | SOL/USD - Price Prediction - 8h | 60 | price | mse |
| 14 | BTC/USD - Price Prediction - 8h | 60 | price | mse |
| 15 | BTC/USD - Log Returns - 24h | 60 | log-return | czar |
| 16 | ETH/USD - Log Returns - 24h | 60 | log-return | czar |
| 17 | SOL/USD - Log Returns - 24h | 60 | log-return | czar |
| 18 | BTC/USD - Log Returns - 20m | 60 | log-return | czar |
| 19 | NEAR/USD - Log Returns - 8h | 60 | log-return | czar |
| 20 | BTC/USD - Volatility - 15m | 60 | volatility | mse |
| 21 | ETH/USD - Volatility - 15m | 60 | volatility | mse |
| 22 | XRP/USD - Volatility - 15m | 60 | volatility | mse |
| 23 | SOL/USD - Volatility - 15m | 60 | volatility | mse |

**Warning**: Topic IDs are never guaranteed to be consistent between separate chains/deployments.
The same prediction task can have different topic IDs on testnet and mainnet (for example,
`BTC/USD - Log Returns - 8h` is topic 83 on testnet and topic 1 on mainnet).

## Verify a topic's status

Query the live chain to confirm a topic's current definition and active status. The `emissions`
API version segment is per-network and moves with each chain upgrade; [Networks](https://docs.allora.network/reference/networks)
records the segment each network currently serves:

```bash
# Testnet
curl -s https://allora-api.testnet.allora.network/emissions/v10/topics/69
curl -s https://allora-api.testnet.allora.network/emissions/v10/is_topic_active/69

# Mainnet
curl -s https://allora-api.mainnet.allora.network/emissions/v10/topics/1
curl -s https://allora-api.mainnet.allora.network/emissions/v10/is_topic_active/1
```

To consume the same list programmatically, fetch the published JSON instead of scraping this page:

```bash
curl -s https://docs.allora.network/api/topics.json
```

## Next

- Deploy a worker on the sandbox topic: [build a price prediction worker](https://docs.allora.network/build/worker/sdk-py)
- Compete on a live topic: [Forge competitions](https://docs.allora.network/build/forge/competitions)
- Need a topic that doesn't exist yet? [Create your own](https://docs.allora.network/operate/topics/create)
