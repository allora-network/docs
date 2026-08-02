---
title: Mint Parameters
description: Parameters from the minting module on Allora Network.
persona: Builder or operator
verified_against: live testnet and mainnet LCD /mint/v5/params (identical on both) and allora-chain v0.17.0 x/mint/proto/mint/v5/types.proto; historical parameters checked against v0.0.10 x/mint/types/params.go, 2026-08-02
last_reviewed: 2026-08-02
---

# Mint Parameters

> Parameters from the minting module on Allora Network

The mint module holds the emission schedule. Query the live set at
`<lcd>/mint/v5/params` — see [Networks](https://docs.allora.network/reference/networks) for each network's LCD URL.

## Current Parameters

Values below were read from `/mint/v5/params` on 2026-08-02 and were identical on testnet and
mainnet. Descriptions are the field comments from `x/mint/proto/mint/v5/types.proto`.

| Parameter | Meaning | Value |
|---|---|---|
| `mint_denom` | Type of coin to mint | `uallo` |
| `max_supply` | Maximum total supply of the coin | `1000000000000000000000000000` (1e27 uallo = 1 billion ALLO) |
| `f_emission` | Ecosystem treasury fraction ideally emitted per unit time | `0.035` |
| `one_month_smoothing_degree` | One-month exponential moving average smoothing factor | `0.1` |
| `ecosystem_treasury_percent_of_total_supply` | Percentage of total supply reserved and locked in the ecosystem treasury | `0.2145` |
| `foundation_treasury_percent_of_total_supply` | Percentage of total supply unlocked and usable in the foundation treasury | `0.177` |
| `participants_percent_of_total_supply` | Percentage of total supply unlocked and usable by participants at genesis | `0.123` |
| `investors_percent_of_total_supply` | Percentage of total supply locked in the investors bucket at genesis | `0.3105` |
| `investors_preseed_percent_of_total_supply` | Percentage of total supply locked in the preseed investors bucket at genesis | `0.0` |
| `team_percent_of_total_supply` | Percentage of total supply locked in the team bucket at genesis | `0.175` |
| `maximum_monthly_percentage_yield` | The capped maximum monthly percentage yield | `0.0095` |
| `emission_enabled` | Whether the network is allowed to emit any rewards | `true` |

The module also exposes the current annualised inflation at `<lcd>/mint/v5/inflation` and a
breakdown at `<lcd>/mint/v5/emission_info`.

## Historical Parameters

The mint module originally used the Cosmos SDK's inflation parameters. They are declared in
allora-chain through the v0.0.x line, and no release since defines them — the current module takes
the parameter set above instead. They are kept here because older material still refers to them.
Values are the defaults from v0.0.10 `x/mint/types/params.go`.

| Parameter | Meaning | Historical default |
|---|---|---|
| `inflation_rate_change` | Maximum annual change in the inflation rate | `357.3582624` |
| `inflation_max` | Maximum inflation rate | `357.3582624` |
| `inflation_min` | Minimum inflation rate | `0` |
| `goal_bonded` | Target ratio of bonded (staked) tokens to total supply | `0.67` |
| `blocks_per_year` | Blocks the inflation schedule assumes per year | `6311520` (a block every ~5 seconds) |
| `halving_interval` | Block interval for halving the block reward | `25246080` |
| `current_block_provision` | Initial provision minted per block | `2831000000000000000` uallo (2.831 ALLO) |
