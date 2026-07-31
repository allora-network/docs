#!/usr/bin/env node
'use strict';

// Generates public/raw/**.md — one plain-markdown file per docs page, so an
// agent can fetch a single page instead of the whole llms-full.txt bundle:
//
//   pages/get-started/quickstart-worker.mdx → public/raw/get-started/quickstart-worker.md
//                                             served at /raw/get-started/quickstart-worker.md
//
// Each file is the page's frontmatter verbatim followed by its body reduced to
// markdown by the shared reduction in scripts/lib/docsPages.js — the same one
// llms-full.txt uses, so a `file=` snippet fence carries the snippet's contents
// (the fence in the .mdx source is empty by design) and internal links are
// absolute (a detached .md file has no routing context). The page's own H1 is
// kept here, unlike in llms-full.txt, because each file stands alone.
//
// Generated at build time (chained into `yarn build`) and committed, because
// public/ is served statically. Run `node scripts/generateRawMarkdown.js
// --check` to verify the committed files still match pages/** without
// rewriting them; that mode runs in CI.
//
// Plain Node, no dependencies — the same constraint the other scripts in this
// directory follow so CI can run it without an install step.

const fs = require('fs');
const path = require('path');

const {
  PAGES_DIR,
  PUBLIC_DIR,
  ROOT,
  collectAllPages,
  mdxToMarkdown,
} = require('./lib/docsPages');

const RAW_DIR = path.join(PUBLIC_DIR, 'raw');

// public/raw/ mirrors the tree under pages/, extension swapped to .md. A
// section landing page keeps its `index` name (pages/get-started/index.mdx →
// public/raw/get-started/index.md), which is what makes the mapping from a page
// URL to its raw file mechanical and total: append `.md` to the URL, or
// `/index.md` for a URL that names a section.
function rawFileFor(pageFile) {
  return path.join(RAW_DIR, path.relative(PAGES_DIR, pageFile).replace(/\.mdx?$/, '.md'));
}

function renderPage(page) {
  const parts = [];
  if (page.frontmatter.length > 0) parts.push(page.frontmatter.join('\n'));
  const markdown = mdxToMarkdown(page.file, page.body, { stripLeadingH1: false });
  if (markdown) parts.push(markdown);
  return `${parts.join('\n\n')}\n`;
}

// Everything currently under public/raw/. The directory is generated in full,
// so any file here that the page set does not account for is a leftover from a
// page that was renamed or removed, and gets pruned.
function existingFiles(dir = RAW_DIR, out = []) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) existingFiles(full, out);
    else out.push(full);
  });
  return out;
}

// Removes directories left empty by pruning, bottom-up, without touching
// public/raw/ itself.
function pruneEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(dir, entry.name));
  });
  if (dir !== RAW_DIR && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

function build() {
  const { all } = collectAllPages();
  const files = new Map(all.map(page => [rawFileFor(page.file), renderPage(page)]));

  // Two pages mapping to one raw file would silently drop one of them. The
  // mapping is injective by construction (it mirrors distinct source paths),
  // so this can only fire if a directory ever holds both `page.mdx` and
  // `page.md` — in which case the site itself is ambiguous too.
  if (files.size !== all.length) {
    const counts = new Map();
    all.forEach(page => {
      const file = rawFileFor(page.file);
      counts.set(file, (counts.get(file) || 0) + 1);
    });
    console.error('raw markdown generation failed: two pages map to the same raw file.\n');
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .forEach(([file]) => console.error(`  ${path.relative(ROOT, file)}`));
    process.exit(1);
  }

  return { files, pages: all };
}

function check(generated) {
  const problems = [];

  generated.files.forEach((content, file) => {
    const relative = path.relative(ROOT, file);
    if (!fs.existsSync(file)) problems.push(`${relative} is missing.`);
    else if (fs.readFileSync(file, 'utf8') !== content) problems.push(`${relative} is out of date.`);
  });

  existingFiles()
    .filter(file => !generated.files.has(file))
    .forEach(file =>
      problems.push(`${path.relative(ROOT, file)} does not correspond to any page under pages/.`)
    );

  if (problems.length > 0) {
    console.error(
      `raw markdown check failed: public/raw/ does not match the ${generated.pages.length} ` +
        'pages under pages/.\n'
    );
    problems.sort().forEach(problem => console.error(`  ${problem}`));
    console.error(
      '\nRun `node scripts/generateRawMarkdown.js` (or `yarn build`) and commit the result.'
    );
    process.exit(1);
  }

  console.log(
    `raw markdown check OK: public/raw/ matches all ${generated.pages.length} pages.`
  );
}

function write(generated) {
  let written = 0;
  generated.files.forEach((content, file) => {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    written++;
  });

  const orphans = existingFiles().filter(file => !generated.files.has(file));
  orphans.forEach(file => {
    fs.unlinkSync(file);
    console.log(`Removed stale ${path.relative(ROOT, file)} (no page maps to it).`);
  });
  pruneEmptyDirs(RAW_DIR);

  const bytes = [...generated.files.values()].reduce(
    (sum, content) => sum + Buffer.byteLength(content),
    0
  );
  console.log(
    `Generated public/raw/ (${generated.pages.length} pages, ${Math.round(bytes / 1024)} KB; ` +
      `${written} written, ${orphans.length} pruned).`
  );
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let generated;
  try {
    generated = build();
  } catch (error) {
    console.error(`raw markdown generation failed: ${error.message}`);
    process.exit(1);
  }
  if (checkOnly) check(generated);
  else write(generated);
}

main();
