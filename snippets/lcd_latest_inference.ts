// See https://docs.allora.network/reference/networks for the LCD URL and
// emissions namespace of each network.
const LCD_URL = "https://allora-api.testnet.allora.network";
const EMISSIONS = "emissions/v10";

async function getLatestInference(topicId: number): Promise<any> {
  const url = `${LCD_URL}/${EMISSIONS}/latest_network_inferences/${topicId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`LCD request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const data = await getLatestInference(1);
  // combined_value is a list of labeled values; a single-output topic has one entry ("y")
  console.log(`Latest inference: ${data.network_inferences.combined_value[0].value}`);
  console.log(`Inference block height: ${data.inference_block_height}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
