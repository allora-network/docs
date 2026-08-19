import manifest from '../public/api/networks.json'

/**
 * The single source of truth for every per-network fact the docs state as
 * *current* is `public/api/networks.json`, which is also published at
 * https://docs.allora.network/api/networks.json.
 *
 * `<Version of="chain-mainnet"/>` already covers the release tag, because that
 * value is mirrored into `public/api/versions.json`. Everything else the
 * manifest owns — the emissions namespace above all — had no such component,
 * so pages hand-typed it. When mainnet took its emissions upgrade, the old
 * namespace outlived the move in four pages and in two runnable curl examples
 * that had by then started answering `501 Not Implemented`, while the manifest
 * itself was corrected: nothing connected the prose to the fact.
 *
 * Write `<NetworkValue network="mainnet" field="emissions_namespace"/>` instead;
 * `scripts/checkVersionStrings.js` (chained into `yarn build`) fails the build
 * if a value this manifest owns is typed by hand anywhere in pages/, components/
 * or snippets/.
 *
 * Usage in .mdx:
 *
 *   import { NetworkValue } from '../../components/NetworkValue'
 *
 *   Mainnet serves <NetworkValue network="mainnet" field="emissions_namespace"/>.
 *
 * Reach for the `networkValueOf` helper only where JSX cannot render — inside a
 * template literal that builds a copy-paste command, for example.
 */

type Networks = Record<string, Record<string, unknown>>

const networks = manifest.networks as unknown as Networks

/** Every network id these accessors accept. */
const NETWORK_IDS: string[] = Object.keys(networks)

/**
 * Resolves a network field to its string. Throws on an unknown network or field
 * so a typo fails `next build` at prerender time with a named page, rather than
 * silently rendering an empty string into published docs — the same contract
 * `versionOf` holds.
 */
export function networkValueOf(network: string, field: string): string {
  const entry = networks[network]

  if (!entry) {
    throw new Error(
      `<NetworkValue network="${network}"/>: unknown network. ` +
        `public/api/networks.json defines: ${NETWORK_IDS.join(', ')}.`
    )
  }

  const value = entry[field]

  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `<NetworkValue network="${network}" field="${field}"/>: ` +
        `public/api/networks.json has no non-empty string at networks.${network}.${field}. ` +
        `That entry defines: ${Object.keys(entry).join(', ')}.`
    )
  }

  return value
}

export function NetworkValue({ network, field }: { network: string; field: string }) {
  return <>{networkValueOf(network, field)}</>
}

export default NetworkValue
