import { Table, Td, Th, Tr } from 'nextra/components'

import topicsData from '../public/api/topics.json'

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

/** ISO date (YYYY-MM-DD) of the run that last changed the topic data. */
export const topicsGeneratedOn = topicsData.generated_at.slice(0, 10)

/** Metadata for one network: chain ID, emissions API version, active count. */
export function topicsNetworkInfo(network) {
  return topicsData.networks.find(entry => entry.network === network)
}

/** The topics of one network, already ordered by numeric topic ID. */
export function topicsFor(network) {
  return topicsData.topics.filter(topic => topic.network === network)
}

/** Comma-separated sandbox topic IDs for one network, e.g. "69 and 77". */
export function sandboxTopicIds(network) {
  return topicsFor(network)
    .filter(topic => topic.sandbox)
    .map(topic => topic.id)
}

/** The date the committed topic data was last regenerated from chain state. */
export function TopicsGeneratedOn() {
  return <>{topicsGeneratedOn}</>
}

/** Number of active topics on one network, per the committed data. */
export function TopicsCount({ network }) {
  return <>{topicsFor(network).length}</>
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
