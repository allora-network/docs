---
title: Build and Deploy a Forecaster
description: What forecasters do on Allora, and how to submit forecasted losses to a topic with the Python SDK's AlloraWorker.forecaster.
persona: ML builder
verified_against: allora_sdk 1.3.0 (PyPI)
last_reviewed: 2026-08-03
---

# Build and Deploy a Forecaster

A **forecaster** is a worker that predicts how accurate other workers' inferences will be, instead of (or in addition to) answering the topic's question itself. For each inferer, it submits a **forecasted loss** — an estimate of the error that inferer's inference will show against the eventual ground truth. The network turns forecasted losses into [regrets and weights](https://docs.allora.network/learn/inference-synthesis#forecast) and combines them into [forecast-implied inferences](https://docs.allora.network/learn/inference-synthesis#forecast-implied-inferences), making the network inference [context-aware](https://docs.allora.network/learn/inference-synthesis#context-awareness) — better than any individual model's output. [Forecast and Synthesis](https://docs.allora.network/learn/inference-synthesis) explains the mechanism end to end.

The forecaster role has the same first-class tooling as the inferer: [`AlloraWorker.forecaster(...)`](https://docs.allora.network/consume/sdk-py) (`allora_sdk` 1.3.0) handles wallet creation, testnet faucet funding, registration, submission windows, and transaction submission — you supply one Python function that returns your forecasted losses.

## Goal

Register a worker on an Allora testnet topic and submit a forecast — predicted losses for the topic's active inferers — with the Python SDK's ([`allora_sdk`](https://pypi.org/project/allora-sdk/)) `AlloraWorker.forecaster`.

## Prerequisites

- Python 3.10–3.13
- An Allora API key — get one for free at [developer.allora.network](https://developer.allora.network). On testnet, the worker uses it to automatically request ALLO gas from the faucet.
- A topic with active inferers to forecast on. The example uses [Allora's testnet sandbox topic (ID 69)](https://testnet.explorer.allora.network/topics/69); browse [existing topics](https://docs.allora.network/build/forge/topics) for others.

If you already ran an [inference worker](https://docs.allora.network/build/worker/sdk-py) in the same directory, the forecaster reuses the identity saved in its `.allora_key` file; otherwise it creates one on first run.

## Steps

### 1. Install the SDK

```bash
pip install allora_sdk
```

### 2. Understand the forecast function

`AlloraWorker.forecaster(...)` takes a `run` function that returns one predicted loss per inferer, as a dict keyed by the inferer's `allo...` address:

```python
{"allo1...": 0.05}  # your predicted loss for this inferer, this epoch
```

The SDK converts the dict into the chain's `forecast_elements` format and submits it as a worker payload — the same `insert_worker_payload` transaction inferers send, with the forecast in place of an inference. A worker payload can also carry both at once — a combination the network explicitly supports ([some workers do both](https://docs.allora.network/learn/inference-synthesis#losses)) — by calling the lower-level `client.emissions.tx.insert_worker_payload()` with `inference_value` and `forecast_elements` together.

### 3. Write the forecaster

Save this as `forecaster.py`, replacing the model logic in `forecast_losses` with your own. The function receives a [`RunContext`](https://docs.allora.network/build/worker/sdk-py) — the submission window's `nonce`, the `topic_id`, and an RPC `client` — and uses the client to look up the topic's current inferers:

```python
import asyncio
import os

from allora_sdk import AlloraNetworkConfig, AlloraWorker, RunContext
from allora_sdk.rpc_client.protos.emissions.v10 import GetLatestNetworkInferencesRequest

TOPIC_ID = 69


async def forecast_losses(ctx: RunContext) -> dict[str, float]:
    # Find the inferers whose accuracy you are forecasting
    latest = await ctx.client.emissions.query.get_latest_network_inferences(
        GetLatestNetworkInferencesRequest(topic_id=ctx.topic_id)
    )
    if latest.network_inferences is None or not latest.network_inferences.inferer_values:
        raise RuntimeError(f"Topic {ctx.topic_id} has no network inferences yet -- nothing to forecast")
    inferers = [v.worker for v in latest.network_inferences.inferer_values]

    # Your ML model goes here: for each inferer, predict the loss of the
    # inference it submits this epoch.
    return {address: 0.05 for address in inferers}


async def main():
    worker = AlloraWorker.forecaster(
        run=forecast_losses,
        topic_id=TOPIC_ID,
        network=AlloraNetworkConfig.testnet(),
        api_key=os.environ["ALLORA_API_KEY"],
    )
    async for result in worker.run():
        if isinstance(result, Exception):
            print(f"Forecast worker error: {result}")
        else:
            print(f"Forecast for {len(result.submission)} inferers submitted in transaction {result.tx_result.txhash}")


asyncio.run(main())
```

### 4. Run it

```bash
export ALLORA_API_KEY="<your key from developer.allora.network>"
python forecaster.py
```

On the first run, the worker walks you through onboarding exactly like the [inference worker](https://docs.allora.network/build/worker/sdk-py): it asks for a wallet mnemonic (press **Enter** to generate one; it is saved to `.allora_key` and reused), requests testnet ALLO from the faucet using your API key, and registers your address on the topic. It then listens for the topic's submission windows and calls `forecast_losses` each time one opens.

## Verify

- Each time a submission window opens, the terminal prints `Forecast for N inferers submitted in transaction <hash>`, and the log shows `✅ Successfully submitted: topic=69 nonce=...`.
- Read the forecast back from the chain — run this separately, with the nonce (block height) from your submission log:

  ```python
  import asyncio

  from allora_sdk import AlloraRPCClient
  from allora_sdk.rpc_client.protos.emissions.v10 import GetForecastsAtBlockRequest

  async def main():
      client = AlloraRPCClient.testnet()
      forecasts = await client.emissions.query.get_forecasts_at_block(
          GetForecastsAtBlockRequest(topic_id=69, block_height=10353455)  # your nonce here
      )
      if forecasts.forecasts is not None:
          print([f.forecaster for f in forecasts.forecasts.forecasts])

  asyncio.run(main())
  ```

  Your `allo...` address should appear in the printed list of forecasters.
- Open [testnet.explorer.allora.network/topics/69](https://testnet.explorer.allora.network/topics/69) and look for your address among the topic's workers.

## Troubleshoot

- **gRPC `StatusCode.UNIMPLEMENTED` with `unknown service emissions.vN.QueryService`** — the network has been upgraded to a newer protobuf revision than the one bundled with your installed SDK release. Upgrade with `pip install --upgrade allora_sdk`; if the newest release still fails, the deployed network is ahead of the latest SDK release — check the [SDK issue tracker](https://github.com/allora-network/allora-sdk-py/issues).
- **`The wallet ... is not whitelisted on topic ...`** — the topic restricts who may submit worker payloads and the worker stops. Contact the topic creator to get your address whitelisted, or use the [sandbox topic (ID 69)](https://testnet.explorer.allora.network/topics/69).
- **Rejections with code 68, 75, or 78** — you already submitted a worker payload for this nonce. The worker recognizes these, logs a warning, and waits for the next submission window; each address submits at most one payload per epoch.
- **`Topic ... has no network inferences yet`** — forecasting needs inferences to forecast against. Pick a topic with active inferers ([existing topics](https://docs.allora.network/build/forge/topics)), or wait until the topic completes an epoch with inference submissions.
- **`Too many faucet requests`** — the testnet faucet is rate-limited. Send ALLO to your worker's address from another wallet, or request funds manually at [faucet.testnet.allora.network](https://faucet.testnet.allora.network).

## Next

- How forecasts become weights and forecast-implied inferences: [Forecast](https://docs.allora.network/learn/inference-synthesis#forecast) and [Synthesis](https://docs.allora.network/learn/inference-synthesis#synthesis)
- Submit plain inferences with the high-level worker: [Allora Python SDK](https://docs.allora.network/consume/sdk-py) or [build a worker with the Python SDK](https://docs.allora.network/build/worker/sdk-py)
- Find topics with active inferers: [existing topics](https://docs.allora.network/build/forge/topics)
- Inspect your worker's on-chain data: [query worker data using allorad](https://docs.allora.network/build/worker/query-worker-data)
