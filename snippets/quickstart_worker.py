import asyncio
import os

from allora_sdk import AlloraNetworkConfig, AlloraWorker, RunContext


async def run_model(context: RunContext) -> float:
    # Replace this with your model's prediction logic.
    return 123.45


async def main():
    worker = AlloraWorker.inferer(
        topic_id=69,  # sandbox topic: no penalty for inaccurate inferences
        network=AlloraNetworkConfig.testnet(),
        api_key=os.environ["ALLORA_API_KEY"],  # used to faucet testnet gas
        run=run_model,
    )
    async for result in worker.run():
        if isinstance(result, Exception):
            print(f"Inference worker error: {result}")
        else:
            print(f"Prediction submitted to Allora: {result.submission}")


asyncio.run(main())
