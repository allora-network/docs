---
title: Deploy a Worker with Docker
description: Containerize an Allora Python SDK worker — build the image, mount the wallet key read-only, set a restart policy, and run it unattended.
persona: ML builder productionizing a worker
verified_against: allora_sdk 1.0.6 (latest release on PyPI)
last_reviewed: 2026-07-30
---

# Deploy a Worker with Docker

A worker built with the [Allora Python SDK](https://docs.allora.network/build/worker/sdk-py) is a single Python process, so containerizing it is a plain Python Dockerfile plus two operational details:

1. **The wallet key** must reach the container without being baked into the image — the worker's interactive mnemonic prompt cannot run in a detached container.
2. **A restart policy** keeps the worker running after crashes and host reboots.

Coming from the legacy `config.json`-based worker stack? That stack is deprecated — follow [Migrate from the Offchain Node](https://docs.allora.network/build/migrate-from-offchain-node) first, then return here to containerize the result.

## Goal

Run your Python SDK worker as a detached Docker container that restarts automatically, with its wallet key mounted read-only from the host.

## Prerequisites

- [Docker Engine](https://docs.docker.com/engine/install/) (or Docker Desktop)
- A worker script — this page uses the minimal `worker.py` from the [Python SDK guide](https://docs.allora.network/build/worker/sdk-py); any worker built on `AlloraWorker` works the same way
- An Allora API key — free at [developer.allora.network](https://developer.allora.network); on testnet, the worker uses it to request ALLO gas from the faucet automatically

## Steps

### 1. Lay out the project

```text
allora-worker/
├── worker.py         # your worker
├── requirements.txt  # Python dependencies
├── Dockerfile
├── .dockerignore
└── .allora_key       # wallet mnemonic -- created in step 2, never copied into the image
```

`worker.py` — the minimal worker (replace the body of `run_model` with your model, and `COPY` any extra model files in the Dockerfile below):

```python
import asyncio
import os

from allora_sdk import AlloraNetworkConfig, AlloraWorker

async def run_model(nonce: int) -> float:
    # Your ML model's prediction logic goes here
    return 123.45

async def main():
    worker = AlloraWorker.inferer(
        run=run_model,
        topic_id=69,
        network=AlloraNetworkConfig.testnet(),
        api_key=os.environ.get("ALLORA_API_KEY"),
    )
    async for result in worker.run():
        if isinstance(result, Exception):
            print(f"Inference worker error: {result}")
        else:
            print(f"Prediction submitted to Allora: {result.submission}")

asyncio.run(main())
```

`requirements.txt` — the SDK plus whatever your model imports:

```text
allora_sdk
```

### 2. Create the wallet key on the host

Inside a container the worker cannot prompt you for a mnemonic, so create the `.allora_key` file on the host first. Either run the worker once locally (press **Enter** at the `Mnemonic:` prompt to generate an identity — see the [SDK guide](https://docs.allora.network/build/worker/sdk-py#2-start-with-a-minimal-worker)), or write an existing mnemonic to the file yourself:

```bash
( umask 077; printf '%s\n' "$ALLORA_WALLET_MNEMONIC" > .allora_key )
```

`.allora_key` **is** your worker's identity and funds. Keep it out of the image and out of version control — add it to both `.dockerignore` and `.gitignore`, and keep a backup.

`.dockerignore`:

```text
.allora_key
.git
```

### 3. Write the Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .

# Stream logs straight to `docker logs` instead of buffering them
ENV PYTHONUNBUFFERED=1

CMD ["python", "worker.py"]
```

The SDK supports Python 3.10–3.13, so any `python:3.10-slim` through `python:3.13-slim` base works. If your model has heavier dependencies (for example `scikit-learn` from the [SDK guide's price model](https://docs.allora.network/build/worker/sdk-py#3-build-the-price-model)), add them to `requirements.txt` and `COPY` the model files next to `worker.py`.

### 4. Build the image

```bash
docker build -t allora-worker .
```

### 5. Run it with the key mounted and a restart policy

```bash
export ALLORA_API_KEY="<your key from developer.allora.network>"

docker run -d \
  --name allora-worker \
  --restart unless-stopped \
  -e ALLORA_API_KEY \
  -v "$PWD/.allora_key:/app/.allora_key:ro" \
  allora-worker
```

- `-v "$PWD/.allora_key:/app/.allora_key:ro"` mounts the mnemonic file **read-only** at the path the worker checks by default (`.allora_key` in its working directory, `/app`). The key never enters the image, so the image is safe to push to a registry.
- `--restart unless-stopped` restarts the container after a crash and when the Docker daemon comes back up (e.g. after a host reboot), but respects an explicit `docker stop`. Use `--restart always` if the worker should come back even after being stopped manually, or `--restart on-failure` to restart only on non-zero exits.
- `-e ALLORA_API_KEY` forwards the variable from your shell without writing the value into the command line or the image.

Prefer to pass the mnemonic as an environment variable instead of a file mount? Configure the wallet explicitly in `worker.py` — `wallet=AlloraWalletConfig(mnemonic=os.environ["ALLORA_WALLET_MNEMONIC"])` as shown in the [SDK guide](https://docs.allora.network/build/worker/sdk-py#6-configure-the-wallet) — and run with `-e ALLORA_WALLET_MNEMONIC`. Note that container environment variables are visible to anyone who can run `docker inspect` on the host; the read-only file mount is the safer default.

### 6. (Optional) Run it with Docker Compose

`docker-compose.yml`:

```yaml
services:
  worker:
    build: .
    container_name: allora-worker
    restart: unless-stopped
    environment:
      - ALLORA_API_KEY=${ALLORA_API_KEY}
    volumes:
      - ./.allora_key:/app/.allora_key:ro
```

```bash
docker compose up -d --build
```

## Verify

- `docker ps` shows the container with a status of `Up ...`.
- The restart policy is active:

  ```bash
  docker inspect -f '{{ .HostConfig.RestartPolicy.Name }}' allora-worker
  ```

  prints `unless-stopped`.
- `docker logs -f allora-worker` shows the same lifecycle as a local run — the wallet address and balance at startup (plus a faucet top-up on a fresh testnet wallet), then, each time a submission window opens, lines like:

  ```text
  🚀 Worker submission window opened (topic 69, nonce <block height>, height <block height>)
  👉 Found new nonce <block height> for topic 69, submitting...
  ✅ Successfully submitted: topic=69 nonce=<block height>
      - Transaction hash: <tx hash>
  Prediction submitted to Allora: <your prediction>
  ```

- Open [testnet.explorer.allora.network/topics/69](https://testnet.explorer.allora.network/topics/69) and look for your worker's `allo...` address among the topic's workers. For dashboards and on-chain score queries, see [Monitor a Worker](https://docs.allora.network/build/worker/monitoring).

## Kubernetes

The same container runs on Kubernetes with three adjustments:

- **One replica per wallet.** Run the worker as a Deployment with `replicas: 1`. Transactions from one account must be submitted in strict sequence order, so two pods signing with the same key will conflict. To scale across topics, run one Deployment (and one wallet) per topic.
- **Key from a Secret.** Store the mnemonic in a Kubernetes Secret and mount it read-only at `/app/.allora_key` (or expose it as an environment variable consumed by `AlloraWalletConfig`, as above). Do not bake it into the image.
- **Restarts come built in.** A Deployment's default `restartPolicy: Always` replaces the Docker restart policy; nothing extra is needed for crash recovery.

`docker stop`, Compose shutdowns, and Kubernetes pod termination all deliver SIGTERM, which the worker treats as a graceful shutdown.

## Troubleshoot

- **Container exits immediately or restart-loops** — read `docker logs allora-worker`. The most common cause is a missing key mount: without `/app/.allora_key`, the worker falls back to its interactive mnemonic prompt, which fails in a detached container. Check the mount path and that `.allora_key` exists on the host.
- **No log output** — Python buffers stdout by default when it is not a TTY. The Dockerfile above sets `PYTHONUNBUFFERED=1`; if you wrote your own, add it (or run `python -u worker.py`).
- **`Too many faucet requests`** — the testnet faucet is rate-limited. Send ALLO to the worker's address from another wallet, or request funds manually at [faucet.testnet.allora.network](https://faucet.testnet.allora.network), then restart the container.
- **gRPC `StatusCode.UNIMPLEMENTED` with `unknown service emissions.vN.QueryService`** — the image holds an SDK release older than the deployed network. Rebuild without cache to pick up the latest release: `docker build --no-cache -t allora-worker .`. For reproducible deploys, pin the version in `requirements.txt` (e.g. <Code>allora_sdk==<Version of="allora-sdk"/></Code>) and bump it deliberately.
- **Worker runs but never submits** — submission windows only open once per topic epoch, so quiet stretches are normal. Confirm the worker is registered and scored via [Monitor a Worker](https://docs.allora.network/build/worker/monitoring).

## Next

- Watch your worker: [monitor a worker](https://docs.allora.network/build/worker/monitoring) — dashboards, logs, and EMA scores
- Full worker configuration — wallets, networks, fee tiers: [build a worker with the Python SDK](https://docs.allora.network/build/worker/sdk-py)
- Pick a topic to serve: [existing topics](https://docs.allora.network/build/forge/topics)
