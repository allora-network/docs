#!/usr/bin/env node
//
// Strip credential values out of anything that leaves the CI job.
//
// GitHub masks secrets in the workflow *log*, but not in uploaded artifacts and
// not in issue bodies -- both of which the nightly snippet run produces. Snippet
// output is arbitrary third-party output (an SDK error can quote the key it was
// handed), so it is redacted at the source instead of being trusted.
//
// Used two ways:
//   const { redact } = require('./redactSecrets');   // in scripts/runSnippets.js
//   node scripts/redactSecrets.js file [file...]     // belt-and-braces in CI
//
// Values come from the environment, so no secret is ever written into this file
// or passed on a command line.

const fs = require('fs');

const SECRET_ENV_VARS = ['ALLORA_API_KEY', 'ALLORA_WALLET_MNEMONIC'];
const PLACEHOLDER = '***REDACTED***';

// Anything shorter than this is too generic to blanket-replace without mangling
// unrelated output (and is not a plausible key or mnemonic).
const MIN_SECRET_LENGTH = 8;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A mnemonic that survives a round trip through a file, a log, or a JSON blob
// can come back re-wrapped, so match it whitespace-insensitively rather than
// only as the exact string that went in.
function patternsFor(value) {
  const trimmed = value.trim();
  const patterns = [escapeRegExp(trimmed)];
  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    patterns.push(words.map(escapeRegExp).join('\\s+'));
  }
  return patterns;
}

function buildPatterns(env = process.env) {
  const patterns = [];
  for (const name of SECRET_ENV_VARS) {
    const value = env[name];
    if (!value || value.trim().length < MIN_SECRET_LENGTH) continue;
    for (const pattern of patternsFor(value)) {
      patterns.push(new RegExp(pattern, 'g'));
    }
  }
  return patterns;
}

function redact(text, env = process.env) {
  if (!text) return text;
  let out = String(text);
  for (const pattern of buildPatterns(env)) {
    out = out.replace(pattern, PLACEHOLDER);
  }
  // The wallet file itself is written from the mnemonic, so any command that
  // dumps it is redacted by the rules above -- but a snippet that merely prints
  // the path is a signpost to the key on a self-hosted runner. Blank the name.
  return out.replace(/(^|[\s"'`([])((?:[\w./~-]*\/)?)\.allora_key\b/g, '$1$2.allora_key(redacted)');
}

module.exports = { redact, buildPatterns, PLACEHOLDER, SECRET_ENV_VARS };

if (require.main === module) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/redactSecrets.js <file> [file...]');
    process.exit(2);
  }
  let changed = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = redact(before);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed++;
    }
  }
  // Deliberately reports only a count -- naming which file matched would leak
  // where the credential surfaced.
  console.log(`redactSecrets: scanned ${files.length} file(s), redacted ${changed}`);
}
