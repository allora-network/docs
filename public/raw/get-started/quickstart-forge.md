---
title: Enter a Forge competition
description: Train, grade, and deploy a baseline model with the Allora Forge Builder Kit, then enter a live competition on forge.allora.network.
persona: ML builder
verified_against: allora-forge-builder-kit v3.0.0 (main @ 8ef3200) on allora-testnet-1; forge.allora.network (2026-07-30)
last_reviewed: 2026-07-30
---

# Enter a Forge competition

## Goal

Go from a fresh clone to a competing model with the
[Allora Forge Builder Kit](https://github.com/allora-network/allora-forge-builder-kit):
backfill historical BTC data, train a baseline model, grade it against Allora's
evaluation metrics, deploy it as a live worker on the testnet sandbox topic
(**69**, 1-day BTC/USD price prediction — no whitelist, no penalties), and then
enter a competition on [forge.allora.network](https://forge.allora.network).

Budget about 15 minutes; the training script itself runs in roughly 3 minutes.

## Prerequisites

- Python 3.10 or newer (on macOS, use `python3.11` or `python3.12` explicitly if
  your system `python3` is 3.9)
- `git`
- A free Allora API key — created in the next step (or skip it and use the
  Binance data fallback)

## Steps

### 1. Create an API key

Sign up free at [developer.allora.network](https://developer.allora.network) and
copy your API key. The key unlocks the kit's default **Atlas** data source
(Tiingo 1-minute candles) and is also used by the deployed worker.

No API key? The data pipeline can pull from Binance instead — see the fallback
note in step 3.

### 2. Clone and install

```bash
git clone https://github.com/allora-network/allora-forge-builder-kit.git
cd allora-forge-builder-kit

python3.11 -m venv .venv
source .venv/bin/activate

python -m pip install .
python -m pip install -r requirements.txt
```

Save your API key into the repo directory and load it into the environment
without displaying it:

```bash
echo "UP-..." > .allora_api_key

# Load into env without displaying the value
export ALLORA_API_KEY=$(cat .allora_api_key)
```

(Replace `UP-...` with the key you copied in step 1.)

### 3. Backfill data and train a baseline

```bash
cd notebooks
python example_topic_69_bitcoin_walkthrough.py
```

The walkthrough script runs the whole modeling pipeline for topic 69
(~3 minutes):

1. **Backfill** — constructs an `AlloraMLWorkflow` on the Atlas data source and
   calls `backfill()` to download 500 days of 1-minute BTC/USD candles.
2. **Features and target** — `get_full_feature_target_dataframe()` resamples to
   1-hour bars and builds, for each timestamp, 48 input bars × 5 normalized
   OHLCV ratios = 240 base features (plus four engineered log-return features),
   with the 24-hour-ahead log return as the target.
3. **Train** — grid-searches a LightGBM baseline with walk-forward
   cross-validation (an embargo gap prevents lookahead leakage), then retrains
   the best configuration on the full dataset.
4. **Evaluate** — grades the held-out predictions with `PerformanceEvaluator`
   (next step).
5. **Save** — tests one live prediction and saves the model as `predict.pkl`,
   the artifact the worker will serve. Topic 69 is a *price* topic, so the
   saved function converts the predicted log return into an absolute USD price.

**No API key?** Edit the `AlloraMLWorkflow(...)` call in the walkthrough script
to use `data_source="binance"` (and drop the `api_key` argument) to pull data
from Binance instead. The fallback covers training data only — deploying in
step 5 still requires `ALLORA_API_KEY`.

### 4. Read your evaluation report

`PerformanceEvaluator` scores the model's out-of-sample predictions on 7
primary metrics, each with a pass/fail threshold:

1. **Directional Accuracy** (≥ 0.52) — fraction of predictions whose sign
   (up/down) matches the actual return.
2. **DA CI Lower Bound** (≥ 0.50) — lower bound of the 95% Wilson confidence
   interval for directional accuracy, using an autocorrelation-adjusted
   effective sample size.
3. **DA Statistical Significance** (p < 0.05) — z-test with continuity
   correction against the null hypothesis that directional accuracy is 50%.
4. **Pearson Correlation** (r ≥ 0.05) — linear correlation between predicted
   and actual returns.
5. **Pearson Statistical Significance** (p < 0.05) — significance of that
   correlation.
6. **WRMSE Improvement** (≥ 5%) — weighted RMSE versus a zero-prediction
   baseline, with errors weighted by the magnitude of the actual return.
7. **CZAR Improvement** (≥ 10%) — Cumulative Z-scored Absolute Return: the
   fraction of z-scored directional return captured versus a perfect oracle
   (0 = random guessing, 1 = every directional call correct).

The number of metrics passed (out of 7) maps to a letter grade:

| Points (out of 7) | 7 | 6 | 5 | 4 | 3 | 2 | ≤ 1 |
|-------------------|---|---|---|---|---|---|-----|
| Grade             | A+ | A | B+ | B | C | D | F |

The report is printed near the end of the walkthrough. Here is a real run
(your numbers will differ as new market data arrives):

```text
================================================================================
PERFORMANCE EVALUATION REPORT
================================================================================

OVERALL PERFORMANCE: F (1/7 points)
   Primary metrics passed: 1/7
   Performance Score: 14.29%

================================================================================
PRIMARY METRICS (7 Core Metrics)
================================================================================

1. Directional Accuracy:
   Value: 0.4842  FAIL
   Threshold: >= 0.52
   Correct: 4329/8940 predictions

2. DA CI Lower Bound:
   Value: 0.4670  FAIL
   Threshold: >= 0.5
   95% CI: [0.4670, 0.5015]
   Effective n: 3218.6 (autocorr: 0.471)

3. DA Statistical Significance:
   p-value: 0.5000  FAIL
   Threshold: < 0.05
   Method: z-test with continuity correction (n_eff=3218.6)

4. Pearson Correlation:
   r: -0.0209  FAIL
   Threshold: >= 0.05

5. Pearson Statistical Significance:
   p-value: 0.0477  PASS
   Threshold: < 0.05

6. WRMSE Improvement:
   Improvement: -0.0264 (-2.64%)  FAIL
   Threshold: >= 0.05 (5%)
   Model WRMSE: 0.038048
   Baseline WRMSE: 0.037069

7. CZAR Improvement:
   Improvement: -0.0675 (-6.75%)  FAIL
   Threshold: >= 0.1 (10%)
   Model CZAR: -441.157988
   Oracle CZAR: 6531.829579

================================================================================
```

A higher grade means better generalization — and a higher expected score once
the model competes on the network. Don't be discouraged by a low grade here:
crypto returns are noise-dominated and the stock baseline is only a starting
point. Beating it with your own features is the whole game (see
[Next](#next)).

### 5. Deploy the worker

```bash
# Still in notebooks/
python deploy_worker.py
```

On first run, `WorkerManager` creates a wallet (key file in `worker_keys/`),
requests testnet ALLO from the faucet automatically, registers the worker, and
starts the worker process, which polls the chain for open submission windows
and serves `predict.pkl`:

```text
Deploying worker for Topic 69...
  Deployed worker for topic 69 with address allo14lv0hjr4hzvsdyv7awxjaf9f8ajxeqwcmxrpyg
  Address: allo14lv0hjr4hzvsdyv7awxjaf9f8ajxeqwcmxrpyg
Starting worker...
  Status: running
  PID: 99461
  Log: worker_logs/worker_69_allo14lv0hjr4hzvsdyv7awxjaf9f8ajxeqwcmxrpyg.log

Worker running. Monitor with:
  python -m allora_forge_builder_kit.workerctl dashboard
  python -m allora_forge_builder_kit.web_dashboard
```

Faucet activity is logged, not printed: wallet funding, balance checks, and
on-chain errors all go to `worker_logs/worker_69_<address>.log`.

### 6. Watch it submit

```bash
# Web dashboard (recommended) — open http://localhost:8787
python -m allora_forge_builder_kit.web_dashboard
```

The dashboard auto-refreshes every 5 seconds and shows every worker with its
submission timeline, on-chain scores, and live log tail. Prefer the terminal?

```bash
# CLI dashboard — text summary of all workers
python -m allora_forge_builder_kit.workerctl dashboard
```

### 7. Enter the competition

Your worker is already scoring on-chain in the topic-69 sandbox. To compete for
rewards:

1. **Create a Forge account** at
   [forge.allora.network](https://forge.allora.network) and connect a wallet.
2. **Register** for a competition — participation requires registering and
   getting whitelisted; the Forge site links to the registration form.
3. **Link your worker** to your Forge account with
   `python -m allora_forge_builder_kit.workerctl link` — the kit's device flow
   signs with your on-disk worker key, so your mnemonic never leaves your
   machine.
4. **Track your standing** on the per-topic leaderboards.

How competitions, scoring, and mainnet graduation work is covered in
[Forge competitions](https://docs.allora.network/build/forge/competitions).

## Verify

1. **Model artifact** — the walkthrough ends with `COMPLETE!` and a
   `predict.pkl` file in `notebooks/`, plus run artifacts (metrics, predictions
   CSV, scatter plot) under `notebooks/runs/<timestamp>/`.
2. **Worker submits** — check the worker log for a successful on-chain
   submission:

   ```bash
   grep "Successfully submitted" worker_logs/worker_69_*.log
   ```

   You should see a line like `✅ Successfully submitted: topic=69 nonce=...`
   followed by a transaction hash.
3. **Dashboard** — http://localhost:8787 lists your worker as `running` with a
   recent submission in its timeline.
4. **Explorer** — paste the worker address (printed by `deploy_worker.py`) into
   the [testnet explorer](https://explorer.testnet.allora.network/allora-testnet-1)
   to see its faucet funding and submissions on-chain.

## Troubleshoot

- **`OSError: Library not loaded: @rpath/libomp.dylib`** (macOS) — LightGBM
  needs the OpenMP runtime: `brew install libomp`, then rerun the walkthrough.
- **`RuntimeError: No data available`** — the backfill failed, usually a
  missing or invalid API key. Confirm the key is loaded without printing it
  (`[ -n "$ALLORA_API_KEY" ] && echo "key loaded"`), recheck `.allora_api_key`,
  or switch the walkthrough to `data_source="binance"`.
- **Worker fails to start or never submits** — the worker runs as a subprocess,
  so look in `worker_logs/worker_69_<address>.log`: faucet requests, balance
  checks, and on-chain errors all appear there, not on your console.
- **`unknown service emissions.v9.QueryService`** in the worker log — the
  installed `allora_sdk` release predates the testnet's `emissions/v10`
  upgrade (see [Networks](https://docs.allora.network/reference/networks)). Upgrade it inside the kit's
  venv: `pip install --upgrade allora_sdk`.
- **`not whitelisted on topic`** — playground topics 69 and 77 are open to
  everyone; other topics require competition registration (step 7) before the
  chain accepts your submissions.

## Next

- **Beat the baseline** — add technical indicators, log-return series, or
  cross-asset signals: `notebooks/feature_engineering_example.py` is the
  reference, and the kit's `allora_research_model_skills/` bundle packages
  three model-building methodologies for AI-assisted research.
- **Deploy more topics** — `TOPIC_ID=77 python deploy_worker.py` deploys the
  same artifact to another topic; browse [existing topics](https://docs.allora.network/build/forge/topics)
  and discover them programmatically with `AlloraTopicDiscovery`.
- **Understand the competition** — [how Forge competitions
  work](https://docs.allora.network/build/forge/competitions), from testnet track record to mainnet ALLO
  rewards.
- **Monitor on-chain** — [query worker data](https://docs.allora.network/build/worker/query-worker-data)
  and [worker monitoring](https://docs.allora.network/build/worker/monitoring) cover scores and EMA
  queries with `allorad`.
