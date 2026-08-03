import asyncio
import os

from allora_sdk import AlloraNetworkConfig, AlloraWorker
from allora_sdk.rpc_client.config import AlloraWalletConfig

async def run_model(nonce: int) -> float:
    # The prediction logic your inference server exposed over HTTP goes here
    return 123.45

async def main():
    worker = AlloraWorker.inferer(
        run=run_model,
        # Your worker[].topicId from config.json
        topic_id=69,
        network=AlloraNetworkConfig.testnet(),
        # Keep your existing address: reuse wallet.addressRestoreMnemonic from config.json.
        # Omit `wallet=` to generate a fresh identity instead.
        wallet=AlloraWalletConfig(mnemonic=os.environ["ALLORA_WALLET_MNEMONIC"]),
        api_key=os.environ["ALLORA_API_KEY"],
    )
    async for result in worker.run():
        if isinstance(result, Exception):
            print(f"Inference worker error: {result}")
        else:
            print(f"Prediction submitted to Allora: {result.submission}")

asyncio.run(main())
