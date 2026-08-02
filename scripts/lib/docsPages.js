'use strict';

// The page model shared by every generated, agent-facing view of the docs:
//
//   scripts/generateLlmsTxt.js      public/llms.txt, public/llms-full.txt
//   scripts/generateRawMarkdown.js  public/raw/**.md
//
// It owns three things, so that the two generators can never disagree about
// them: the navigation walk (which pages exist, in what order, at what URL),
// the frontmatter parse, and the MDX → markdown reduction that inlines `file=`
// snippets, unwraps layout JSX, renders the data-bearing components from the
// same JSON manifests the site reads, and absolutizes links.
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

// ── Versions ────────────────────────────────────────────────────────────────
//
// Current versions live in exactly one place, public/api/versions.json, which
// the site reads through components/Version.tsx. The generated corpus reads the
// same file — never a copy — so a version bump moves the pages, the raw
// markdown and llms-full.txt together.
//
// Two shapes reach a page: `<Version of="chain-testnet"/>` inline in prose, and
// the components/versions.ts constants (`versionOf('chain-testnet')`) for the
// template literals where JSX cannot go. Both are resolved here; anything that
// cannot be resolved throws, because the alternative is publishing a
// copy-paste install command that still says `${CHAIN_VERSION_TESTNET}`.

const VERSIONS_FILE = path.join(PUBLIC_DIR, 'api', 'versions.json');

let versionsCache = null;

function versions() {
  if (versionsCache) return versionsCache;
  if (!fs.existsSync(VERSIONS_FILE)) {
    throw new Error(`${path.relative(ROOT, VERSIONS_FILE)} is missing; version strings cannot be resolved`);
  }
  try {
    versionsCache = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(ROOT, VERSIONS_FILE)} is not valid JSON: ${error.message}`);
  }
  return versionsCache;
}

// Mirrors versionOf() in components/Version.tsx: hyphens and underscores are
// interchangeable, `bare` strips the leading "v", and an unknown id throws
// rather than rendering an empty string.
function resolveVersion(of, { bare = false } = {}) {
  const table = versions();
  const key = String(of).replace(/-/g, '_');
  const value = table[key];
  if (typeof value !== 'string' || value === '') {
    // `superseded` is bookkeeping for scripts/checkVersionStrings.js, not a
    // version id, so it is not offered as one here either.
    const ids = Object.keys(table).filter(id => typeof table[id] === 'string');
    throw new Error(
      `unknown version id "${of}" — ${path.relative(ROOT, VERSIONS_FILE)} defines: ` +
        `${ids.join(', ')} (hyphens and underscores are interchangeable)`
    );
  }
  return bare ? value.replace(/^v/, '') : value;
}

// `<Version of="allora-sdk"/>` / `<Version of="chain-testnet" bare/>` used
// inline in a sentence, where the version *is* the content. Rendered to the
// string itself, exactly as the site renders it.
const VERSION_TAG = /<Version\b([^>]*?)\/>/g;

function renderVersionTags(text, mdxFile) {
  return text.replace(VERSION_TAG, (whole, attributes) => {
    const of = attributes.match(/\bof\s*=\s*"([^"]*)"/) || attributes.match(/\bof\s*=\s*'([^']*)'/);
    if (!of) {
      throw new Error(
        `${path.relative(ROOT, mdxFile)} has a <Version/> tag with no literal ` +
          `of="…" attribute: ${whole.trim()}`
      );
    }
    // `bare`, `bare={true}` and `bare="true"` all mean the same thing to the
    // component; `bare={false}` and a missing attribute mean not bare.
    const bareAttribute = attributes.match(/\bbare\s*(?:=\s*(?:\{([^}]*)\}|"([^"]*)"))?/);
    const bare = Boolean(bareAttribute) && !/^\s*(?:false|"false"|'false')\s*$/.test(
      bareAttribute[1] !== undefined ? bareAttribute[1] : bareAttribute[2] !== undefined ? bareAttribute[2] : 'true'
    );
    try {
      return resolveVersion(of[1], { bare });
    } catch (error) {
      throw new Error(`${path.relative(ROOT, mdxFile)}: ${error.message}`);
    }
  });
}

// Resolves the string constants a page imports from a local module, so prose
// like "installs {CHAIN_VERSION_TESTNET}" carries the real version instead of a
// dangling JSX expression. Three shapes are understood: literal string exports,
// the `.replace()` derivation, and `versionOf('<id>'[, { bare: true }])` —
// which is how components/versions.ts derives its constants from
// public/api/versions.json. Anything else is left alone here and caught by the
// unresolved-interpolation check in mdxToMarkdown if a page actually uses it.
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
    const version =
      /export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*versionOf\(\s*(['"`])([^'"`]+)\2\s*(?:,\s*\{([^}]*)\}\s*)?\)/g;
    while ((match = version.exec(source)) !== null) {
      const bare = match[4] !== undefined && /\bbare\s*:\s*true\b/.test(match[4]);
      try {
        constants[match[1]] = resolveVersion(match[3], { bare });
      } catch (error) {
        throw new Error(`${path.relative(ROOT, resolved)} exports ${match[1]}: ${error.message}`);
      }
    }
  }

  moduleConstantCache.set(modulePath, constants);
  return constants;
}

