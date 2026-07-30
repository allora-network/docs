import React from 'react'
import { useConfig } from 'nextra-theme-docs'

/**
 * Verification badge driven by the page's frontmatter:
 *
 *   Verified against <verified_against> · reviewed <last_reviewed>
 *
 * Rendered on every page via the theme's `main` slot in theme.config.tsx.
 * Can also be embedded directly in MDX as <PageMeta />.
 *
 * See CONTRIBUTING.md ("Page template & PR checklist") for what the
 * frontmatter keys mean and when to update them.
 */

// YAML parses unquoted dates (last_reviewed: 2026-07-30) into Date objects,
// which Next.js then serializes to ISO strings ("2026-07-30T00:00:00.000Z").
// Reduce either form back to plain YYYY-MM-DD.
function formatValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value)
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/)
  return isoDate ? isoDate[1] : text
}

export default function PageMeta() {
  const { frontMatter } = useConfig()
  const verified = formatValue(frontMatter?.verified_against)
  const reviewed = formatValue(frontMatter?.last_reviewed)
  if (!verified && !reviewed) return null

  return (
    <div
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: '0.4em',
        marginTop: '1.5rem',
        padding: '0.3em 0.9em',
        borderRadius: '9999px',
        border: '1px solid hsl(var(--nextra-primary-hue) var(--nextra-primary-saturation) 45% / 0.4)',
        fontSize: '0.75rem',
        lineHeight: 1.6,
        opacity: 0.85,
      }}
    >
      {verified && <span>Verified against {verified}</span>}
      {verified && reviewed && <span aria-hidden="true">·</span>}
      {reviewed && <span>reviewed {reviewed}</span>}
    </div>
  )
}
