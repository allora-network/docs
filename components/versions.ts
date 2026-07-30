/**
 * Temporary single source of truth for the `allora-chain` version pins used
 * across the docs. To be superseded by a generated versions.json later.
 *
 * Until then, update these constants by hand whenever a network is upgraded
 * to a new release (https://github.com/allora-network/allora-chain/releases).
 * Import them into .mdx pages instead of hardcoding version strings in
 * install commands or prose.
 */
export const CHAIN_VERSION_TESTNET = 'v0.17.0'
export const CHAIN_VERSION_MAINNET = 'v0.16.0'

/** The same versions without the leading "v", as used in release-asset filenames. */
export const CHAIN_VERSION_TESTNET_BARE = CHAIN_VERSION_TESTNET.replace(/^v/, '')
export const CHAIN_VERSION_MAINNET_BARE = CHAIN_VERSION_MAINNET.replace(/^v/, '')
