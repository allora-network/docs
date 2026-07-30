import { AlloraAPIClient, ChainSlug } from "@alloralabs/allora-sdk";

async function main() {
  const client = new AlloraAPIClient({
    chainSlug: ChainSlug.TESTNET,
    apiKey: process.env.ALLORA_API_KEY,
    baseAPIUrl: "https://api.allora.network/v2",
  });

  const inference = await client.getInferenceByTopicID(69);
  const data = inference.inference_data;
  console.log(`Topic ${data.topic_id} network inference: ${data.network_inference_normalized}`);
  console.log(`Timestamp: ${data.timestamp}`);
}

main();
