---
title: Networks
description: Chain IDs, endpoints, and the currently deployed allora-chain version for each Allora network.
persona: Builder or operator
verified_against: live abci_info and cosmos/upgrade applied_plan on both networks, 2026-08-19
last_reviewed: 2026-08-19
---

# Networks

> Chain IDs, endpoints, and the currently deployed `allora-chain` version for each Allora network.

The Allora Network runs as two public networks: a **testnet** for development and integration, and
the production **mainnet**. Each may run a different `allora-chain` version, which also determines the
`emissions` REST/gRPC API version: testnet runs v0.17.0 and serves
`emissions/v10`, mainnet runs v0.17.0 and
serves `emissions/v10`.

|  | Testnet | Mainnet |
| --- | --- | --- |
| **Chain ID** | `allora-testnet-1` | `allora-mainnet-1` |
| **Deployed version** | v0.17.0 | v0.17.0 |
| **Emissions API namespace** | `emissions/v10` | `emissions/v10` |
| **RPC JSON** | `https://allora-rpc.testnet.allora.network/` | `https://allora-rpc.mainnet.allora.network/` |
| **gRPC** | `https://allora-grpc.testnet.allora.network/` | `https://allora-grpc.mainnet.allora.network/` |
| **API (Cosmos LCD - REST)** | `https://allora-api.testnet.allora.network/` | `https://allora-api.mainnet.allora.network/` |
| **Explorer** | `https://explorer.testnet.allora.network/allora-testnet-1` | `https://explorer.allora.network/` |
| **Faucet** | `https://faucet.testnet.allora.network/` | — |

The tables on this page are rendered from a machine-readable manifest served at `/api/networks.json`.
Agents and scripts can read the same chain IDs, endpoints, and versions from there instead of scraping
this page.

Deployed versions change with each [software upgrade](https://docs.allora.network/operate/validators/software-upgrades). Testnet is
typically upgraded ahead of mainnet, so features from a newer release (such as the v0.17.0 multi-label
and labeled network-inference APIs) may be available on testnet before they reach mainnet. Always
confirm against the [allora-chain releases](https://github.com/allora-network/allora-chain/releases)
and the [Release Notes](https://docs.allora.network/reference/release-notes).

## Testnet

- **Chain ID**: `allora-testnet-1`
- **Deployed version**: v0.17.0
- **Emissions API namespace**: `emissions/v10`
- **RPC JSON**: `https://allora-rpc.testnet.allora.network/`
- **gRPC**: `https://allora-grpc.testnet.allora.network/`
- **API (Cosmos LCD - REST)**: `https://allora-api.testnet.allora.network/`
- **Explorer**: `https://explorer.testnet.allora.network/allora-testnet-1`
- **Faucet**: `https://faucet.testnet.allora.network/`

Use the testnet for building and testing integrations, running workers/reputers, and trying features
before they ship to mainnet. For wallet creation and faucet funding, see
[Setup Wallet](https://docs.allora.network/get-started/setup-wallet).

## Mainnet

- **Chain ID**: `allora-mainnet-1`
- **Deployed version**: v0.17.0
- **Emissions API namespace**: `emissions/v10`
- **RPC JSON**: `https://allora-rpc.mainnet.allora.network/`
- **gRPC**: `https://allora-grpc.mainnet.allora.network/`
- **API (Cosmos LCD - REST)**: `https://allora-api.mainnet.allora.network/`
- **Explorer**: `https://explorer.allora.network/`
- **Faucet**: —

Mainnet has no faucet — fund addresses with ALLO yourself.

The `emissions` API version segment is per-network — always pick the one matching the network you are
querying: `emissions/v10` on testnet and
`emissions/v10` on mainnet. Since v0.17.0 these
network-inference endpoints return [labeled network-inference bundles](https://docs.allora.network/consume/api) rather than a
single unlabeled value.

## Related

- [Allora API Endpoint](https://docs.allora.network/consume/api) — querying inferences over REST
- [RPC JSON Data Access](https://docs.allora.network/consume/rpc-grpc) — querying over RPC JSON
- [Setup Wallet](https://docs.allora.network/get-started/setup-wallet) — RPC JSON URL and Chain ID configuration
- [Software Upgrades](https://docs.allora.network/operate/validators/software-upgrades) — how network versions are upgraded
