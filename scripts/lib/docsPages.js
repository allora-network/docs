'use strict';

// The page model shared by every generated, agent-facing view of the docs:
//
//   scripts/generateLlmsTxt.js      public/llms.txt, public/llms-full.txt
//   scripts/generateRawMarkdown.js  public/raw/**.md
//
// It owns three things, so that the two generators can never disagree about
// them: the navigation walk (which pages exist, in what order, at what URL),
// the frontmatter parse, and the MDX → markdown reduction that inlines `file=`
// snippets, unwraps JSX, and absolutizes links.
//
// Plain Node, no dependencies — the same constraint the other scripts in this
// directory follow so CI can run them without an install step.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGES_DIR = path.join(ROOT, 'pages');
const PUBLIC_DIR = path.join(ROOT, 'public');
// realpathSync normalizes symlinks so the containment check on `file=` includes
// compares canonical paths, exactly as scripts/remarkIncludeCode.js does.
const SNIPPETS_ROOT = fs.realpathSync(path.join(ROOT, 'snippets'));

const SITE_URL = 'https://docs.allora.network';
const SITE_NAME = 'Allora Network Documentation';

const PAGE_EXTENSIONS = ['.mdx', '.md'];

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter
//
// Same hand-rolled parse as scripts/checkFrontmatter.js, which is the canonical
// enforcement of the five required keys. Duplicated rather than imported to keep
// both scripts dependency-free and independently runnable.
// ─────────────────────────────────────────────────────────────────────────────

// Returns the parsed keys, the raw frontmatter lines (delimiters included, so a
// generator can reproduce the block byte for byte), and the body lines.
function splitFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return { data: {}, frontmatter: [], body: lines };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      return {
        data: parseFrontmatter(lines.slice(1, i)),
        frontmatter: lines.slice(0, i + 1),
        body: lines.slice(i + 1),
      };
    }
  }
  return { data: {}, frontmatter: [], body: lines }; // unterminated block
}

