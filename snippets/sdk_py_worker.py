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
        api_key=os.environ["ALLORA_API_KEY"],
    )
    async for result in worker.run():
        if isinstance(result, Exception):
            print(f"Inference worker error: {result}")
        else:
            print(f"Prediction submitted to Allora: {result.submission}")

asyncio.run(main())
