import versionsJson from '../public/api/versions.json'

/**
 * The single source of truth for every "current version" string in the docs is
 * `public/api/versions.json`, which is also published at
 * https://docs.allora.network/api/versions.json.
 *
 * Never hand-type a current version in a page. Write `<Version of="chain-testnet"/>`
 * instead; `scripts/checkVersionStrings.js` (chained into `yarn build`) fails the
 * build if a version literal from that file is typed by hand anywhere else.
 *
 * Usage in .mdx:
 *
 *   import { Version } from '../../components/Version'
 *
 *   The testnet runs <Version of="chain-testnet"/>.
 *   The release asset is named `allorad_<Version of="chain-testnet" bare/>_linux_amd64`.
 *
 * `of` accepts either the JSON key (`chain_testnet`) or its hyphenated form
 * (`chain-testnet`). `bare` strips the leading `v`, matching the form used in
 * release-asset filenames and PyPI pins.
 */

// `superseded` is the reserved key holding the values each version key has
// already moved past; it is bookkeeping for scripts/checkVersionStrings.js, not
// a version id, so it never appears in VERSION_IDS.
const { superseded: _superseded, ...currentVersions } = versionsJson

const versions: Record<string, string> = currentVersions

/** Every id `<Version of="..."/>` accepts, in the JSON's own (underscore) spelling. */
export const VERSION_IDS: string[] = Object.keys(versions)

/**
 * Resolves a version id to its string. Throws on an unknown id so a typo fails
 * `next build` at prerender time with a named page, rather than silently
 * rendering an empty string into published docs.
 */
export function versionOf(of: string, options: { bare?: boolean } = {}): string {
  const key = String(of).replace(/-/g, '_')
  const value = versions[key]

  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `<Version of="${of}"/>: unknown version id. ` +
        `public/api/versions.json defines: ${VERSION_IDS.join(', ')} ` +
        `(hyphens and underscores are interchangeable).`
    )
  }

  return options.bare ? value.replace(/^v/, '') : value
}

export function Version({ of, bare = false }: { of: string; bare?: boolean }) {
  return <>{versionOf(of, { bare })}</>
}

export default Version