function parseScalar(raw) {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^(["'])(.*)\1$/);
  if (quoted) return quoted[2].trim();
  const value = trimmed.replace(/(^|\s)#.*$/, '').trim();
  if (/^(?:~|null|Null|NULL)$/.test(value)) return '';
  return value;
}

function parseFrontmatter(lines) {
  const data = {};
  lines.forEach(line => {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) return;
    data[match[1]] = parseScalar(match[2]);
  });
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation walk
//
// _meta.json fixes the order and the section labels; anything on disk that the
// meta file does not list is appended alphabetically so a new page can never be
// silently dropped from the generated views.
// ─────────────────────────────────────────────────────────────────────────────

function readMeta(dir) {
  const metaPath = path.join(dir, '_meta.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse ${path.relative(ROOT, metaPath)}: ${error.message}`);
  }
}

function metaLabel(value, key) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.title === 'string') return value.title;
  return key;
}

// A meta entry that points somewhere else (external `href`) or is pure chrome
// (`separator`, `menu`) has no page file behind it.
function isNonPageEntry(value) {
  if (!value || typeof value !== 'object') return false;
  return typeof value.href === 'string' || value.type === 'separator' || value.type === 'menu';
}

function pageFileFor(dir, key) {
  for (const ext of PAGE_EXTENSIONS) {
    const candidate = path.join(dir, key + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Returns the ordered list of keys in a directory: meta-listed keys first, in
// meta order, then everything else alphabetically.
function orderedKeys(dir) {
  const meta = readMeta(dir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const onDisk = new Set();
  entries.forEach(entry => {
    if (entry.isDirectory()) {
      onDisk.add(entry.name);
    } else if (PAGE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      onDisk.add(entry.name.replace(/\.mdx?$/, ''));
    }
  });

  const ordered = [];
  const seen = new Set();

  const metaPath = path.relative(ROOT, path.join(dir, '_meta.json'));

  Object.keys(meta).forEach(key => {
    // A page on disk is served at its URL no matter what _meta.json says about
    // it, so `seen` may only swallow a key when there is genuinely nothing
    // behind it. Marking a key seen before this check let a nav-only entry
    // (external href, separator, menu) that happened to share a page's name
    // mask that page out of the generated views without a warning.
    if (!onDisk.has(key)) {
      seen.add(key);
      if (!isNonPageEntry(meta[key])) {
        console.warn(
          `Warning: ${metaPath} lists "${key}", but no page or directory of ` +
            'that name exists; skipping.'
        );
      }
      return;
    }

    if (isNonPageEntry(meta[key])) {
      // The nav entry only changes where the sidebar points; the page itself is
      // still live, so it stays in the generated views at its nav position.
      console.warn(
        `Warning: ${metaPath} maps "${key}" to a non-page entry (external href, ` +
          'separator, or menu), but a page of that name exists and is still ' +
          'served; including it.'
      );
    }

    seen.add(key);
    ordered.push(key);
  });

  Array.from(onDisk)
    .filter(key => !seen.has(key))
    .sort()
    .forEach(key => ordered.push(key));

  return { ordered, meta };
}

// Depth-first walk of one directory, in nav order. A key can be a page, a
// directory, or both (e.g. pages/build/reputer.mdx + pages/build/reputer/),
// in which case the page is the directory's landing page and comes first.
function collectPages(dir, urlPrefix, out) {
  const { ordered } = orderedKeys(dir);

  ordered.forEach(key => {
    const file = pageFileFor(dir, key);
    const subDir = path.join(dir, key);
    const hasSubDir = fs.existsSync(subDir) && fs.statSync(subDir).isDirectory();

    if (file) {
      out.push({
        file,
        url: key === 'index' ? urlPrefix || '/' : `${urlPrefix}/${key}`,
      });
    }
    if (hasSubDir) {
      collectPages(subDir, `${urlPrefix}/${key}`, out);
    }
  });

  return out;
}

// Top-level sections come from pages/_meta.json. Any .mdx sitting directly in
// pages/ is not part of a section; llms.txt lists those before its first H2,
// which llmstxt.org treats as the primary/essential set.
function collectSections() {
  const { ordered, meta } = orderedKeys(PAGES_DIR);
  const rootPages = [];
  const sections = [];

  ordered.forEach(key => {
    const file = pageFileFor(PAGES_DIR, key);
    const subDir = path.join(PAGES_DIR, key);
    const hasSubDir = fs.existsSync(subDir) && fs.statSync(subDir).isDirectory();

    if (file) {
      rootPages.push({ file, url: key === 'index' ? '/' : `/${key}` });
    }
    if (hasSubDir) {
      sections.push({
        title: metaLabel(meta[key], key),
        pages: collectPages(subDir, `/${key}`, []),
      });
    }
  });

  return { rootPages, sections };
}

// Every page file under pages/, found without consulting a single _meta.json.
// The walk above is meta-driven; this is the independent list it is checked
// against. Files whose name starts with `_` are Next.js/Nextra plumbing, not
// routes.
function pageFilesOnDisk(dir = PAGES_DIR, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pageFilesOnDisk(full, out);
    else if (PAGE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) out.push(full);
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MDX → markdown
// ─────────────────────────────────────────────────────────────────────────────

// Resolves the string constants a page imports from a local module, so prose
// like "installs {CHAIN_VERSION_TESTNET}" carries the real version instead of a
// dangling JSX expression. Only literal string exports (and the `.replace()`
// derivations in components/versions.ts) are understood; anything else is left
// alone.
const moduleConstantCache = new Map();

function loadModuleConstants(modulePath) {
  if (moduleConstantCache.has(modulePath)) return moduleConstantCache.get(modulePath);

  let resolved = null;
  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs']) {
    if (fs.existsSync(modulePath + ext) && fs.statSync(modulePath + ext).isFile()) {
      resolved = modulePath + ext;
      break;
    }
  }

  const constants = {};
  if (resolved) {
    const source = fs.readFileSync(resolved, 'utf8');
    const literal = /export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(['"`])([^'"`]*)\2/g;
    let match;
    while ((match = literal.exec(source)) !== null) {
      constants[match[1]] = match[3];
    }
    const derived = /export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*([A-Za-z0-9_$]+)\.replace\(\/\^v\/[a-z]*,\s*''\)/g;
    while ((match = derived.exec(source)) !== null) {
      if (constants[match[2]] !== undefined) {
        constants[match[1]] = constants[match[2]].replace(/^v/, '');
      }
    }
  }

  moduleConstantCache.set(modulePath, constants);
  return constants;
}

function importedConstants(bodyLines, mdxFile) {
  const constants = {};
  bodyLines.forEach(line => {
    const match = line.match(/^import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/);
    if (!match) return;
    const source = match[2];
    if (!source.startsWith('.')) return; // package import — nothing to resolve
    const available = loadModuleConstants(path.resolve(path.dirname(mdxFile), source));
    match[1]
      .split(',')
      .map(name => name.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
      .forEach(name => {
        if (available[name] !== undefined) constants[name] = available[name];
      });
  });
  return constants;
}

// Deliberately narrow: these must not match the `export FOO=bar` shell lines or
// the `import os` Python lines that appear as page content. MDX requires ESM at
// column 0, and every such line quotes a module specifier.
const ESM_IMPORT = /^import\s+(?:[^'"]*\s+from\s+)?['"][^'"]+['"];?\s*$/;
const ESM_EXPORT = /^export\s+(?:(?:const|let|var|function|class|default|async)\b|[*{])/;

function stripMdxComments(lines) {
  const out = [];
  let inFence = false;
  let fenceMarker = '';
  let inComment = false;

  lines.forEach(rawLine => {
    let line = rawLine;

    if (!inComment) {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fence[1][0];
        } else if (fence[1][0] === fenceMarker) {
          inFence = false;
        }
        out.push(line);
        return;
      }
      if (inFence) {
        out.push(line);
        return;
      }
    }

    let result = '';
    while (line.length > 0) {
      if (inComment) {
        const end = line.indexOf('*/}');
        if (end === -1) {
          line = ''; // the rest of the line is still inside the comment
          break;
        }
        line = line.slice(end + 3);
        inComment = false;
      } else {
        const start = line.indexOf('{/*');
        if (start === -1) {
          result += line;
          line = '';
        } else {
          result += line.slice(0, start);
          line = line.slice(start + 3);
          inComment = true;
        }
      }
    }

    if (result.trim() !== '' || rawLine.trim() === '') out.push(result);
  });

  return out;
}

function parseAttributes(raw) {
  const attributes = {};
  const attribute = /([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = attribute.exec(raw)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

// The canonical site URL of a page file, derived the same way the navigation
// walk derives it: the path under pages/ without its extension, with `index`
// standing for its directory.
function urlForPageFile(file) {
  const relative = path
    .relative(PAGES_DIR, file)
    .split(path.sep)
    .join('/')
    .replace(/\.mdx?$/, '');
  const withoutIndex = relative === 'index' ? '' : relative.replace(/(^|\/)index$/, '');
  return `/${withoutIndex}`.replace(/\/$/, '') || '/';
}

// Resolves a repo-relative markdown link (`./sibling`, `../other/page#anchor`)
// against the page it appears on. Returns null unless it lands on a real page
// under pages/, so a link this script does not understand is left exactly as
// written rather than rewritten into a guess.
function resolveRelativeLink(mdxFile, target) {
  const hash = target.indexOf('#');
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? '' : target.slice(hash);
  if (pathPart === '') return null;

  const base = path.resolve(path.dirname(mdxFile), pathPart);
  const candidates = [
    base,
    ...PAGE_EXTENSIONS.map(ext => base + ext),
    ...PAGE_EXTENSIONS.map(ext => path.join(base, `index${ext}`)),
  ];
  const file = candidates.find(
    candidate =>
      /\.mdx?$/.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  if (!file) return null;

  return `${SITE_URL}${urlForPageFile(file)}${fragment}`;
}

// The generated views are read detached from the site, where a bare
// `/reference/networks` or `./run-full-node` points nowhere. Site-absolute
// links get the base URL; relative links are resolved against the page they
// appear on first — note that scripts/fixRelativeLinks.js actively rewrites
// internal links into the `./` form, so these are not a legacy handful but the
// repo's normal state.
function absolutizeLinks(text, mdxFile) {
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    // Absolute URLs, protocol-relative URLs, other schemes (mailto:, ipfs:) and
    // same-page fragments are already meaningful on their own.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return whole;
    if (target.startsWith('/')) return `](${SITE_URL}${target})`;
    const resolved = resolveRelativeLink(mdxFile, target);
    return resolved ? `](${resolved})` : whole;
  });
}

function readSnippet(mdxFile, relativePath) {
  const snippetPath = path.resolve(path.dirname(mdxFile), relativePath);
  if (!fs.existsSync(snippetPath)) {
    throw new Error(
      `${path.relative(ROOT, mdxFile)} references missing file ${relativePath}`
    );
  }
  const realPath = fs.realpathSync(snippetPath);
  if (!realPath.startsWith(SNIPPETS_ROOT + path.sep)) {
    throw new Error(
      `${path.relative(ROOT, mdxFile)} references ${relativePath}, which resolves ` +
        `outside ${path.relative(ROOT, SNIPPETS_ROOT)}/`
    );
  }
  return fs.readFileSync(realPath, 'utf8').trimEnd();
}

// Converts one page's MDX body into markdown an LLM can read straight through:
// ESM lines and MDX comments go away, JSX wrappers are unwrapped (Callout,
// Cards, Tabs) or rendered (Card, Code, iframe), `file=` fences get their
// snippet inlined the way scripts/remarkIncludeCode.js does at build time, and
// site-absolute links become absolute URLs so the output stands on its own.
//
// `stripLeadingH1` drops the page's own `# Title` line: llms-full.txt renders a
// title header of its own above each page and would otherwise show it twice,
// while public/raw/**.md is a standalone copy of the page and keeps it.
function mdxToMarkdown(mdxFile, bodyLines, { stripLeadingH1 = true } = {}) {
  const constants = importedConstants(bodyLines, mdxFile);
  const lines = stripMdxComments(bodyLines);
  const out = [];

  // Each unwrapped JSX wrapper contributes the extra indentation its children
  // carry; `dedent` is the running total to strip from emitted lines.
  const wrappers = [];
  let dedent = 0;
  const tabs = [];
  let preLanguage = null;

  let inFence = false;
  let fenceMarker = '';
  let fenceLength = 0;
  let skipFenceBody = false;

  // Each record carries whether it came from inside a fenced code block, so the
  // whitespace cleanup at the end can leave code exactly as written.
  const emit = text => out.push({ text, fenced: inFence });

  const emitContent = line => {
    let text = line;
    if (dedent > 0) {
      const leading = text.length - text.trimStart().length;
      text = text.slice(Math.min(dedent, leading));
    }
    if (!inFence) {
      text = text.replace(/\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g, (whole, name) =>
        constants[name] !== undefined ? constants[name] : whole
      );
      text = absolutizeLinks(text, mdxFile);
    }
    emit(text);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── inside a fenced code block ──
    if (inFence) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fenceMarker && close[1].length >= fenceLength) {
        inFence = false;
        skipFenceBody = false;
        emitContent(line.replace(/\s*$/, ''));
      } else if (!skipFenceBody) {
        emitContent(line);
      }
      continue;
    }

    const fenceOpen = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (fenceOpen) {
      inFence = true;
      fenceMarker = fenceOpen[2][0];
      fenceLength = fenceOpen[2].length;

      const info = fenceOpen[3];
      const include = info.match(/(?:^|\s)file=(\S+)/);
      const cleanedInfo = info
        .replace(/(?:^|\s)file=\S+/, '')
        .replace(/(?:^|\s)filename="[^"]*"/, '')
        .trim();

      emitContent(`${fenceOpen[1]}${fenceOpen[2]}${cleanedInfo}`);
      if (include) {
        // The body on the page is empty by design; the snippet file is the
        // source of truth, exactly as it is for the rendered site.
        readSnippet(mdxFile, include[1])
          .split(/\r?\n/)
          .forEach(emit);
        skipFenceBody = true;
      }
      continue;
    }

    // ── ESM lines that only exist for the rendered site ──
    if (ESM_IMPORT.test(line) || ESM_EXPORT.test(line)) continue;

    // ── components rendered rather than unwrapped ──
    const card = line.match(/^\s*<Card\b([^>]*)\/>\s*$/);
    if (card) {
      const attributes = parseAttributes(card[1]);
      const title = attributes.title || attributes.href || 'Link';
      emitContent(attributes.href ? `- [${title}](${attributes.href})` : `- ${title}`);
      continue;
    }

    const iframe = line.match(/^\s*<iframe\b([^>]*)>\s*<\/iframe>\s*$/);
    if (iframe) {
      const attributes = parseAttributes(iframe[1]);
      if (attributes.src) {
        emitContent(`[${attributes.title || 'Video'}](${attributes.src})`);
      }
      continue;
    }

    // <Pre data-language="bash"><Code>{`…`}</Code></Pre> is a code block built
    // out of components so it can interpolate an imported constant; render it
    // back into a plain fence.
    const preOpen = line.match(/^\s*<Pre\b([^>]*)>\s*$/);
    if (preOpen) {
      preLanguage = parseAttributes(preOpen[1])['data-language'] || '';
      continue;
    }
    if (/^\s*<\/Pre>\s*$/.test(line)) {
      preLanguage = null;
      continue;
    }
    const code = line.match(/^\s*<Code>\{`([\s\S]*)`\}<\/Code>\s*$/);
    if (code) {
      const text = code[1].replace(
        /\$\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g,
        (whole, name) => (constants[name] !== undefined ? constants[name] : whole)
      );
      emit(`\`\`\`${preLanguage || ''}`);
      text.split(/\r?\n/).forEach(emit);
      emit('```');
      continue;
    }

    // ── generic JSX wrappers: drop the tag, keep the children ──
    const selfClosing = line.match(/^(\s*)<([A-Z][A-Za-z0-9]*)\b[^>]*\/>\s*$/);
    if (selfClosing) continue;

    const openTag = line.match(/^(\s*)<([A-Z][A-Za-z0-9]*)\b([^>]*)>\s*$/);
    if (openTag) {
      const indent = openTag[1].length;
      const name = openTag[2];

      if (name === 'Tabs') {
        const items = openTag[3].match(/items=\{\[([^\]]*)\]\}/);
        const labels = items
          ? (items[1].match(/'([^']*)'|"([^"]*)"/g) || []).map(label => label.slice(1, -1))
          : [];
        tabs.push({ labels, index: 0 });
      } else if (name === 'Tab' && tabs.length > 0) {
        // Keep the tab labels: without them three consecutive install blocks
        // read as one contradictory procedure.
        const current = tabs[tabs.length - 1];
        const label = current.labels[current.index++];
        if (label) {
          if (out.length > 0 && out[out.length - 1].text.trim() !== '') emit('');
          emitContent(`${openTag[1]}**${label}**`);
          emitContent('');
        }
      }

      // Children are usually indented one level further than their wrapper;
      // look ahead to find out by how much and strip exactly that.
      let childIndent = indent;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue;
        if (new RegExp(`^\\s*</${name}>\\s*$`).test(lines[j])) break;
        childIndent = lines[j].length - lines[j].trimStart().length;
        break;
      }
      const extra = Math.max(0, childIndent - indent);
      wrappers.push({ name, extra });
      dedent += extra;
      continue;
    }

    const closeTag = line.match(/^\s*<\/([A-Z][A-Za-z0-9]*)>\s*$/);
    if (closeTag) {
      const name = closeTag[1];
      if (name === 'Tabs') tabs.pop();
      for (let j = wrappers.length - 1; j >= 0; j--) {
        if (wrappers[j].name === name) {
          dedent -= wrappers.splice(j).reduce((sum, wrapper) => sum + wrapper.extra, 0);
          break;
        }
      }
      continue;
    }

    emitContent(line);
  }

  // Collapse the blank-line runs that unwrapping leaves behind, and trim
  // trailing whitespace — but never inside a fenced code block. Code is quoted
  // material: the Python snippets carry PEP 8 double blank lines between
  // top-level definitions, and collapsing those means the generated output no
  // longer contains snippets/*.py verbatim.
  const collapsed = [];
  const isBlank = record => record.text.trim() === '';
  out.forEach(record => {
    if (record.fenced) {
      collapsed.push(record);
      return;
    }
    const previous = collapsed[collapsed.length - 1];
    if (isBlank(record) && previous && !previous.fenced && isBlank(previous)) return;
    collapsed.push({ text: record.text.replace(/\s+$/, ''), fenced: false });
  });

  const trimmable = index =>
    collapsed[index] && !collapsed[index].fenced && isBlank(collapsed[index]);

  while (collapsed.length > 0 && trimmable(0)) collapsed.shift();
  if (stripLeadingH1 && collapsed.length > 0 && !collapsed[0].fenced && /^#\s+/.test(collapsed[0].text)) {
    collapsed.shift();
    while (collapsed.length > 0 && trimmable(0)) collapsed.shift();
  }
  while (collapsed.length > 0 && trimmable(collapsed.length - 1)) collapsed.pop();

  return collapsed.map(record => record.text).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// The page set
// ─────────────────────────────────────────────────────────────────────────────

function loadPage(page) {
  const content = fs.readFileSync(page.file, 'utf8');
  const { data, frontmatter, body } = splitFrontmatter(content);
  return {
    ...page,
    relativePath: path.relative(ROOT, page.file),
    title: data.title || '',
    description: data.description || '',
    frontmatter,
    body,
  };
}

// The single entry point both generators use: every page under pages/, loaded,
// in navigation order, after the two invariants below hold. Exits the process
// on failure — these are build-stopping conditions, and every caller is a CLI.
function collectAllPages() {
  const { rootPages, sections } = collectSections();
  const all = [...rootPages, ...sections.flatMap(section => section.pages)].map(loadPage);
  const byFile = new Map(all.map(page => [page.file, page]));

  // Invariant: the nav-ordered walk must reach every page that exists. Anything
  // it misses would be live on the site but absent from the generated views —
  // and, because the check modes compare the committed files against this same
  // walk, absent silently. Fail loudly instead, whatever the cause.
  const missed = pageFilesOnDisk().filter(file => !byFile.has(file));
  if (missed.length > 0) {
    console.error(
      `Docs page collection failed: ${missed.length} page(s) under pages/ were not ` +
        'reached by the navigation walk, so they would be live on the site but ' +
        'missing from llms.txt, llms-full.txt, and public/raw/.\n'
    );
    missed
      .map(file => path.relative(ROOT, file))
      .sort()
      .forEach(file => console.error(`  ${file}`));
    console.error(
      '\nCheck the _meta.json files on the path to those pages for an entry that ' +
        'shadows them.'
    );
    process.exit(1);
  }

  // A page with no description would ship a bare, useless llms.txt entry, so
  // generation refuses to proceed. scripts/checkFrontmatter.js enforces the
  // same rule for all five keys earlier in the build; this is the backstop that
  // keeps the generated views themselves honest.
  const invalid = all.filter(page => !page.title || !page.description);
  if (invalid.length > 0) {
    console.error(
      `Docs page collection failed: ${invalid.length} of ${all.length} pages are missing ` +
        'a non-empty `title` or `description` in their frontmatter.\n'
    );
    invalid.forEach(page => {
      const missing = [];
      if (!page.title) missing.push('title');
      if (!page.description) missing.push('description');
      console.error(`  ${page.relativePath} — missing or empty: ${missing.join(', ')}`);
    });
    console.error('\nRun `yarn frontmatter` to fill in missing keys, then review the values.');
    process.exit(1);
  }

  return {
    rootPages: rootPages.map(page => byFile.get(page.file)),
    sections: sections.map(section => ({
      title: section.title,
      pages: section.pages.map(page => byFile.get(page.file)),
    })),
    all,
  };
}

module.exports = {
  ROOT,
  PAGES_DIR,
  PUBLIC_DIR,
  SITE_URL,
  SITE_NAME,
  PAGE_EXTENSIONS,
  collectAllPages,
  mdxToMarkdown,
  splitFrontmatter,
  urlForPageFile,
};
