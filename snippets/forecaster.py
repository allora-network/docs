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
