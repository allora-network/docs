---
title: Stake Parameters
description: Parameters that affect both kinds of staking featured by Allora.
persona: Builder or operator
verified_against: every value re-read from the live testnet and mainnet LCD /cosmos/staking/v1beta1/params on 2026-08-02
last_reviewed: 2026-08-02
---

# Stake Parameters

> Parameters that affect both kinds of staking featured by Allora

There are two types of staking in Allora Network which run through different staking mechanisms: Validation staking and Reputational staking.

**Validation staking** comes from the popular `staking` module on Cosmos SDK. It is used when staking into Validator nodes.

**Reputational staking** is specific to Allora Network, and it is used to stake into Worker and Reputer nodes.

The parameters for the two types are specified below.

## Reputational Staking

Parameters from the reputational-staking module on Allora Network. These are parameters for staking into reputers and workers.

These parameters are defined as "Chain Parameters" and can be found [here](https://docs.allora.network/reference/params/chain).

The parameters of concern to reputers in particular are:

- **required_minimum_stake**
- **remove_stake_delay_window**

## Validation Staking

Parameters from the validator-based staking module on Allora Network. These are set per network,
so testnet and mainnet do not always agree; the values below were read from
`<lcd>/cosmos/staking/v1beta1/params` on both networks on 2026-08-02.

**unbonding_time**

Sets the duration for which tokens remain bonded after initiating the unbonding process.

Value: mainnet `1814400s` (21 days), testnet `86400s` (1 day)

A longer unbonding time enhances security by discouraging malicious actors and stabilizes token supply dynamics, but too long a period may inconvenience users who want to unstake their tokens promptly. This setting achieves a reasonable trade-off.

**max_validators**

Sets the maximum number of validators allowed in the network.

Value: mainnet `17`, testnet `50`

It balances decentralization with network scalability. It will be regularly assessed and adjusted based on the network's growth and decentralization.

**max_entries**

Determines the maximum number of entries in the staking transaction pool.

Value: `7`

Standard value.
It balances the transaction pool size based on expected network demand. It will be regularly assessed and adjusted as the network evolves.

**historical_entries**

Sets the maximum number of historical entries stored in the staking module.

Value: `10000`

Standard value.
It balances historical data retention with storage efficiency. It will be regularly assessed and adjusted based on storage capabilities and network requirements.

**bond_denom**

Specifies the denomination of the bonded tokens.

Value: `uallo`

**min_commission_rate**

Sets the minimum commission rate a validator can charge.

Value: `0.050000000000000000` (5%) on both networks

A floor on commission keeps validator operation economically viable while leaving operators free to
compete above it.
