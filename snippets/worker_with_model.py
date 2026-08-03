import asyncio
import os

from allora_sdk import AlloraNetworkConfig, AlloraWorker, RunContext

from model import predict_price, train

# Train once at startup (retrain and restart as often as you like)
model = train()

def run_model(ctx: RunContext) -> float:
    prediction = predict_price(model)
    print(f"Predicted BTC/USD price in 24 hours: {prediction:,.2f}")
    return prediction

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
