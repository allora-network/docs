---
title: GOAT SDK Allora Plugin
description: Add an Allora price-prediction tool to GOAT-powered on-chain agents with @goat-sdk/plugin-allora.
persona: Agent developer
verified_against: goat-sdk/goat@f2eedc2 (main), typescript/packages/plugins/allora v0.1.7; npm @goat-sdk/plugin-allora 0.1.7
last_reviewed: 2026-07-30
---

# GOAT SDK Allora Plugin

[GOAT](https://github.com/goat-sdk/goat) (Great On-chain Agent Toolkit) is an
open-source library that lets AI agents interact with blockchain protocols and
smart contracts through their own wallets. The Allora plugin,
[`@goat-sdk/plugin-allora`](https://www.npmjs.com/package/@goat-sdk/plugin-allora),
gives GOAT-powered agents a tool for fetching future price predictions from the
Allora Network.

## Goal

Register the Allora plugin in a GOAT agent so the agent can fetch BTC and ETH
price predictions from Allora.

## Prerequisites

- A TypeScript agent project built on the [GOAT SDK](https://github.com/goat-sdk/goat)
  (`@goat-sdk/core`).
- An Allora API key — get one for free at
  [developer.allora.network](https://developer.allora.network).

## Steps

### 1. Install the plugin

```bash
npm install @goat-sdk/plugin-allora
```

`yarn add` and `pnpm add` work equally.

### 2. Register the plugin

```typescript
import { allora } from '@goat-sdk/plugin-allora'

const plugin = allora({
    apiKey: process.env.ALLORA_API_KEY,
})
```

Pass the resulting plugin to your GOAT agent's plugin list the same way as any
other GOAT plugin — see the
[GOAT examples](https://github.com/goat-sdk/goat/tree/main/typescript/examples)
for complete agent setups.

The plugin accepts two options:

| Option | Required | Description |
| :--- | :--- | :--- |
| `apiKey` | No, but recommended | Your Allora API key from [developer.allora.network](https://developer.allora.network). |
| `apiRoot` | No | Override the Allora API root URL. Defaults to the public Allora API. |

### 3. Use the price-prediction tool

The plugin exposes a single tool, `getPricePrediction`, which fetches a future
price prediction for a crypto asset from the Allora Network. It takes:

| Parameter | Allowed values | Description |
| :--- | :--- | :--- |
| `ticker` | `BTC`, `ETH` | The asset to fetch a price prediction for. |
| `timeframe` | `5m`, `8h` | How far into the future: 5 minutes or 8 hours. |

Once the plugin is registered, your agent can call the tool in response to
prompts such as "What will the ETH price be 5 minutes from now?".

## Verify

Ask your agent for an ETH price prediction 5 minutes out. The agent should
invoke the `getPricePrediction` tool and reply with a numeric network
inference from Allora.

## Troubleshoot

- **Unsupported asset or timeframe** — the plugin currently supports only the
  `BTC` and `ETH` tickers and the `5m` and `8h` timeframes.
- **Authentication errors** — check that `ALLORA_API_KEY` is set in your
  environment and passed to `allora()`. Free keys are available at
  [developer.allora.network](https://developer.allora.network).

## Next

- Browse other [ecosystem integrations](https://docs.allora.network/consume/integrations).
- Query inferences directly through the [Allora API](https://docs.allora.network/consume/api) or the
  [SDKs](https://docs.allora.network/consume/sdk-overview).
- GOAT resources: [Docs](https://ohmygoat.dev) ·
  [Examples](https://github.com/goat-sdk/goat/tree/main/typescript/examples) ·
  [Discord](https://discord.gg/goat-sdk)
