import asyncio
import os

from allora_sdk import AlloraRPCClient, FeeTier
from allora_sdk.protos.emissions.v9 import (
    CanSubmitWorkerPayloadRequest,
    GetForecastsAtBlockRequest,
    GetLatestNetworkInferencesRequest,
    GetUnfulfilledWorkerNoncesRequest,
    IsWorkerRegisteredInTopicIdRequest,
)
from allora_sdk.rpc_client.config import AlloraWalletConfig

TOPIC_ID = 69
POLL_SECONDS = 120


def forecast_losses(inferer_addresses: list[str], nonce: int) -> dict[str, float]:
    # Your ML model goes here: for each inferer, predict the loss of the
    # inference it submits this epoch.
    return {address: 0.05 for address in inferer_addresses}


def my_inference(nonce: int) -> float:
    # A worker payload always carries your own inference for the topic.
    return 123.45


async def main():
    client = AlloraRPCClient.testnet(
        wallet=AlloraWalletConfig(mnemonic=os.environ["ALLORA_WALLET_MNEMONIC"]),
        debug=False,
    )
    address = client.address

    # Register on the topic (first run only) -- forecasters register as workers,
    # exactly like inferers
    registered = client.emissions.query.is_worker_registered_in_topic_id(
        IsWorkerRegisteredInTopicIdRequest(topic_id=TOPIC_ID, address=address)
    )
    if not registered.is_registered:
        tx = await client.emissions.tx.register(
            topic_id=TOPIC_ID,
            owner_addr=address,
            sender_addr=address,
            is_reputer=False,
            fee_tier=FeeTier.PRIORITY,
        )
        result = await tx.wait()
        if result.code != 0:
            raise SystemExit(f"Registration failed (code {result.code}): {result.raw_log}")
        print(f"Registered {address} on topic {TOPIC_ID}")

    whitelisted = client.emissions.query.can_submit_worker_payload(
        CanSubmitWorkerPayloadRequest(topic_id=TOPIC_ID, address=address)
    )
    if not whitelisted.can_submit_worker_payload:
        raise SystemExit(f"{address} is not whitelisted on topic {TOPIC_ID} -- contact the topic creator")

    # Wait for an open submission window (an unfulfilled worker nonce)
    while True:
        resp = client.emissions.query.get_unfulfilled_worker_nonces(
            GetUnfulfilledWorkerNoncesRequest(topic_id=TOPIC_ID)
        )
        nonces = resp.nonces.nonces if resp.nonces is not None else []
        if nonces:
            nonce = nonces[0].block_height
            break
        print(f"No open submission window on topic {TOPIC_ID}, retrying in {POLL_SECONDS}s")
        await asyncio.sleep(POLL_SECONDS)

    # Find the inferers whose accuracy you are forecasting
    latest = client.emissions.query.get_latest_network_inferences(
        GetLatestNetworkInferencesRequest(topic_id=TOPIC_ID)
    )
    if latest.network_inferences is None or not latest.network_inferences.inferer_values:
        raise SystemExit(f"Topic {TOPIC_ID} has no network inferences yet -- nothing to forecast")
    inferers = [v.worker for v in latest.network_inferences.inferer_values]

    # Run your model and submit the forecast alongside your own inference
    losses = forecast_losses(inferers, nonce)
    pending = await client.emissions.tx.insert_worker_payload(
        topic_id=TOPIC_ID,
        inference_value=str(my_inference(nonce)),
        nonce=nonce,
        forecast_elements=[
            {"inferer": inferer, "value": str(loss)} for inferer, loss in losses.items()
        ],
        fee_tier=FeeTier.STANDARD,
    )
    result = await pending.wait()
    if result.code != 0:
        raise SystemExit(f"Submission failed (code {result.code}): {result.raw_log}")
    print(f"Forecast for {len(losses)} inferers submitted in transaction {result.txhash}")


asyncio.run(main())
