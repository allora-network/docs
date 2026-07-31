---
title: Allora Network Participants
description: The roles Allora Network participants fulfill — workers, reputers, validators, and consumers — and how to find yours.
persona: Protocol researcher
verified_against: docs content as of 2026-07-30
last_reviewed: 2026-07-30
---

# Allora Network Participants
Allora Network participants can fulfill a variety of different roles after any of these participants have created a topic.
A topic is registered on the Allora chain with a short rule set governing network interaction, including the loss function that needs to be optimized by the topic network.

Allora Labs will contribute to the development of the network alongside other external code contributors. Allora Labs will also participate in the network as a worker by running models.
Allora Labs will contribute as a sales/marketing service provider for Allora.

- **Workers** provide AI/ML-powered inferences to the network. These inferences can directly refer to the object that the network topic is generating or to the predicted quality of the inferences produced by other workers to help the network combine these inferences. A worker receives rewards proportional to the quality of its inferences.
- **Reputers** evaluate the quality of the inferences provided by the workers. This is done by comparing the inferences to the ground truth when available. Reputers also quantify how much these inferences contribute to the network-wide inference. A reputer receives rewards proportional to its stake and the quality of its evaluations. Reputers are often authoritative domain experts to assess the quality of inferences accurately.
- **Validators** are responsible for operating most of the infrastructure associated with instantiating the Allora Network by operating the appchain as Cosmos validators. Validators receive rewards proportional to their stake.
- **Consumers** request inferences from the network. They pay for the inferences using the native network token.

## Find Your Role

Participants can permissionlessly integrate with Allora to consume, supply, or verify the accuracy of exchanged inferences.

On-chain consumer contracts are being rebuilt, and their documentation will return when the new contracts ship. In the meantime, inferences can be consumed through the [Allora API](https://docs.allora.network/consume/api).
Here we'll help you find exactly what you're looking for.

- Discover the best way to participate, for:
  - [Data Scientists (Workers)](https://docs.allora.network/build/overview): Experts in machine learning or domain-specific insights who want to contribute their knowledge to the network.
  - [Developers (Consumers)](https://docs.allora.network/consume/overview): Individuals or organizations seeking crowdsourced predictions to integrate into their applications.
  - [Validators](https://docs.allora.network/operate/validators): Those with the skills and resources to run hardware and ensure the security and integrity of the network.
  - [Data Providers (Reputers)](https://docs.allora.network/build/reputer): Contributors who supply reliable data to evaluate and ensure the accuracy of predictions.
