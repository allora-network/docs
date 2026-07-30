const fs = require('fs');
const path = require('path');

// Enforces the docs page template: every page under pages/ must start with a
// frontmatter block that carries all five required keys, each with a non-empty
// value. Run via `yarn checkfm`; also chained into `yarn build` and run in CI
// (.github/workflows/check-frontmatter.yml). Exits non-zero on any violation.
//
// To fill in missing frontmatter automatically, run `yarn frontmatter`
// (scripts/addFrontmatter.js).

const relativeDirectoryPath = process.argv[2] || './pages';
const directoryPath = path.resolve(relativeDirectoryPath);

const REQUIRED_KEYS = ['title', 'description', 'persona', 'verified_against', 'last_reviewed'];

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

// Returns the frontmatter lines if the file starts with a `---` block,
// otherwise null.
function frontmatterLines(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return lines.slice(1, i);
  }
  return null; // unterminated block
}

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const fm = frontmatterLines(content);
  if (fm === null) {
    return REQUIRED_KEYS.slice(); // everything is missing
  }

  const present = {};
  fm.forEach(line => {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) return;
    const value = match[2].trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    present[match[1]] = value;
  });

  return REQUIRED_KEYS.filter(key => !(key in present) || present[key] === '');
}

function main() {
  const files = getAllFiles(directoryPath).sort();
  const failures = [];

  files.forEach(file => {
    const missing = checkFile(file);
    if (missing.length > 0) {
      failures.push({ file: path.relative(process.cwd(), file), missing });
    }
  });

  if (failures.length > 0) {
    console.error(`Frontmatter check failed for ${failures.length} of ${files.length} pages.`);
    console.error(`Every page must start with a frontmatter block carrying: ${REQUIRED_KEYS.join(', ')}.`);
    console.error('Run `yarn frontmatter` to fill in missing keys, then review the generated values.\n');
    failures.forEach(({ file, missing }) => {
      console.error(`  ${file} — missing or empty: ${missing.join(', ')}`);
    });
    process.exitCode = 1;
    return;
  }

  console.log(`Frontmatter OK: ${files.length}/${files.length} pages carry ${REQUIRED_KEYS.join(', ')}.`);
}

main();
