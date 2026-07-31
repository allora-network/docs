package main

import (
	"fmt"
	"os"

	allora "github.com/allora-network/allora-sdk-go"
)

func main() {
	client := allora.NewAPIClient(os.Getenv("ALLORA_API_KEY"))

	// Fetch a single topic (42 is the BTC/USD 8-hour price prediction topic)
	topic, err := client.GetTopic(42)
	if err != nil {
		fmt.Fprintln(os.Stderr, "failed to fetch topic:", err)
		os.Exit(1)
	}
	fmt.Printf("Topic %d: %s (workers: %d, active: %v)\n",
		topic.TopicID, topic.TopicName, topic.WorkerCount, topic.IsActive)
	if topic.LatestNetworkInference != nil {
		fmt.Printf("Latest network inference: %s\n", topic.LatestNetworkInference.CombinedValue)
	}

	// Iterate over every topic on the network (pagination is handled for you)
	count := 0
	for t, err := range client.GetTopics() {
		if err != nil {
			fmt.Fprintln(os.Stderr, "failed to fetch topics:", err)
			os.Exit(1)
		}
		if t.IsActive {
			count++
		}
	}
	fmt.Printf("Active topics: %d\n", count)
}
