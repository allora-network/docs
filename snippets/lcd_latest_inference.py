import json
import urllib.request

# See https://docs.allora.network/reference/networks for the LCD URL and
# emissions namespace of each network.
LCD_URL = "https://allora-api.testnet.allora.network"
EMISSIONS = "emissions/v10"


def get_latest_inference(topic_id):
    url = f"{LCD_URL}/{EMISSIONS}/latest_network_inferences/{topic_id}"
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


data = get_latest_inference(1)
# combined_value is a list of labeled values; a single-output topic has one entry ("y")
print(f"Latest inference: {data['network_inferences']['combined_value'][0]['value']}")
print(f"Inference block height: {data['inference_block_height']}")
