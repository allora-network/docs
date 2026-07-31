#!/usr/bin/env node
'use strict';

// Generates the machine-readable docs bundle that AI agents fetch:
//
//   public/llms.txt       an llmstxt.org index — every page as
//                         `- [Title](url): description`, grouped by section and
//                         listed in site navigation order.
//   public/llms-full.txt  the same pages concatenated in full, with MDX reduced
//                         to plain markdown.
//
// Both files are generated from pages/** at build time (chained into
// `yarn build`) and committed, because public/ is served statically. Run
// `node scripts/generateLlmsTxt.js --check` to verify the committed files still
// match pages/** without rewriting them; that mode runs in CI.
//
// The page walk, the frontmatter parse and the MDX → markdown reduction live in
// scripts/lib/docsPages.js, shared with scripts/generateRawMarkdown.js so the
// bundle and the per-page raw files can never disagree.
//
// Plain Node, no dependencies — the same constraint the other scripts in this
// directory follow so CI can run it without an install step.

const fs = require('fs');
const path = require('path');

const {
  PUBLIC_DIR,
  ROOT,
  SITE_NAME,
  SITE_URL,
  collectAllPages,
  mdxToMarkdown,
} = require('./lib/docsPages');

const INDEX_FILE = path.join(PUBLIC_DIR, 'llms.txt');
const FULL_FILE = path.join(PUBLIC_DIR, 'llms-full.txt');

const SITE_SUMMARY = [
  'Allora is a self-improving decentralized AI network: an open-source marketplace ' +
    'for machine intelligence where workers supply ML inferences, reputers score them ' +
    'against ground truth, and validators secure the chain.',
  'These docs cover getting started, building workers and reputers, consuming ' +
    'inference, operating the network, the concepts behind it, and reference material.',
];

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderIndex(rootPages, sections) {
  const lines = [`# ${SITE_NAME}`, ''];
  SITE_SUMMARY.forEach(line => lines.push(`> ${line}`));
  lines.push('');
  lines.push(
    `Every page below is live at ${SITE_URL}/. The full text of all of them is ` +
      `available in a single file at ${SITE_URL}/llms-full.txt.`
  );
  lines.push('');

  const entry = page => `- [${page.title}](${SITE_URL}${page.url}): ${page.description}`;

  rootPages.forEach(page => lines.push(entry(page)));
  if (rootPages.length > 0) lines.push('');

  sections.forEach(section => {
    lines.push(`## ${section.title}`);
    lines.push('');
    section.pages.forEach(page => lines.push(entry(page)));
    lines.push('');
  });

  return lines.join('\n').replace(/\n+$/, '\n');
}

function renderFull(pages) {
  const lines = [`# ${SITE_NAME}`, ''];
  SITE_SUMMARY.forEach(line => lines.push(`> ${line}`));
  lines.push('');
  lines.push(
    'This file is the complete text of every page on ' +
      `${SITE_URL}/, in site navigation order. Each page starts with a ` +
      'thematic break, its title as an H1, and the canonical URL it was ' +
      `generated from. The page index alone is at ${SITE_URL}/llms.txt.`
  );
  lines.push('');

  pages.forEach(page => {
    lines.push('---');
    lines.push('');
    lines.push(`# ${page.title}`);
    lines.push('');
    lines.push(`Source: ${SITE_URL}${page.url}`);
    lines.push('');
    if (page.description) {
      lines.push(page.description);
      lines.push('');
    }
    const markdown = mdxToMarkdown(page.file, page.body);
    if (markdown) {
      lines.push(markdown);
      lines.push('');
    }
  });

  return lines.join('\n').replace(/\n+$/, '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function build() {
  const { rootPages, sections, all } = collectAllPages();

  return {
    index: renderIndex(rootPages, sections),
    full: renderFull(all),
    pages: all,
  };
}

// Pulls the page URLs back out of a rendered llms.txt so --check can report a
// page-set drift ("this page is not listed") separately from a content drift.
function indexUrls(text) {
  const urls = [];
  const entry = /^- \[[^\]]*\]\(([^)]+)\):/gm;
  let match;
  while ((match = entry.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

function check(generated) {
  const problems = [];

  if (!fs.existsSync(INDEX_FILE)) {
    problems.push(`${path.relative(ROOT, INDEX_FILE)} does not exist.`);
  } else {
    const committed = fs.readFileSync(INDEX_FILE, 'utf8');
    const expected = new Set(indexUrls(generated.index));
    const actual = new Set(indexUrls(committed));

    const missing = [...expected].filter(url => !actual.has(url));
    const extra = [...actual].filter(url => !expected.has(url));

    missing.forEach(url => problems.push(`llms.txt is missing an entry for ${url}`));
    extra.forEach(url => problems.push(`llms.txt lists ${url}, which is not a live page`));

    if (missing.length === 0 && extra.length === 0 && committed !== generated.index) {
      problems.push(
        'llms.txt lists the right pages but its content is stale (titles, descriptions, or order changed).'
      );
    }
  }

  if (!fs.existsSync(FULL_FILE)) {
    problems.push(`${path.relative(ROOT, FULL_FILE)} does not exist.`);
  } else if (fs.readFileSync(FULL_FILE, 'utf8') !== generated.full) {
    problems.push('llms-full.txt is out of date with pages/**.');
  }

  if (problems.length > 0) {
    console.error(
      `llms.txt check failed: the committed files do not match the ${generated.pages.length} ` +
        'pages under pages/.\n'
    );
    problems.forEach(problem => console.error(`  ${problem}`));
    console.error('\nRun `node scripts/generateLlmsTxt.js` (or `yarn build`) and commit the result.');
    process.exit(1);
  }

  console.log(
    `llms.txt check OK: public/llms.txt and public/llms-full.txt match all ${generated.pages.length} pages.`
  );
}

function write(generated) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, generated.index, 'utf8');
  fs.writeFileSync(FULL_FILE, generated.full, 'utf8');
  console.log(
    `Generated public/llms.txt (${generated.pages.length} pages) and public/llms-full.txt ` +
      `(${Math.round(Buffer.byteLength(generated.full) / 1024)} KB).`
  );
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let generated;
  try {
    generated = build();
  } catch (error) {
    console.error(`llms.txt generation failed: ${error.message}`);
    process.exit(1);
  }
  if (checkOnly) check(generated);
  else write(generated);
}

main();
