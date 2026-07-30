import asyncio

from allora_sdk import AlloraNetworkConfig, AlloraWorker, RunContext


async def run_model(context: RunContext) -> float:
    # Replace this with your model's prediction logic.
    return 123.45


async def main():
    worker = AlloraWorker.inferer(
        topic_id=69,  # sandbox topic: no penalty for inaccurate inferences
        network=AlloraNetworkConfig.testnet(),
        run=run_model,
    )
    async for result in worker.run():
        if isinstance(result, Exception):
            print(f"Inference worker error: {result}")
        else:
            print(f"Prediction submitted to Allora: {result.submission}")


asyncio.run(main())
