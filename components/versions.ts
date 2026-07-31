/**
 * `allora-chain` version pins, derived from `public/api/versions.json` — the one
 * file in this repo allowed to contain a current-version literal.
 *
 * Prefer the `<Version of="chain-testnet"/>` component (components/Version.tsx)
 * in prose and tables. Reach for these constants only where JSX cannot render:
 * inside a template literal that builds a copy-paste command, for example
 * `<Code>{`... ${CHAIN_VERSION_TESTNET}`}</Code>`.
 *
 * To change a version, edit `public/api/versions.json`. Nothing here is
 * hand-maintained; `.github/workflows/version-bump.yml` opens a PR against that
 * file when upstream tags a release.
 */
import { versionOf } from './Version'

export const CHAIN_VERSION_TESTNET = versionOf('chain-testnet')
export const CHAIN_VERSION_MAINNET = versionOf('chain-mainnet')

/** The same versions without the leading "v", as used in release-asset filenames. */
export const CHAIN_VERSION_TESTNET_BARE = versionOf('chain-testnet', { bare: true })
export const CHAIN_VERSION_MAINNET_BARE = versionOf('chain-mainnet', { bare: true })