// Returns the resolved constants, plus every name the page imports from a local
// module whether it resolved or not. The second set is what makes an
// unresolvable constant loud: a page that interpolates a name it imported
// locally and did not resolve is a page that would publish `{CHAIN_VERSION_X}`
// as if it were prose, so mdxToMarkdown fails on it instead.
function importedConstants(bodyLines, mdxFile) {
  const constants = {};
  const localNames = new Set();
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
        localNames.add(name);
        if (available[name] !== undefined) constants[name] = available[name];
      });
  });
  return { constants, localNames };
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

// ── Data-bearing components ─────────────────────────────────────────────────
//
// A few components on the site are not layout: their whole output is data read
// from a JSON manifest under public/api/. Dropping them the way a generic
// wrapper is dropped publishes an agent-facing corpus in which
// /reference/networks has no endpoints table and /build/forge/topics has no
// topics — the point of both pages, missing without a word. So they are
// rendered here from the same files the React components import, into the
// markdown equivalent of what a reader sees.
//
// Nothing below invents a value: every cell is a field of the manifest, and a
// field the manifest omits renders as the same em dash the site shows.
//
// The registry is closed. A self-closing component that is neither listed here
// nor in LAYOUT_COMPONENTS stops generation (see assertKnownComponents), so a
// new data component added without an entry fails loudly instead of vanishing.

const NETWORKS_MANIFEST = path.join(PUBLIC_DIR, 'api', 'networks.json');
const TOPICS_MANIFEST = path.join(PUBLIC_DIR, 'api', 'topics.json');

const manifestCache = new Map();

