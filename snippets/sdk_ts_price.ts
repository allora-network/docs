import {
  AlloraAPIClient,
  ChainSlug,
  PriceInferenceToken,
  PriceInferenceTimeframe,
} from "@alloralabs/allora-sdk";

const client = new AlloraAPIClient({
  chainSlug: ChainSlug.TESTNET,
  apiKey: process.env.ALLORA_API_KEY,
});

async function main() {
  const inference = await client.getPriceInference(
    PriceInferenceToken.BTC,
    PriceInferenceTimeframe.EIGHT_HOURS,
  );
  console.log(`BTC price prediction (8h): ${inference.inference_data.network_inference_normalized}`);
  console.log(`Signature: ${inference.signature}`);
}

main();
