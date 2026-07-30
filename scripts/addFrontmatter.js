const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Idempotent frontmatter sweep. Ensures every page under pages/ carries the
// five required frontmatter keys (title, description, persona,
// verified_against, last_reviewed). Existing keys and values are never
// modified — only missing (or empty) keys are filled in — so the script is
// safe to re-run at any time. Run via `yarn frontmatter`.
//
// Derivation rules for filled-in values:
// - title:            the page's first `# ` heading (markdown stripped).
// - description:      the blockquote subtitle under the H1 if present,
//                     otherwise the first prose paragraph, clamped to ~1
//                     sentence. Review and refine generated descriptions.
// - persona:          mapped from the page's section (see PERSONA_MAP).
// - verified_against: `docs content as of <last_reviewed>` — i.e. no
//                     external-source verification is claimed beyond the docs
//                     state on the page's own review date. Replace with a
//                     concrete source + version when the page is properly
//                     verified.
// - last_reviewed:    the date of the last git commit that substantively
//                     changed the page. Pure renames and known site-wide
//                     mechanical commits (moves, bulk link rewrites) are
//                     ignored so the date reflects an actual content review.

const relativeDirectoryPath = process.argv[2] || './pages';
const directoryPath = path.resolve(relativeDirectoryPath);

const REQUIRED_KEYS = ['title', 'description', 'persona', 'verified_against', 'last_reviewed'];

// First matching prefix (relative to pages/) wins; order most-specific first.
const PERSONA_MAP = [
  ['build/reputer', 'Reputer operator'],
  ['build', 'ML builder'],
  ['consume', 'App developer'],
  ['get-started', 'New Allora developer'],
  ['operate/topics', 'Topic creator'],
  ['operate/validators', 'Validator operator'],
  ['operate', 'Network operator'],
  ['learn', 'Protocol researcher'],
  ['reference', 'Builder or operator'],
];
const DEFAULT_PERSONA = 'Allora developer';

// Site-wide restructuring / mechanical-rewrite commits (page moves into the
// current IA, bulk internal-link updates). Their timestamps say nothing about
// when a page's content was last reviewed, so they are ignored when deriving
// last_reviewed.
const MECHANICAL_COMMITS = [
  '0af8db0d2bb7c3bd33f2b358869b5dcd049376dc', // IA restructure (merge)
  '7a3227ef201e75ea20b44fd8c13a923907b9f734', // nav card / stub cleanup
  '901506b549cce3c71ca18b406e1d2f66a820cafc', // bulk internal-link rewrite
  '24fa13f55d66c065714b29931dfad24b1f2de9d7', // page moves into new IA
];

const today = new Date().toISOString().slice(0, 10);

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];

  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else if (file.endsWith('.mdx') || file.endsWith('.md')) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

// --- frontmatter parsing -----------------------------------------------------

// If the file starts with a `---` block, returns
// { lines, bodyStart } where lines are the raw frontmatter lines and bodyStart
// is the line index just after the closing `---`. Otherwise returns null.
function parseFrontmatter(lines) {
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      return { lines: lines.slice(1, i), bodyStart: i + 1 };
    }
  }
  return null;
}