function manifest(file) {
  if (manifestCache.has(file)) return manifestCache.get(file);
  const relative = path.relative(ROOT, file);
  if (!fs.existsSync(file)) {
    throw new Error(`${relative} is missing, so the components that render it cannot be reduced to markdown`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${relative} is not valid JSON: ${error.message}`);
  }
  manifestCache.set(file, parsed);
  return parsed;
}

// A markdown table. Backslashes are escaped before `|` so a cell value ending
// in a backslash cannot neutralize the pipe escape and break the row; other
// markdown in cells (bold labels, inline code) is kept on purpose.
function markdownTable(header, rows) {
  const cell = value => String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  return [
    `| ${header.map(cell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ];
}

// The row/column lists below mirror the presentation lists in
// components/NetworksTable.js and components/TopicsTable.js. They cannot be
// imported — those files are ESM with JSX, and these scripts stay
// dependency-free — so each is cross-checked against the component source
// before it is used. A column added to the component but not mirrored here
// would otherwise leave the generated corpus quietly showing less than the
// page, which is the whole failure this section exists to prevent.
//
// The comparison is over the *whole* entry, not just its key. Labels and the
// `code` flag are presentation too: rename a row to "Faucet URL", or stop
// rendering the explorer as inline code, and a key-only check stays green while
// the corpus goes on showing the previous wording indefinitely.
function componentArray(componentFile, arrayName) {
  const source = fs.readFileSync(path.join(ROOT, componentFile), 'utf8');
  const block = source.match(new RegExp(`const ${arrayName} = \\[([\\s\\S]*?)\\n\\]`));
  if (!block) {
    throw new Error(
      `${componentFile} no longer declares a top-level \`const ${arrayName} = [ … ]\`, so ` +
        'scripts/lib/docsPages.js cannot confirm that the markdown it generates still ' +
        'matches the rendered page. Update the mirror check together with the component.'
    );
  }
  return block[1];
}

function assertMirrors(componentFile, arrayName, found, expected) {
  const show = items => items.map(item => JSON.stringify(item)).join(', ');
  if (JSON.stringify(found) === JSON.stringify(expected)) return;
  throw new Error(
    `${componentFile} ${arrayName} is [${show(found)}], but scripts/lib/docsPages.js ` +
      `mirrors [${show(expected)}]. The generated markdown would show something other ` +
      'than the page does — update the mirror in scripts/lib/docsPages.js.'
  );
}

// One `{ key: '…', label: '…', code: <bool> }` entry, in the component's own
// spelling. Deliberately exact: a field written in some other shape does not
// match, the entry count then disagrees with the number of `key:`s in the
// block, and generation stops rather than mirror a list it only half read.
const FIELD_ENTRY = /\{\s*key:\s*'([^']*)',\s*label:\s*'([^']*)',\s*code:\s*(true|false)\s*,?\s*\}/g;

function componentFields(componentFile, arrayName) {
  const block = componentArray(componentFile, arrayName);
  const fields = [...block.matchAll(FIELD_ENTRY)].map(match => ({
    key: match[1],
    label: match[2],
    code: match[3] === 'true',
  }));

  const declared = (block.match(/\bkey:/g) || []).length;
  if (fields.length !== declared) {
    throw new Error(
      `${componentFile} ${arrayName} declares ${declared} field(s) but only ${fields.length} ` +
        "are written as `{ key: '…', label: '…', code: <true|false> }`, which is the shape " +
        'scripts/lib/docsPages.js reads them in. Keep the component to that shape, or teach ' +
        'the mirror check the new one — it cannot verify what it cannot parse.'
    );
  }

  return fields;
}

// components/NetworksTable.js FIELDS: row order and labels are presentation and
// live with the component, so they are mirrored rather than derived.
const NETWORK_FIELDS = [
  { key: 'chain_id', label: 'Chain ID', code: true },
  { key: 'deployed_version', label: 'Deployed version', code: false },
  { key: 'emissions_namespace', label: 'Emissions API namespace', code: true },
  { key: 'rpc', label: 'RPC JSON', code: true },
  { key: 'grpc', label: 'gRPC', code: true },
  { key: 'lcd', label: 'API (Cosmos LCD - REST)', code: true },
  { key: 'explorer', label: 'Explorer', code: true },
  { key: 'faucet', label: 'Faucet', code: true },
];

function networks() {
  assertMirrors(
    'components/NetworksTable.js',
    'FIELDS',
    componentFields('components/NetworksTable.js', 'FIELDS'),
    NETWORK_FIELDS
  );
  const entries = manifest(NETWORKS_MANIFEST).networks;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error(`${path.relative(ROOT, NETWORKS_MANIFEST)} has no "networks" object`);
  }
  return entries;
}

// Mirrors renderValue() in components/NetworksTable.js: an absent field is an
// em dash, and the fields marked `code` render as inline code.
function networkValue(entry, field) {
  const value = entry[field.key];
  if (typeof value !== 'string' || value === '') return '—';
  return field.code ? `\`${value}\`` : value;
}

function renderNetworksTable() {
  const entries = networks();
  const keys = Object.keys(entries);
  return markdownTable(
    ['', ...keys.map(key => entries[key].name || key)],
    NETWORK_FIELDS.map(field => [
      `**${field.label}**`,
      ...keys.map(key => networkValue(entries[key], field)),
    ])
  );
}

function renderNetworkDetails(attributes) {
  const entries = networks();
  const name = attributes.network;
  // Same failure the component raises, for the same reason: a details list for
  // a network the manifest does not define has nothing truthful to show.
  if (!name || !entries[name]) {
    throw new Error(
      `<NetworkDetails network="${name || ''}"/> — ${path.relative(ROOT, NETWORKS_MANIFEST)} ` +
        `defines: ${Object.keys(entries).join(', ')}`
    );
  }
  return NETWORK_FIELDS.map(
    field => `- **${field.label}**: ${networkValue(entries[name], field)}`
  );
}

// components/TopicsTable.js COLUMNS.
const TOPIC_COLUMNS = [
  'Topic ID',
  'Metadata',
  'Epoch Length (blocks)',
  'Category',
  'Loss Method',
];

function topics() {
  assertMirrors(
    'components/TopicsTable.js',
    'COLUMNS',
    [...componentArray('components/TopicsTable.js', 'COLUMNS').matchAll(/'([^']*)'/g)].map(
      match => match[1]
    ),
    TOPIC_COLUMNS
  );
  const data = manifest(TOPICS_MANIFEST);
  if (!Array.isArray(data.topics)) {
    throw new Error(`${path.relative(ROOT, TOPICS_MANIFEST)} has no "topics" array`);
  }
  return data;
}

/** Mirrors topicsFor() in components/TopicsTable.js. */
function topicsFor(network) {
  return topics().topics.filter(topic => topic.network === network);
}

function requireNetworkAttribute(tag, attributes) {
  if (!attributes.network) {
    throw new Error(`${tag} needs a literal network="…" attribute`);
  }
  return attributes.network;
}

function renderTopicsTable(attributes) {
  const network = requireNetworkAttribute('<TopicsTable/>', attributes);
  const rows = topicsFor(network);
  // The component's own empty state, word for word.
  if (rows.length === 0) return [`No active topics recorded for ${network}.`];
  return markdownTable(
    TOPIC_COLUMNS,
    rows.map(topic => [
      // The site marks a sandbox topic with a bold id and a "sandbox" badge;
      // markdown has no badge, so the same two facts render as text.
      topic.sandbox ? `**${topic.id}** (sandbox)` : String(topic.id),
      topic.metadata,
      String(topic.epoch_length),
      topic.category,
      topic.loss_method,
    ])
  );
}

function renderTopicsCount(attributes) {
  return String(topicsFor(requireNetworkAttribute('<TopicsCount/>', attributes)).length);
}

/** Mirrors sandboxTopicsFor() in components/TopicsTable.js. */
function sandboxTopicsFor(network) {
  return topicsFor(network).filter(topic => topic.sandbox);
}

/** Mirrors sandboxTopicIdList() — "69 and 77", "69, 77 and 80", "none". */
function renderSandboxTopicIds(attributes) {
  const network = requireNetworkAttribute('<SandboxTopicIds/>', attributes);
  const ids = sandboxTopicsFor(network).map(topic => topic.id);
  if (ids.length === 0) return 'none';
  if (ids.length === 1) return String(ids[0]);
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

/** Mirrors the <SandboxTopics/> list, empty-state sentence included. */
function renderSandboxTopics(attributes) {
  const network = requireNetworkAttribute('<SandboxTopics/>', attributes);
  const rows = sandboxTopicsFor(network);
  if (rows.length === 0) return [`No sandbox topics are marked for ${network}.`];
  return rows.map(topic => `- **${topic.id}** — \`${topic.metadata}\``);
}

/** Mirrors topicsGeneratedOn in components/TopicsTable.js. */
function renderTopicsGeneratedOn() {
  const generatedAt = topics().generated_at;
  // Shape, parseability and calendar validity — the same bar
  // scripts/generateTopics.js holds the value it writes to, so a date the
  // generator would refuse to publish cannot reach the corpus through here.
  const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(generatedAt)
    ? new Date(generatedAt)
    : null;
  const usable =
    parsed &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().replace(/\.\d{3}Z$/, 'Z') === generatedAt;
  if (!usable) {
    throw new Error(
      `${path.relative(ROOT, TOPICS_MANIFEST)} has no usable ISO-8601 "generated_at" ` +
        `(got ${JSON.stringify(generatedAt)}); regenerate it with \`yarn topics\``
    );
  }
  return generatedAt.slice(0, 10);
}

// `block` components own their line and render to a block of markdown;
// `inline` components stand for a value inside a sentence.
const DATA_COMPONENTS = {
  NetworksTable: { block: renderNetworksTable },
  NetworkDetails: { block: renderNetworkDetails },
  TopicsTable: { block: renderTopicsTable },
  SandboxTopics: { block: renderSandboxTopics },
  TopicsCount: { inline: renderTopicsCount },
  TopicsGeneratedOn: { inline: renderTopicsGeneratedOn },
  SandboxTopicIds: { inline: renderSandboxTopicIds },
};

// Components that carry no data of their own, so nothing is lost by dropping
// the tag (self-closing) or unwrapping it (paired). Every component used in
// pages/ is classified either here or in DATA_COMPONENTS, deliberately.
const LAYOUT_COMPONENTS = new Set([
  'Callout', // nextra/components — a styled box around its children
  'Cards', // nextra/components — grid around <Card/>s
  'Card', // rendered above, as a markdown link
  'Tabs', // nextra/components — wrapper; the tab labels are kept
  'Tab',
  'Pre', // rendered above, as a fenced code block
  'Code', // as a fence when paired with <Pre>; as a code span inline, below
  'Version', // rendered above, as the version string itself
]);

// ── paired components used inline, mid-sentence ─────────────────────────────
//
// The third shape a component can take, after "self-closing" and "opens a block
// on a line of its own": `… (e.g. <Code>allora_sdk==1.0.6</Code>) …`. It is how
// a page writes markup markdown cannot express inline — a code span whose
// contents come from <Version/>, say, which a plain backtick span would leave
// as the literal tag.
//
// Nothing recognised this shape before, so it reached the corpus verbatim: such
// a tag is neither self-closing (so the self-closing check never saw it) nor
// alone on its line (so the wrapper handling never saw it either). Renderers
// live here for the components whose markup means something; a paired tag found
// inline with no entry here and no layout classification stops generation, the
// same rule the other two shapes follow.
const INLINE_PAIRED_COMPONENTS = {
  // <Code>x</Code> is a code span, and a backtick span is markdown's spelling.
  Code: children => codeSpan(children),
};

// Wraps text as an inline code span, widening the fence past any backtick run
// inside it and padding when the content would otherwise glue to the fence —
// the CommonMark rules, so content containing backticks survives intact.
function codeSpan(text) {
  const longest = (text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const SELF_CLOSING_TAG = /<([A-Z][A-Za-z0-9]*)\b([^>]*)\/>/g;

// An opening tag, its children and its matching closing tag, all on one line.
// The children may not contain `<`, so a component wrapping another is left
// unmatched by one pass and reduced by the next, innermost first.
const INLINE_PAIRED_TAG = /<([A-Z][A-Za-z0-9]*)\b([^>]*)>([^<]*)<\/\1>/;

// Inside an inline code span, `<Callout>` is literal text the page is quoting,
// not markup to reduce — the same reasoning that leaves fenced blocks alone.
const CODE_SPAN = /(`+)[\s\S]*?\1/;

// Splits a line on its code spans and applies `render` to what falls outside.
function outsideCodeSpans(text, render) {
  let out = '';
  let rest = text;
  let span;
  while ((span = CODE_SPAN.exec(rest)) !== null) {
    out += render(rest.slice(0, span.index)) + span[0];
    rest = rest.slice(span.index + span[0].length);
  }
  return out + render(rest);
}

// The reduction for one paired tag, or null when nothing here knows the
// component (which assertNothingSurvives goes on to report).
function reduceInlinePairedTag(name, children, mdxFile) {
  const render = INLINE_PAIRED_COMPONENTS[name];
  if (render) return render(children);

  // A data component's output is read from a manifest, not from its children,
  // so unwrapping would publish a hole where the data belongs.
  if (DATA_COMPONENTS[name]) {
    throw new Error(
      `${path.relative(ROOT, mdxFile)} uses <${name}> as a paired tag. The generated ` +
        'corpus renders it from its JSON manifest, which only the self-closing form ' +
        `(<${name} … />) is understood as. Write it self-closing.`
    );
  }

  // Layout components are defined as carrying nothing but their tag, so
  // unwrapping inline is the reduction their block form already gets.
  if (LAYOUT_COMPONENTS.has(name)) return children;

  return null;
}

// `<Code>x</Code>` → `` `x` ``; `<Callout>x</Callout>` → `x`.
//
// A left-to-right scan in which a code span and a paired tag compete, and
// whichever opens first wins the text between them. Order matters both ways: a
// page quoting `` `<Callout>` `` means the literal tag and must not be reduced,
// while `<Code>echo `date`</Code>` means a code span *inside* the component and
// must not be split at its backticks.
//
// After each reduction the scan restarts, because the innermost tag is the only
// one that can match (children may not contain `<`) — collapsing it is what
// lets the component around it pair up on the next pass.
function renderInlinePairedComponents(text, mdxFile) {
  let result = text;
  let from = 0; // everything before this offset is settled

  // Every reduction removes a tag pair and introduces no new `<`, so the loop
  // is bounded by the tags on the line; the cap is a backstop, and anything it
  // ever left behind would be caught by assertNothingSurvives.
  for (let pass = 0; pass < 200; pass++) {
    const tail = result.slice(from);
    const tag = INLINE_PAIRED_TAG.exec(tail);
    if (!tag) break;

    const span = CODE_SPAN.exec(tail);
    if (span && span.index < tag.index) {
      from += span.index + span[0].length;
      continue;
    }

    const reduced = reduceInlinePairedTag(tag[1], tag[3], mdxFile);
    if (reduced === null) {
      // Unclassified: step over it so the scan continues, and leave the tag
      // exactly as written for assertNothingSurvives to report.
      from += tag.index + tag[0].length;
      continue;
    }

    const start = from + tag.index;
    result = result.slice(0, start) + reduced + result.slice(start + tag[0].length);
    from = 0;
  }

  return result;
}

// The last word before a line is emitted as prose. Anything still shaped like a
// component tag here survived every reduction above and would ship to an agent
// as literal JSX — the one thing the generated corpus promises never to carry.
// Fenced blocks never reach this point; inline code spans are quoted material
// and are excluded, as everywhere else.
const SURVIVING_TAG = /<\/?([A-Z][A-Za-z0-9]*)\b[^>]*>/;

function assertNothingSurvives(line, mdxFile) {
  let found = null;
  outsideCodeSpans(line, segment => {
    if (!found) found = SURVIVING_TAG.exec(segment);
    return segment;
  });
  if (!found) return;

  throw new Error(
    `${path.relative(ROOT, mdxFile)} leaves <${found[1]}> standing in prose, which ` +
      'scripts/lib/docsPages.js could not reduce to markdown — it would ship to agents ' +
      'as a literal tag. If it renders data, add it to DATA_COMPONENTS; if its markup ' +
      'means something inline (as <Code> does), add a renderer to ' +
      'INLINE_PAIRED_COMPONENTS; if it is layout only, add it to LAYOUT_COMPONENTS. ' +
      'Generation stops rather than publish the tag.'
  );
}

// Inline uses — `<TopicsCount network="testnet" /> active topics` — where the
// component stands for a value in the middle of a sentence.
function renderInlineDataComponents(text, mdxFile) {
  return text.replace(SELF_CLOSING_TAG, (whole, name, attributes) => {
    const component = DATA_COMPONENTS[name];
    if (!component || !component.inline) return whole;
    try {
      return component.inline(parseAttributes(attributes));
    } catch (error) {
      throw new Error(`${path.relative(ROOT, mdxFile)}: ${error.message}`);
    }
  });
}

// Code spans are excluded here as everywhere else: a page quoting
// `` `<SomeComponent />` `` to show a reader how to write it is documentation,
// not a component this reduction has to know.
function assertKnownComponents(line, mdxFile) {
  outsideCodeSpans(line, segment => {
    SELF_CLOSING_TAG.lastIndex = 0;
    let match;
    while ((match = SELF_CLOSING_TAG.exec(segment)) !== null) {
      const name = match[1];
      if (DATA_COMPONENTS[name] || LAYOUT_COMPONENTS.has(name)) continue;
      throw new Error(
        `${path.relative(ROOT, mdxFile)} uses <${name}/>, which scripts/lib/docsPages.js ` +
          'does not know how to reduce to markdown. Add it to DATA_COMPONENTS there if it ' +
          'renders data (so the generated corpus carries that data), or to ' +
          'LAYOUT_COMPONENTS if it is layout only and dropping the tag loses nothing. ' +
          'Generation stops rather than silently publishing a page without it.'
      );
    }
    return segment;
  });
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
// True only for a path that is genuinely inside pages/. Compared after
// resolution so `..` segments cannot walk out, and via path.relative rather
// than a string prefix so a sibling directory named `pages-archive` does not
// look like a match.
function withinPages(file) {
  const relative = path.relative(PAGES_DIR, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

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
      /\.mdx?$/.test(candidate) &&
      // Existing and markdown was not enough: `../../README.md` is both, and
      // urlForPageFile would then describe it relative to pages/ anyway,
      // yielding https://docs.allora.network/../README — a confidently wrong
      // URL where the honest answer is "this is not a page on this site".
      withinPages(candidate) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
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
// A CommonMark inline link tail: `](dest)`, and the forms the old pattern could
// not see — `](<dest with spaces>)`, `](dest "title")`, `](dest 'title')`,
// `](dest (title))`. Demanding `)` immediately after the destination meant a
// titled link was not a link at all as far as this pass was concerned, so it
// kept its relative destination in a file that has nothing to resolve it
// against, quietly breaking the corpus' one promise about links.
//
//   1 leading whitespace   2 destination   3 title and trailing whitespace
const INLINE_LINK =
  /\]\((\s*)(<[^<>\n]*>|(?:[^\s()]|\([^\s()]*\))+)((?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*)\)/g;

function absolutizeLinks(text, mdxFile) {
  return text.replace(INLINE_LINK, (whole, lead, destination, trailer) => {
    const angled = destination.startsWith('<') && destination.endsWith('>');
    const target = angled ? destination.slice(1, -1) : destination;

    // Absolute URLs, protocol-relative URLs, other schemes (mailto:, ipfs:) and
    // same-page fragments are already meaningful on their own.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) return whole;

    const absolute = target.startsWith('/')
      ? `${SITE_URL}${target}`
      : resolveRelativeLink(mdxFile, target);
    if (!absolute) return whole;

    // The title is the author's and is carried through untouched; only the
    // destination is rewritten, and it keeps whichever form it was written in.
    return `](${lead}${angled ? `<${absolute}>` : absolute}${trailer})`;
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
  const { constants, localNames } = importedConstants(bodyLines, mdxFile);
  const lines = stripMdxComments(bodyLines);
  const out = [];

  // Names the page interpolates that came from a local module but did not
  // resolve to a value. Collected rather than thrown on the spot so one run
  // reports all of them; see the throw after the loop.
  const unresolved = new Set();
  const interpolate = (text, pattern) =>
    text.replace(pattern, (whole, name) => {
      if (constants[name] !== undefined) return constants[name];
      if (localNames.has(name)) unresolved.add(name);
      return whole;
    });

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
      text = interpolate(text, /\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g);
      text = absolutizeLinks(text, mdxFile);
    }
    emit(text);
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

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

    // ── <Version of="…"/> → the version string ──
    // Done before the JSX handling below, and only outside fences: the tag
    // stands where the version belongs in a sentence, so unwrapping it as a
    // component (dropping it) or leaving it literal both lose the fact.
    //
    // Outside inline code spans too, and for the same reason a fence is
    // skipped: a page writing `` `<Version of="chain-testnet"/>` `` is showing
    // the reader how to write the tag, and resolving that to a version turns
    // documentation of the component into a claim about the network. The
    // <Code> wrapper is untouched by this — it is still JSX at this point, not
    // a backtick span, so a version inside it resolves as it should.
    line = outsideCodeSpans(line, segment => renderVersionTags(segment, mdxFile));

    // ── ESM lines that only exist for the rendered site ──
    if (ESM_IMPORT.test(line) || ESM_EXPORT.test(line)) continue;

    // ── data components used inline in a sentence ──
    // Same reasoning as <Version/>, code spans included: the component stands
    // where the value belongs, so dropping it loses the fact and leaving it
    // literal ships JSX — unless the page is quoting the tag itself.
    line = outsideCodeSpans(line, segment => renderInlineDataComponents(segment, mdxFile));

    // Every remaining self-closing component must be one this reduction knows.
    assertKnownComponents(line, mdxFile);

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
      const text = interpolate(code[1], /\$\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g);
      emit(`\`\`\`${preLanguage || ''}`);
      text.split(/\r?\n/).forEach(emit);
      emit('```');
      continue;
    }

    // ── paired components used inline in a sentence ──
    // After the <Pre>/<Code> block form above, which owns its whole line: what
    // is left is markup inside prose, `(e.g. <Code>allora_sdk==1.0.6</Code>)`,
    // which reduces to a code span rather than being dropped or passed through.
    line = renderInlinePairedComponents(line, mdxFile);

    // ── a self-closing component occupying a line of its own ──
    // A data component renders its manifest here; a layout component has
    // nothing but its tag, so the tag goes. assertKnownComponents above has
    // already refused anything that is neither.
    const selfClosing = line.match(/^(\s*)<([A-Z][A-Za-z0-9]*)\b([^>]*)\/>\s*$/);
    if (selfClosing) {
      const component = DATA_COMPONENTS[selfClosing[2]];
      if (component && component.block) {
        let rendered;
        try {
          rendered = component.block(parseAttributes(selfClosing[3]), mdxFile);
        } catch (error) {
          throw new Error(`${path.relative(ROOT, mdxFile)}: ${error.message}`);
        }
        // A table needs a blank line on each side to be a table.
        if (out.length > 0 && out[out.length - 1].text.trim() !== '') emit('');
        rendered.forEach(emit);
        emit('');
      }
      continue;
    }

    const openTag = line.match(/^(\s*)<([A-Z][A-Za-z0-9]*)\b([^>]*)>\s*$/);
    if (openTag) {
      const indent = openTag[1].length;
      const name = openTag[2];

      // A data component's output *is* its children, so unwrapping a paired
      // form would drop the data exactly the way the self-closing form used to.
      if (DATA_COMPONENTS[name]) {
        throw new Error(
          `${path.relative(ROOT, mdxFile)} uses <${name}> as a paired tag. The generated ` +
            'corpus renders it from its JSON manifest, which only the self-closing form ' +
            `(<${name} … />) is understood as. Write it self-closing.`
        );
      }

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

    // Every line-level shape has had its turn; this one is prose, so no
    // component tag may still be standing in it.
    assertNothingSurvives(line, mdxFile);
    emitContent(line);
  }

  // A constant the page imported locally and interpolated but that did not
  // resolve would ship as its own name — `${CHAIN_VERSION_TESTNET}` inside a
  // copy-paste install command, say. That is worse than no output at all, so
  // generation stops here instead.
  if (unresolved.size > 0) {
    throw new Error(
      `${path.relative(ROOT, mdxFile)} interpolates ${[...unresolved].sort().join(', ')}, ` +
        'imported from a local module, but the value could not be resolved. ' +
        'loadModuleConstants() in scripts/lib/docsPages.js understands literal string ' +
        "exports, the .replace(/^v/, '') derivation, and versionOf('<id>'[, { bare: true }]); " +
        'teach it the new shape rather than shipping the placeholder'
    );
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
