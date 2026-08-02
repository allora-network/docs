import { Table, Td, Th, Tr } from 'nextra/components'
import { useMDXComponents } from 'nextra/mdx'

import topicsData from '../public/api/topics.json'

// Borrow the theme's MDX element mapping so a list rendered from data is styled
// exactly like one written in markdown, as components/NetworksTable.js does.
// Falls back to plain tags outside an MDX provider.
function useListElements() {
  const components = useMDXComponents() || {}
  return {
    Ul: components.ul || 'ul',
    Li: components.li || 'li',
    Code: components.code || 'code',
  }
}

/**
 * Renders the active-topics table for one Allora network straight from
 * `public/api/topics.json`, which a scheduled job regenerates from live chain
 * state (see scripts/generateTopics.js). Nothing here is maintained by hand.
 */

const COLUMNS = [
  'Topic ID',
  'Metadata',
  'Epoch Length (blocks)',
  'Category',
  'Loss Method'
]

const BADGE_CLASS =
  'nx-ml-2 nx-rounded nx-border nx-px-1 nx-text-xs nx-font-semibold nx-uppercase nx-text-gray-500'

// The classes nextra-theme-docs adds when it maps a markdown `table` onto the
// shared Table component, so a table rendered from data is indistinguishable
// from one written as markdown (top margin, themed horizontal scrollbar).
const TABLE_CLASS = 'nextra-scrollbar nx-mt-6 nx-p-0 first:nx-mt-0'

// Everything below that is not a component stays module-private. Only the
// components are imported by pages, and an exported helper nothing consumes is
// a second contract to keep in step with the manifest for no benefit.

/**
 * ISO date (YYYY-MM-DD) of the run that last changed the topic data.
 *
 * scripts/generateTopics.js will not write a `generated_at` that is not a real
 * calendar instant, and scripts/lib/docsPages.js refuses to build the corpus
 * from one — but this runs at import time, so without a check of its own the
 * failure would be `Cannot read properties of undefined` with no file named.
 */
const topicsGeneratedOn = (() => {
  const value = topicsData.generated_at
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(
      `public/api/topics.json has no ISO-8601 "generated_at" (got ${JSON.stringify(value)}); ` +
        'regenerate it with `yarn topics`'
    )
  }
  return value.slice(0, 10)
})()

/** The topics of one network, already ordered by numeric topic ID. */
function topicsFor(network) {
  return topicsData.topics.filter(topic => topic.network === network)
}

/**
 * The sandbox ("playground") topics of one network — no whitelist, no
 * penalties, meant for a first worker submission.
 *
 * The flag comes from the data, which comes from `sandbox_topic_ids` in
 * `public/api/networks.json`: the one place the list is declared. Pages render
 * it through the components below rather than spelling the IDs out in prose,
 * so activating a sandbox topic is a one-line change to that manifest.
 */
function sandboxTopicsFor(network) {
  return topicsFor(network).filter(topic => topic.sandbox)
}

/** Sandbox topic IDs as a sentence fragment: "69 and 77", "69, 77 and 80". */
function sandboxTopicIdList(network) {
  const ids = sandboxTopicsFor(network).map(topic => topic.id)
  if (ids.length === 0) return 'none'
  if (ids.length === 1) return String(ids[0])
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

/** The date the committed topic data was last regenerated from chain state. */
export function TopicsGeneratedOn() {
  return <>{topicsGeneratedOn}</>
}

/** Number of active topics on one network, per the committed data. */
export function TopicsCount({ network }) {
  return <>{topicsFor(network).length}</>
}

/** Inline: the sandbox topic IDs of one network, e.g. "69 and 77". */
export function SandboxTopicIds({ network }) {
  return <>{sandboxTopicIdList(network)}</>
}

/**
 * The sandbox topics of one network as a list, each with its on-chain name.
 *
 * scripts/lib/docsPages.js renders the same list into the agent-facing corpus;
 * the two must agree, including the empty-state sentence below.
 */
export function SandboxTopics({ network }) {
  const { Ul, Li, Code } = useListElements()
  const topics = sandboxTopicsFor(network)

  if (topics.length === 0) {
    return <p>No sandbox topics are marked for {network}.</p>
  }

  return (
    <Ul>
      {topics.map(topic => (
        <Li key={topic.id}>
          <strong>{topic.id}</strong> — <Code>{topic.metadata}</Code>
        </Li>
      ))}
    </Ul>
  )
}

export function TopicsTable({ network }) {
  const topics = topicsFor(network)

  if (topics.length === 0) {
    return <p>No active topics recorded for {network}.</p>
  }

  return (
    <Table className={TABLE_CLASS}>
      <thead>
        <Tr>
          {COLUMNS.map(column => (
            <Th key={column}>{column}</Th>
          ))}
        </Tr>
      </thead>
      <tbody>
        {topics.map(topic => (
          <Tr key={topic.id}>
            <Td>
              <span className="nx-whitespace-nowrap">
                {topic.sandbox ? <strong>{topic.id}</strong> : topic.id}
                {topic.sandbox && <span className={BADGE_CLASS}>sandbox</span>}
              </span>
            </Td>
            <Td>{topic.metadata}</Td>
            <Td>{topic.epoch_length}</Td>
            <Td>{topic.category}</Td>
            <Td>{topic.loss_method}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  )
}

export default TopicsTable
