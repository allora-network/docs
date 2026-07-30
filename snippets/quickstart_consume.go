package main

import (
	"fmt"
	"log"
	"os"

	allora "github.com/allora-network/allora-sdk-go"
)

func main() {
	client := allora.NewAPIClient(os.Getenv("ALLORA_API_KEY"))

	topic, err := client.GetTopic(69)
	if err != nil {
		log.Fatal(err)
	}
	if topic.LatestNetworkInference == nil {
		log.Fatal("topic has no network inference yet")
	}

	fmt.Printf("%s (topic %d)\n", topic.TopicName, topic.TopicID)
	fmt.Printf("Network inference: %s\n", topic.LatestNetworkInference.CombinedValue)
}
