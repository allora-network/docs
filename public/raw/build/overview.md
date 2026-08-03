---
title: Build on Allora
description: Pick your role on the network — run a worker, forecaster, or reputer, compete in Forge, and pull training data from Atlas.
persona: ML builder
verified_against: docs content as of 2026-08-03
last_reviewed: 2026-08-03
---

# Build on Allora

Allora is a decentralized network where machine-learning models compete to produce
the best inferences. This section covers the three actor types you can run on the
network — workers, forecasters, and reputers — plus Forge competitions and the
Atlas data platform that support model building.

- [Workers](https://docs.allora.network/build/worker/sdk-py)
- [Forecasters](https://docs.allora.network/build/forecaster/build-and-deploy-a-forecaster)
- [Reputers](https://docs.allora.network/build/reputer)
- [Forge](https://docs.allora.network/build/forge/competitions)
- [Atlas](https://docs.allora.network/build/atlas/overview)

- **Workers** — run a model that answers a topic's question directly, submitting
  live inferences each epoch. [Build a worker with the Python SDK](https://docs.allora.network/build/worker/sdk-py),
  [deploy it with Docker](https://docs.allora.network/build/worker/containerize), [monitor its submissions and
  health](https://docs.allora.network/build/worker/monitoring), and [query worker data with
  allorad](https://docs.allora.network/build/worker/query-worker-data). Check the
  [system requirements](https://docs.allora.network/build/worker/requirements) first.
- **Forecasters** — a forecaster is a worker that predicts how accurate other
  workers' inferences will be, submitting forecasted losses that make the combined
  network inference context-aware.
  [Build and deploy a forecaster](https://docs.allora.network/build/forecaster/build-and-deploy-a-forecaster)
  with the same Python SDK tooling workers use.
- **Reputers** — reputers serve ground truth and compute losses, ensuring the
  accuracy and reliability of worker inferences.
  [Build a reputer](https://docs.allora.network/build/reputer/build-a-reputer),
  [deploy one with Docker](https://docs.allora.network/build/reputer/deploy-docker),
  [set and adjust stake](https://docs.allora.network/build/reputer/set-and-adjust-stake), and
  [query reputer data with allorad](https://docs.allora.network/build/reputer/query-reputer-data).
- **Forge** — model competitions on live topics: build a testnet track record and
  graduate to mainnet, where top performers earn ALLO rewards. See
  [how competitions work](https://docs.allora.network/build/forge/competitions) and browse
  [existing topics](https://docs.allora.network/build/forge/topics) for live topic IDs, epoch lengths, and
  loss methods.
- **Atlas** — the Allora Forge timeseries data platform: discover datasets, query
  OHLCV candles at multiple resolutions, and stream live market data for model
  building. Start with the [Atlas overview](https://docs.allora.network/build/atlas/overview), then the
  [Atlas API reference](https://docs.allora.network/build/atlas/api).

## Migrating from the offchain node?

If you still run a worker on the deprecated `allora-offchain-node` + Model
Development Kit stack, follow
[Migrate from the Offchain Node](https://docs.allora.network/build/migrate-from-offchain-node) to move it
onto the Allora Python SDK and the Forge Builder Kit.

## New to Allora?

The [10-minute worker quickstart](https://docs.allora.network/get-started/quickstart-worker) gets a model
submitting live predictions to the testnet sandbox topic — no wallet setup and no
funding steps. For the concepts behind the network, start with
[What is Allora?](https://docs.allora.network/learn/what-is-allora).
