---
title: Allora CLI Spec
description: Install and use allorad, the CLI tool for reading and writing data to the Allora chain.
persona: New Allora developer
verified_against: docs content as of 2026-07-30
last_reviewed: 2026-07-30
---

# Allora CLI Spec

Allora provides a CLI tools that allows network participants to perform different functions on the Allora Network:

- `allorad` -  Used to read and write data to the chain, e.g. to create a wallet, create new topics or add/delegate stake to a reputer
  - Refer to the [Allorad Reference](https://docs.allora.network/reference/allorad) section for a full list of `allorad` commands with their explanations

## Installing `allorad`

### Prerequisites

You will need to install `go` to download and use `allorad` successfully.

To install Go, follow one of the recommended methods below or consult the [official Go documentation](https://go.dev/doc/install) for the correct download for your operating system. The command-line instructions are based on standard installation locations, but you may customize them as needed.

### Installation

The command below installs <Version of="chain-testnet"/>, the version currently deployed on the testnet. If you are targeting mainnet, pass <Version of="chain-mainnet"/> instead — see [Networks](https://docs.allora.network/reference/networks) for the version deployed on each network.

```bash
curl -sSL https://raw.githubusercontent.com/allora-network/allora-chain/dev/install.sh | bash -s -- ${CHAIN_VERSION_TESTNET}
```

A **successful** installation should output the following line:

```bash
YYYY-MM-DD hh:mm:ss (N MB/s) - ‘/tmp/allorad’ saved [<file-size>/<file-size>]
```

### Verifying Installation

After installation, verify that `allorad` is correctly installed and ready to interact with the Allora Network by running:

```
allorad version
```

`allorad` supports general Cosmos SDK and Tendermint commands. You can run the tool to see a list of commands with explanations of what they do:

```text
$ allorad
allorad - the Allora chain

Usage:
  allorad [command]

Available Commands:
  comet       CometBFT subcommands
  completion  Generate the autocompletion script for the specified shell
  config      Utilities for managing application configuration
  debug       Tool for helping with debugging your application
  export      Export state to JSON
  genesis     Application's genesis-related subcommands
  help        Help about any command
  init        Initialize private validator, p2p, genesis, and application configuration files
  keys        Manage your application's keys
  prune       Prune app history states by keeping the recent heights and deleting old heights
  query       Querying subcommands
  rollback    rollback Cosmos SDK and CometBFT state by one height
  snapshots   Manage local snapshots
  start       Run the full node
  status      Query remote node for status
  tx          Transactions subcommands
  version     Print the application binary version information

Flags:
  -h, --help                help for allorad
      --home string         directory for config and data (default "/Users/<USER>/.allorad")
      --log_format string   The logging format (json|plain) (default "plain")
      --log_level string    The logging level (trace|debug|info|warn|error|fatal|panic|disabled or '*:<level>,<key>:<level>') (default "info")
      --log_no_color        Disable colored logs
      --trace               print out full stack trace on errors

Use "allorad [command] --help" for more information about a command.
```
