import { useMDXComponents } from 'nextra/mdx'
import manifest from '../public/api/networks.json'

/**
 * Renders the network endpoint tables on /reference/networks from
 * public/api/networks.json — the same file that is served verbatim at
 * /api/networks.json for programmatic consumers. Editing the JSON is the only
 * way to change what this page shows; nothing here hardcodes an endpoint.
 *
 * Row order and human labels are presentation, so they live here rather than in
 * the manifest. A field missing from the manifest renders as an em dash (for
 * example, mainnet has no faucet).
 */
const FIELDS = [
  { key: 'chain_id', label: 'Chain ID', code: true },
  { key: 'deployed_version', label: 'Deployed version', code: false },
  { key: 'emissions_namespace', label: 'Emissions API namespace', code: true },
  { key: 'rpc', label: 'RPC JSON', code: true },
  { key: 'grpc', label: 'gRPC', code: true },
  { key: 'lcd', label: 'API (Cosmos LCD - REST)', code: true },
  { key: 'explorer', label: 'Explorer', code: true },
  { key: 'faucet', label: 'Faucet', code: true },
]

const NETWORK_KEYS = Object.keys(manifest.networks)

// Borrow the theme's MDX element mapping so component-rendered tables and lists
// are styled exactly like the ones authored in markdown. Falls back to plain
// tags if this ever renders outside an MDX provider.
function useElements() {
  const components = useMDXComponents() || {}
  return {
    Table: components.table || 'table',
    Tr: components.tr || 'tr',
    Th: components.th || 'th',
    Td: components.td || 'td',
    Code: components.code || 'code',
    Ul: components.ul || 'ul',
    Li: components.li || 'li',
  }
}

function renderValue(value, code, Code) {
  if (!value) {
    return '—'
  }
  return code ? <Code>{value}</Code> : value
}

/** Side-by-side comparison of every network in the manifest. */
export default function NetworksTable() {
  const { Table, Tr, Th, Td, Code } = useElements()

  return (
    <Table>
      <thead>
        <Tr>
          <Th />
          {NETWORK_KEYS.map(key => (
            <Th key={key}>{manifest.networks[key].name}</Th>
          ))}
        </Tr>
      </thead>
      <tbody>
        {FIELDS.map(({ key, label, code }) => (
          <Tr key={key}>
            <Td>
              <strong>{label}</strong>
            </Td>
            {NETWORK_KEYS.map(network => (
              <Td key={network}>
                {renderValue(manifest.networks[network][key], code, Code)}
              </Td>
            ))}
          </Tr>
        ))}
      </tbody>
    </Table>
  )
}

/** The same fields for a single network, as a list. */
export function NetworkDetails({ network }) {
  const { Ul, Li, Code } = useElements()
  const entry = manifest.networks[network]

  if (!entry) {
    throw new Error(
      `Unknown network "${network}" — public/api/networks.json defines: ${NETWORK_KEYS.join(', ')}`
    )
  }

  return (
    <Ul>
      {FIELDS.map(({ key, label, code }) => (
        <Li key={key}>
          <strong>{label}</strong>: {renderValue(entry[key], code, Code)}
        </Li>
      ))}
    </Ul>
  )
}
