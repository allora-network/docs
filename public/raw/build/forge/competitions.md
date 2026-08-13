---
title: Allora Forge Competitions
description: How Allora Forge competitions work — compete on live topics, build a testnet track record, and graduate to mainnet where top performers earn ALLO rewards.
persona: ML builder
verified_against: forge.allora.network (live site + public API, 2026-07-30), allora-forge-builder-kit README (main @ 8ef3200), Allora Research promotion/relegation post (2026-08-06)
last_reviewed: 2026-08-12
---

# Allora Forge Competitions

[Allora Forge](https://forge.allora.network) is the Allora Network's model competition platform: the hub where ML practitioners build, test, and deploy machine learning models against real-world data — competing for ALLO rewards while building an on-chain track record.

Forge runs competitions on an ongoing basis. Each competition targets one live [topic](https://docs.allora.network/build/forge/topics) on the Allora Network, carries its own ALLO prize pool, and moves through **upcoming → active → ended** as its start and end dates pass. Browse [forge.allora.network](https://forge.allora.network) for the competitions that are open right now.

## How a competition works

A competition ranks workers by their performance on its underlying topic. Topics run a continuous cycle:

1. **Submission window opens** — the network polls all registered workers on the topic for an inference.
2. **Workers respond** with a prediction; predictions lock when the window closes.
3. **Evaluation period** runs for the topic's time horizon (for example, 8 hours).
4. **Scores are revealed** — workers are ranked by loss against the ground truth, and rewards are distributed.

The cycle repeats every epoch, so a competition is not a one-shot submission: your model keeps predicting for the duration of the competition window, and the leaderboard reflects its live, cumulative performance.

## Scoring

Scoring happens on-chain. Each epoch, the network compares every submitted inference against the topic's ground truth and ranks workers by loss. Forge then summarizes that history into promotion-readiness metrics so you can see whether a worker has enough evidence of skill to move from testnet to mainnet.

Promotion is evaluated **per worker, per topic**. A worker can be eligible on one topic and ineligible on another because the horizon, participation history, ground truth lag, and submitted inferences are topic-specific.

The key dashboard detail is that some eligibility rows use a **confidence interval (CI)**, not only the point estimate shown as "your value." When a metric is displayed as:

`your value (lower CI, upper CI)`

the top-level value is the worker's point estimate for that metric. The values in parentheses are the confidence interval around that estimate. For promotion checks that say the **lower CI** must exceed a threshold, the relevant number is the **first value inside the parentheses**, not the top-level point estimate. For example, if directional accuracy appears as `72.3% (44.7%, 100%)`, the lower CI is `44.7%`; this would not pass a `> 50%` lower-bound threshold even though the point estimate is above 50%.

Allora uses confidence intervals because workers may have different numbers of submissions. More submissions generally give more evidence and a tighter interval; fewer submissions leave more uncertainty. Where adjacent epochs share overlapping ground-truth windows, Allora corrects the interval calculation using an effective sample size so repeated, correlated observations do not overstate confidence.

For mainnet promotion, a worker must pass every promotion metric on the topic:

- **Effective sample size** — `n_eff` must be at least 20 before any forecast-horizon adjustment
- **Directional accuracy** — one-sided 95% lower CI greater than 50%
- **Pearson correlation** — two-sided 95% lower CI greater than 0
- **WRMSE improvement** — adaptive lower CI greater than 0%
- **WCZAR improvement** — adaptive lower CI greater than 0%
- **Log aspect ratio** — confidence interval overlaps `[-0.5, +0.5]`, meaning forecast variation is not clearly too small or too large
- **Participation** — strictly greater than 90%

Long-horizon topics accumulate independent evidence more slowly, so the promotion system applies a forecast-horizon adjustment to directional accuracy, WRMSE improvement, and WCZAR improvement. This relaxes the effective confidence requirement for long horizons after the minimum effective-sample-size gate has already been met. Pearson correlation and log aspect ratio do not use this horizon adjustment.

The [Forge Builder Kit](https://github.com/allora-network/allora-forge-builder-kit) mirrors this methodology off-chain: its `PerformanceEvaluator` grades your model against Allora's scoring methodology *before* you deploy, including directional accuracy, Pearson correlation, weighted-RMSE improvement, CZAR improvement, and related confidence checks. A higher grade means better generalization and a higher expected score on the network.

For the full policy, including relegation criteria, see the Allora Research forum post on [inference worker promotion and relegation](https://research.allora.network/t/inference-worker-promotion-and-relegation/157).

### Log-return topics

For log-return topics, the worker already submits the predicted log return, so no price conversion is needed before evaluation. The submitted prediction and the realized ground truth are compared in log-return space, and the promotion metrics above are calculated directly from that series.

This makes log-return topics directly comparable with price topics after price forecasts have been converted into log returns. The zero baseline represents no change, and positive WRMSE or WCZAR improvement means the worker is improving over that baseline.

### Volatility topics

Volatility topics are evaluated on the change in volatility, not the raw volatility level. Ground truth is calculated from one-minute log-price returns over trailing windows:

- The base volatility covers the window ending at forecast time.
- The target volatility covers the following horizon beginning at forecast time.
- The evaluated change is the log ratio of target volatility to base volatility.

Volatility naturally tends to mean-revert, which can inflate directional accuracy if it is not accounted for. Allora therefore estimates a causal trailing mean-reversion baseline from information available at forecast time and subtracts that expectation from both the worker prediction and the actual log-volatility change before calculating the evaluation metrics. Workers are evaluated on skill beyond that volatility baseline.

## From testnet to mainnet

Workers start on **testnet** to establish a track record, then graduate to **mainnet**, where top performers earn ALLO token rewards.

Your Forge dashboard tracks this progression as **Mainnet Readiness**: a set of per-worker criteria with an eligibility threshold. Meet enough criteria and the worker becomes eligible for mainnet promotion; until then the dashboard shows which criteria are still in progress.

## Compete

1. **Create a Forge account.** Sign up at [forge.allora.network](https://forge.allora.network) and connect a wallet to access your dashboard.
2. **Register.** Competition participation requires registering and getting whitelisted; the Forge site links to the registration form.
3. **Build and deploy a worker** on the competition's topic. The fastest path is the [Forge Builder Kit](https://github.com/allora-network/allora-forge-builder-kit), which takes you from historical data to a deployed worker — or follow the [price prediction worker walkthrough](https://docs.allora.network/build/worker/sdk-py) to do it with the Python SDK directly.
4. **Link your worker to your Forge account.** The builder kit's device flow signs with your on-disk worker key and links it to your account in the browser — your mnemonic never leaves your machine. Linked workers show up in your dashboard with their balance, earnings, and activity.
5. **Track your standing.** Forge shows per-topic leaderboards, the competitions you're in, and your workers' scores; the [Allora Explorer](https://explorer.allora.network) has the underlying on-chain detail.

No whitelist yet? The testnet **playground topics** — the [sandbox topics 69 and 77](https://docs.allora.network/build/forge/topics#start-here-the-sandbox-topic) — are the recommended starting point and require no whitelist, so you can build, deploy, and score a worker end to end while your registration is pending.

## Build with the Forge Builder Kit

The [Allora Forge Builder Kit](https://github.com/allora-network/allora-forge-builder-kit) handles everything between your model and the network:

- **Workflow API** — backfill historical data, engineer features, and build training datasets
- **Evaluation** — grade your model against Allora's scoring methodology before deploying
- **Deployment tooling** — wallet creation, faucet funding, and worker lifecycle management
- **Monitoring dashboard** — web UI with submission history, on-chain scores, and live logs
- **Topic discovery** — query all live topics on testnet and mainnet

If you previously built models with the deprecated offchain node or Model Development Kit (MDK), see the [migration guide](https://docs.allora.network/build/migrate-from-offchain-node).

Forge also exposes a programmatic API: create an API key from your Forge account to access it from scripts, CI pipelines, or your own services.

## Next

- Pick a topic to compete on: [existing topics](https://docs.allora.network/build/forge/topics)
- Deploy your first worker: [build a price prediction worker](https://docs.allora.network/build/worker/sdk-py)
- Coming from the offchain node or MDK: [migrate to the Python SDK + Builder Kit](https://docs.allora.network/build/migrate-from-offchain-node)
