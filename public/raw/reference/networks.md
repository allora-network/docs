---
title: Networks
description: Chain IDs, endpoints, and the currently deployed allora-chain version for each Allora network.
persona: Builder or operator
verified_against: docs content as of 2026-07-30
last_reviewed: 2026-07-30
---

# Networks

> Chain IDs, endpoints, and the currently deployed `allora-chain` version for each Allora network.

The Allora Network runs as two public networks: a **testnet** for development and integration, and
the production **mainnet**. Each may run a different `allora-chain` version, which also determines the
`emissions` REST/gRPC API version (for example, mainnet's v0.16.0 serves `emissions/v9`
while testnet's v0.17.0 serves `emissions/v10`).

The tables on this page are rendered from a machine-readable manifest served at `/api/networks.json`.
Agents and scripts can read the same chain IDs, endpoints, and versions from there instead of scraping
this page.

Deployed versions change with each [software upgrade](https://docs.allora.network/operate/validators/software-upgrades). Testnet is
typically upgraded ahead of mainnet, so features from a newer release (such as the v0.17.0 multi-label
and labeled network-inference APIs) may be available on testnet before they reach mainnet. Always
confirm against the [allora-chain releases](https://github.com/allora-network/allora-chain/releases)
and the [Release Notes](https://docs.allora.network/reference/release-notes).

## Testnet

Use the testnet for building and testing integrations, running workers/reputers, and trying features
before they ship to mainnet. For wallet creation and faucet funding, see
[Setup Wallet](https://docs.allora.network/get-started/setup-wallet).

## Mainnet

Mainnet has no faucet — fund addresses with ALLO yourself.

The `emissions` API version differs by network. On mainnet (v0.16.0) network-inference
endpoints live under `emissions/v9` and return a single (unlabeled) value; on testnet
(v0.17.0) they live under `emissions/v10` and return
[labeled network-inference bundles](https://docs.allora.network/consume/api).
Pick the version segment that matches the network you are querying.

## Related

- [Allora API Endpoint](https://docs.allora.network/consume/api) — querying inferences over REST
- [RPC JSON Data Access](https://docs.allora.network/consume/rpc-grpc) — querying over RPC JSON
- [Setup Wallet](https://docs.allora.network/get-started/setup-wallet) — RPC JSON URL and Chain ID configuration
- [Software Upgrades](https://docs.allora.network/operate/validators/software-upgrades) — how network versions are upgraded
