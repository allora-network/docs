import asyncio
import os

from allora_sdk.api_client import AlloraAPIClient, ChainID


async def main():
    client = AlloraAPIClient(
        chain_id=ChainID.TESTNET,
        api_key=os.environ["ALLORA_API_KEY"],
    )
    inference = await client.get_inference_by_topic_id(69)
    data = inference.inference_data
    print(f"Topic {data.topic_id} network inference: {data.network_inference_normalized}")
    print(f"Timestamp: {data.timestamp}")


asyncio.run(main())