// Normalizes a raw frontmatter scalar with YAML semantics: strips matching
// quotes, drops trailing comments from unquoted values, and treats the YAML
// null forms (`~`, `null`, `Null`, `NULL`) and comment-only values as empty,
// mirroring checkFrontmatter.js — so the sweep fills in exactly the values
// the checker rejects.
function parseScalar(raw) {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^(["'])(.*)\1$/);
  if (quoted) return quoted[2].trim();
  const value = trimmed.replace(/(^|\s)#.*$/, '').trim();
  if (/^(?:~|null|Null|NULL)$/.test(value)) return '';
  return value;
}

function frontmatterKeys(fmLines) {
  const keys = {};
  fmLines.forEach((line, index) => {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) return;
    keys[match[1]] = { value: parseScalar(match[2]), index };
  });
  return keys;
}

// --- value derivation --------------------------------------------------------

function stripInlineMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSkippableLine(line) {
  return (
    /^#{1,6}\s/.test(line) ||
    /^import\s/.test(line) ||
    /^export\s/.test(line) ||
    /^</.test(line) ||
    /^{/.test(line) ||
    /^[-*+]\s/.test(line) ||
    /^\d+\.\s/.test(line) ||
    /^\|/.test(line) ||
    /^!\[/.test(line) ||
    /^\$\$/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  );
}

// Walks body lines with code-fence awareness, calling visit(line) for each
// line outside code fences. visit returns true to stop.
function walkProse(bodyLines, visit) {
  let inFence = false;
  for (const line of bodyLines) {
    if (/^(```|~~~)/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (visit(line)) return;
  }
}

function deriveTitle(bodyLines, file) {
  let title = null;
  walkProse(bodyLines, line => {
    const match = line.match(/^#\s+(.+)$/);
    if (match) {
      title = stripInlineMarkdown(match[1]);
      return true;
    }
    return false;
  });
  if (title) return title;
  // Fallback: humanize the filename.
  const base = path.basename(file).replace(/\.mdx?$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function clampSentences(text, softLimit, hardLimit) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const sentence of sentences) {
    if (out && (out + ' ' + sentence).length > softLimit) break;
    out = out ? out + ' ' + sentence : sentence;
  }
  if (out.length > hardLimit) {
    out = out.slice(0, hardLimit).replace(/\s+\S*$/, '') + '...';
  }
  return out;
}

function deriveDescription(bodyLines, title) {
  let seenH1 = false;
  let blockquote = null;
  const paragraph = [];
  let collecting = false;

  walkProse(bodyLines, line => {
    if (!seenH1) {
      if (/^#\s+/.test(line)) seenH1 = true;
      return false;
    }
    const trimmed = line.trim();
    if (collecting) {
      if (trimmed === '' || isSkippableLine(trimmed) || /^>/.test(trimmed)) return true;
      paragraph.push(trimmed);
      return false;
    }
    if (trimmed === '') return false;
    if (/^>\s*(.+)$/.test(trimmed)) {
      // Blockquote subtitle directly under the H1.
      blockquote = trimmed.replace(/^>\s*/, '');
      return true;
    }
    if (isSkippableLine(trimmed)) return false;
    paragraph.push(trimmed);
    collecting = true;
    return false;
  });

  const source = blockquote || paragraph.join(' ');
  const clean = stripInlineMarkdown(source);
  if (!clean) return `${title} on the Allora Network.`;
  // Drop dangling "lead-in" punctuation (e.g. a sentence ending in ":") and
  // make sure the description ends like a sentence.
  let description = clampSentences(clean, 180, 240).replace(/[\s:;,]+$/, '');
  if (description && !/[.!?]$/.test(description)) description += '.';
  return description;
}

function derivePersona(relPath) {
  const posix = relPath.split(path.sep).join('/');
  for (const [prefix, persona] of PERSONA_MAP) {
    if (posix === prefix || posix.startsWith(prefix + '/')) return persona;
  }
  return DEFAULT_PERSONA;
}

function deriveLastReviewed(file) {
  let out;
  try {
    out = execFileSync(
      'git',
      ['log', '--follow', '--date=short', '--format=%x01%H %ad', '--name-status', '--', file],
      { encoding: 'utf8' }
    );
  } catch (error) {
    return today; // not a git checkout, or file not yet tracked
  }

  for (const chunk of out.split('\x01')) {
    if (!chunk.trim()) continue;
    const lines = chunk.trim().split('\n');
    const [sha, date] = lines[0].split(' ');
    if (MECHANICAL_COMMITS.includes(sha)) continue;
    const statusLine = lines.find(line => /^[A-Z]\S*\t/.test(line));
    if (statusLine && /^R100\t/.test(statusLine)) continue; // pure rename
    if (date) return date;
  }
  return today;
}

// --- YAML emission -----------------------------------------------------------

function needsQuoting(value) {
  return (
    value === '' ||
    /^[\s!&*?#|>@`"'%,{}[\]]/.test(value) ||
    /^- /.test(value) ||
    /:(\s|$)/.test(value) ||
    /\s#/.test(value) ||
    /"/.test(value) ||
    /^\s|\s$/.test(value) ||
    /[\n\t]/.test(value)
  );
}

function emitEntry(key, value) {
  if (key === 'last_reviewed' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${key}: ${value}`;
  }
  return needsQuoting(value) ? `${key}: ${JSON.stringify(value)}` : `${key}: ${value}`;
}

// --- main --------------------------------------------------------------------

function processFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  // Split on \r?\n (like checkFrontmatter.js) so CRLF files are recognized as
  // already carrying frontmatter instead of getting a duplicate block
  // prepended. Files the sweep rewrites are normalized to LF.
  const lines = content.split(/\r?\n/);
  const fm = parseFrontmatter(lines);
  const fmLines = fm ? fm.lines.slice() : [];
  const keys = frontmatterKeys(fmLines);
  const bodyLines = fm ? lines.slice(fm.bodyStart) : lines;
  const relPath = path.relative(directoryPath, file);

  const missing = REQUIRED_KEYS.filter(key => !(key in keys) || keys[key].value === '');
  if (missing.length === 0) return null;

  const title = 'title' in keys && keys.title.value !== '' ? keys.title.value : deriveTitle(bodyLines, file);
  // The fallback verified_against claims nothing beyond the docs state on the
  // page's own review date, so both keys are pinned to the same date: the
  // existing last_reviewed value if the page has one, else the git-derived one.
  let lastReviewedMemo =
    'last_reviewed' in keys && keys.last_reviewed.value !== '' ? keys.last_reviewed.value : null;
  const lastReviewed = () => (lastReviewedMemo ??= deriveLastReviewed(file));
  const derived = {
    title,
    description: () => deriveDescription(bodyLines, title),
    persona: () => derivePersona(relPath),
    verified_against: () => `docs content as of ${lastReviewed()}`,
    last_reviewed: lastReviewed,
  };

  missing.forEach(key => {
    const value = key === 'title' ? title : derived[key]();
    const entry = emitEntry(key, value);
    if (key in keys) {
      fmLines[keys[key].index] = entry; // present but empty: fill it in
    } else {
      fmLines.push(entry);
    }
  });

  const body = fm ? lines.slice(fm.bodyStart) : lines;
  // Ensure exactly one blank line between the closing --- and the body.
  while (body.length > 0 && body[0].trim() === '') body.shift();
  const updated = ['---', ...fmLines, '---', '', ...body].join('\n');
  fs.writeFileSync(file, updated, 'utf8');
  return missing;
}

function main() {
  const files = getAllFiles(directoryPath).sort();
  let updated = 0;

  files.forEach(file => {
    const added = processFile(file);
    if (added) {
      updated++;
      console.log(`${path.relative(process.cwd(), file)} — added: ${added.join(', ')}`);
    }
  });

  console.log(
    `\nFrontmatter sweep: ${updated} of ${files.length} pages updated, ` +
    `${files.length - updated} already complete.`
  );
  if (updated > 0) {
    console.log('Review generated values (especially description and persona) before committing.');
  }
}

main();
