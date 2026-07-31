#!/usr/bin/env node
//
// Execute every runnable snippet in snippets/ against the Allora testnet.
//
// The docs embed these files verbatim (see scripts/remarkIncludeCode.js), so a
// snippet that stops working is a page that stops working. This runner is what
// the nightly workflow calls: it builds a clean toolchain per language, runs
// each snippet in its own directory, and exits non-zero if any of them fail.
//
// Snippets are DISCOVERED from the directory: drop a new .py/.ts/.js/.go file in
// snippets/ and it is picked up on the next run with the default settings. Per
// snippet overrides (including opting a file out of execution) live in
// scripts/snippets.config.json.
//
// A snippet passes only when it prints the result its page documents (its
// `expect` pattern). Merely exiting 0, or merely staying alive, is not enough:
// the worker loop catches its own exceptions and prints them, so a worker whose
// registration or submission failed would otherwise look perfectly healthy.
//
// A snippet's timeout measures the snippet, never the toolchain. Installing
// packages and compiling happen in a separate warm-up phase with its own budget,
// so a slow cold start can never be mistaken for a broken snippet.
//
// Usage:
//   node scripts/runSnippets.js                 # run everything
//   node scripts/runSnippets.js --list          # print the plan, run nothing
//   node scripts/runSnippets.js --only=quickstart_consume.py
//   node scripts/runSnippets.js --report=out.md # machine-readable failure report
//   node scripts/runSnippets.js --keep-work-dir # keep logs/venv (never the key)
//   node scripts/runSnippets.js --snippets-dir=/tmp/x --config=/tmp/x.json
//
// Credentials come from the environment and are never logged:
//   ALLORA_API_KEY          free key from developer.allora.network
//   ALLORA_WALLET_MNEMONIC  mnemonic of a funded testnet wallet
//
// Snippets that submit transactions all sign with that one wallet, so they are
// run strictly one at a time: two processes signing with the same account would
// race on the account sequence number.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { redact } = require('./redactSecrets');

const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Cleanup
//
// The run directories hold .allora_key, i.e. the funded wallet's mnemonic in
// plaintext. Contributors are invited to run this locally, so leaving that
// behind in the system temp directory is not acceptable. Removal is
// unconditional -- --keep-work-dir keeps the logs and the venv for debugging,
// but never the key.
// ---------------------------------------------------------------------------

const keyFiles = new Set();
let workDirToRemove = null;
let cleanedUp = false;

function registerWorkDir(dir, keep) {
  workDirToRemove = keep ? null : dir;
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const file of keyFiles) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* best effort -- a leftover directory is recoverable, a crash here is not */
    }
  }
  keyFiles.clear();
  if (workDirToRemove) {
    try {
      fs.rmSync(workDirToRemove, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}
process.on('uncaughtException', err => {
  cleanup();
  console.error(err);
  process.exit(2);
});

// Extension -> how to run it. `setup` prepares the shared toolchain once.
const LANGUAGES = {
  '.py': 'python',
  '.ts': 'node',
  '.js': 'node',
  '.go': 'go',
};

const DEFAULTS = {
  // A snippet that is expected to terminate must do so within this many seconds.
  timeoutSeconds: 120,
  // "exit"         -- must exit 0 before the timeout; a timeout is a failure.
  // "long-running" -- a worker loop with no natural end; staying alive for the
  //                   whole window is a pass, exiting non-zero is a failure.
  mode: 'exit',
  // Ceiling for each toolchain-preparation step (Go module fetch and compile).
  // Charged separately from timeoutSeconds -- see the warm-up section.
  warmupTimeoutSeconds: 900,
};

// Base packages installed into the clean toolchain for every language. Declared
// in the config so the runner itself stays project-agnostic and testable.
const DEFAULT_TOOLCHAIN = {
  pip: [],
  npm: [],
  goModule: null,
};

// Which interpreter builds the virtualenv. The snippets document Python 3.10+,
// so CI pins an interpreter rather than trusting whatever `python3` resolves to.
const PYTHON = process.env.PYTHON || 'python3';

function parseArgs(argv) {
  const opts = {
    list: false,
    only: null,
    report: null,
    keepWorkDir: false,
    snippetsDir: path.join(REPO_ROOT, 'snippets'),
    configPath: path.join(REPO_ROOT, 'scripts', 'snippets.config.json'),
  };
  for (const arg of argv) {
    if (arg === '--list') opts.list = true;
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length);
    else if (arg.startsWith('--report=')) opts.report = arg.slice('--report='.length);
    else if (arg.startsWith('--snippets-dir=')) opts.snippetsDir = path.resolve(arg.slice('--snippets-dir='.length));
    else if (arg.startsWith('--config=')) opts.configPath = path.resolve(arg.slice('--config='.length));
    else if (arg === '--keep-work-dir') opts.keepWorkDir = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) return { snippets: {}, toolchain: DEFAULT_TOOLCHAIN };
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    snippets: raw.snippets || {},
    toolchain: { ...DEFAULT_TOOLCHAIN, ...(raw.toolchain || {}) },
  };
}

function discover(opts, config) {
  if (!fs.existsSync(opts.snippetsDir)) {
    throw new Error(`Snippets directory not found: ${opts.snippetsDir}`);
  }
  const names = fs
    .readdirSync(opts.snippetsDir)
    .filter(name => Object.prototype.hasOwnProperty.call(LANGUAGES, path.extname(name)))
    .sort();

  // A config entry pointing at a file that no longer exists is almost always a
  // stale exclusion silently suppressing coverage. Fail loudly instead.
  for (const name of Object.keys(config.snippets)) {
    if (!names.includes(name)) {
      throw new Error(
        `snippets.config.json has an entry for "${name}", which is not a runnable ` +
          `snippet in ${opts.snippetsDir}. Remove the entry or restore the file.`
      );
    }
  }

  const plan = names.map(name => {
    const override = config.snippets[name] || {};
    return {
      name,
      file: path.join(opts.snippetsDir, name),
      language: LANGUAGES[path.extname(name)],
      mode: override.mode || DEFAULTS.mode,
      timeoutSeconds: override.timeoutSeconds || DEFAULTS.timeoutSeconds,
      // Budget for preparing the toolchain, charged separately from the run.
      // Generous on purpose: a cold `go build` of a Cosmos-SDK-sized dependency
      // tree is minutes of honest work, and starving it would reintroduce the
      // very failure this exists to prevent.
      warmupTimeoutSeconds: override.warmupTimeoutSeconds || DEFAULTS.warmupTimeoutSeconds,
      skip: Boolean(override.skip),
      reason: override.reason || '',
      requires: override.requires || [],
      pip: override.pip || [],
      npm: override.npm || [],
      // { "model.py": "worker_model.py" } -- copy sibling snippets a snippet imports.
      files: override.files || {},
      // The line the snippet prints when it actually did its job. Required for
      // a pass. Every one of these snippets is a happy-path program the docs
      // show output for, so "it printed the documented result" is the honest
      // bar -- see the note on expect/failOn below.
      expect: override.expect ? new RegExp(override.expect) : null,
      expectDescription: override.expect || '',
      // The line the snippet prints when it swallowed an error instead of
      // crashing. The worker loop catches exceptions and prints them, so
      // without this a broken worker would look alive and healthy.
      failOn: override.failOn ? new RegExp(override.failOn) : null,
      failOnDescription: override.failOn || '',
    };
  });

  // A long-running snippet never exits, so its exit code proves nothing: without
  // a success marker the only possible verdict would be "it stayed alive", which
  // is not evidence that it worked. Refuse to run in that configuration rather
  // than quietly reporting green.
  for (const snippet of plan) {
    if (!snippet.skip && snippet.mode === 'long-running' && !snippet.expect) {
      throw new Error(
        `${snippet.name} is configured mode "long-running" without an "expect" ` +
          `pattern. A snippet that never exits can only be judged by what it ` +
          `prints, so "expect" is required -- otherwise staying alive would count ` +
          `as a pass even if every submission failed.`
      );
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const CREDENTIALS = {
  apiKey: {
    env: 'ALLORA_API_KEY',
    hint: 'a free API key from developer.allora.network',
  },
  wallet: {
    env: 'ALLORA_WALLET_MNEMONIC',
    hint: 'the BIP-39 mnemonic of a funded allora-testnet-1 wallet',
  },
};

function preflightCredentials(plan) {
  const missing = new Map();
  for (const snippet of plan) {
    for (const key of snippet.requires) {
      const credential = CREDENTIALS[key];
      if (!credential) throw new Error(`${snippet.name}: unknown requirement "${key}"`);
      if (!process.env[credential.env]) {
        if (!missing.has(credential.env)) missing.set(credential.env, []);
        missing.get(credential.env).push(snippet.name);
      }
    }
  }
  if (missing.size === 0) return;
  const lines = [...missing.entries()].map(
    ([env, users]) =>
      `  ${env} (${CREDENTIALS[Object.keys(CREDENTIALS).find(k => CREDENTIALS[k].env === env)].hint})\n` +
      `    needed by: ${users.join(', ')}`
  );
  throw new Error(`Missing credentials in the environment:\n${lines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Toolchain setup
// ---------------------------------------------------------------------------

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function setupPython(workDir, plan, toolchain) {
  const venv = path.join(workDir, 'venv');
  console.log(`  creating a clean virtualenv at ${venv} (${PYTHON})`);
  run(PYTHON, ['-m', 'venv', venv], workDir);
  const pip = path.join(venv, 'bin', 'pip');
  const packages = [...new Set([...toolchain.pip, ...plan.flatMap(s => s.pip)])];
  if (packages.length > 0) {
    console.log(`  pip install ${packages.join(' ')}`);
    run(pip, ['install', '--quiet', '--upgrade', 'pip'], workDir);
    run(pip, ['install', '--quiet', ...packages], workDir);
  }
  return { python: path.join(venv, 'bin', 'python') };
}

function setupNode(workDir, plan, toolchain) {
  // Install at the root of the work directory, above runs/, so that a snippet at
  // <workDir>/runs/<name>/x.ts resolves bare specifiers by walking up into
  // <workDir>/node_modules -- the only mechanism ESM has. NODE_PATH does not
  // work here: Node honours it for CommonJS only, and these snippets are ESM,
  // so pointing at node_modules that way fails with ERR_MODULE_NOT_FOUND.
  const projectDir = workDir;
  const packages = [...new Set([...toolchain.npm, ...plan.flatMap(s => s.npm)])];
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'allora-doc-snippets', private: true, type: 'module' }, null, 2) + '\n'
  );
  if (packages.length > 0) {
    console.log(`  npm install ${packages.join(' ')}`);
    run('npm', ['install', '--silent', '--no-audit', '--no-fund', ...packages], projectDir);
  }
  return { projectDir };
}

function setupGo(workDir) {
  const goCacheDir = path.join(workDir, 'gocache');
  fs.mkdirSync(goCacheDir, { recursive: true });
  // One build cache shared by every Go snippet, so the second module reuses the
  // first one's compiled packages instead of rebuilding the whole Cosmos SDK
  // dependency tree from scratch. GOMODCACHE is deliberately left at its
  // default: Go marks that tree read-only, which makes it awkward to delete on
  // cleanup, and on CI it is ephemeral anyway.
  const env = { ...process.env, GOCACHE: goCacheDir, GOFLAGS: '-mod=mod' };
  console.log(`  build cache at ${goCacheDir} (shared by every Go snippet)`);
  return { goCacheDir, env };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function prepareRunDir(workDir, snippet, opts) {
  const runDir = path.join(workDir, 'runs', snippet.name.replace(/\W+/g, '_'));
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(snippet.file, path.join(runDir, snippet.name));
  for (const [dest, source] of Object.entries(snippet.files)) {
    fs.copyFileSync(path.join(opts.snippetsDir, source), path.join(runDir, dest));
  }

  // The Python worker reads its wallet from `.allora_key` in the working
  // directory when no wallet is configured explicitly, and prompts on stdin
  // when that file is absent. CI has no TTY, so materialise the funded wallet
  // up front. 0600, and never written anywhere the logs can reach.
  if (snippet.requires.includes('wallet') && process.env.ALLORA_WALLET_MNEMONIC) {
    const keyFile = path.join(runDir, '.allora_key');
    fs.writeFileSync(keyFile, process.env.ALLORA_WALLET_MNEMONIC.trim() + '\n', { mode: 0o600 });
    keyFiles.add(keyFile);
  }
  return runDir;
}

function commandFor(snippet, runDir, toolchains) {
  switch (snippet.language) {
    case 'python':
      return { command: toolchains.python.python, args: [snippet.name], cwd: runDir, env: {} };
    case 'node': {
      // The run directory sits under the project root, so node_modules resolves
      // by walking up -- nothing needs to be injected into the environment.
      const tsx = path.join(toolchains.node.projectDir, 'node_modules', '.bin', 'tsx');
      const runner = snippet.name.endsWith('.ts') ? tsx : process.execPath;
      return { command: runner, args: [snippet.name], cwd: runDir, env: {} };
    }
    case 'go':
      // The already-compiled binary, not `go run .` -- see warmUpGo.
      return { command: path.join(runDir, GO_BINARY), args: [], cwd: runDir, env: {} };
    default:
      throw new Error(`${snippet.name}: no runner for language ${snippet.language}`);
  }
}

// ---------------------------------------------------------------------------
// Warm-up
//
// A snippet's timeout is meant to measure the snippet, not the toolchain. Go
// makes that distinction easy to lose: `go run .` downloads and compiles the
// entire dependency tree before main() produces a single byte, and for a module
// that pulls in the Cosmos SDK that is minutes of work on a cold runner. The
// first live CI run failed exactly this way -- quickstart_consume.go timed out
// with completely empty output while the equivalent .py and .ts snippets
// passed, because the Go snippet never got as far as running.
//
// So everything expensive happens here, before the clock starts, and the timed
// phase executes a binary that is already built. Warm-up gets its own generous
// budget and its own log line, so "the toolchain could not be prepared" can
// never be mistaken for "the snippet is broken".
// ---------------------------------------------------------------------------

const GO_BINARY = 'snippet-binary';

function warmUpStep(label, command, args, cwd, env, timeoutSeconds) {
  const started = Date.now();
  try {
    execFileSync(command, args, {
      cwd,
      env,
      stdio: 'pipe',
      timeout: timeoutSeconds * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    // execFileSync surfaces its own `timeout` as ETIMEDOUT rather than by
    // setting `killed`, so check both -- "timed out" and "failed" send the
    // reader looking in very different places.
    const timedOut = err.killed === true || err.code === 'ETIMEDOUT' || err.errno === 'ETIMEDOUT';
    const error = new Error(
      `warm-up step \`${label}\` ${timedOut ? 'timed out' : 'failed'} after ${seconds}s ` +
        `(warm-up budget ${timeoutSeconds}s)`
    );
    error.isWarmUpFailure = true;
    error.detail = [err.stdout, err.stderr].filter(Boolean).map(String).join('\n').trim() || err.message;
    throw error;
  }
  return (Date.now() - started) / 1000;
}

function warmUpGo(runDir, snippet, toolchains, toolchain) {
  const moduleName = 'allora-doc-snippet-' + path.basename(snippet.name, '.go').replace(/_/g, '-');
  const env = toolchains.go.env;
  const budget = snippet.warmupTimeoutSeconds;
  let elapsed = 0;

  elapsed += warmUpStep('go mod init', 'go', ['mod', 'init', moduleName], runDir, env, budget);
  if (toolchain.goModule) {
    elapsed += warmUpStep('go get', 'go', ['get', toolchain.goModule], runDir, env, budget);
  }
  elapsed += warmUpStep('go mod tidy', 'go', ['mod', 'tidy'], runDir, env, budget);
  // The whole point: compile now, so the timed phase only runs the program.
  elapsed += warmUpStep(
    'go build',
    'go',
    ['build', '-o', path.join(runDir, GO_BINARY), '.'],
    runDir,
    env,
    budget
  );
  return elapsed;
}

// Languages whose toolchain is prepared once, in the setup phase, rather than
// per snippet: Python installs into a shared virtualenv and Node installs into a
// shared project, both before any snippet is timed. Only Go needs per-snippet
// warm-up, because each Go snippet is its own module.
function warmUp(snippet, runDir, toolchains, toolchain) {
  if (snippet.language === 'go') return warmUpGo(runDir, snippet, toolchains, toolchain);
  return 0;
}

// Decide pass/fail from what the snippet actually did.
//
// Staying alive is NOT a pass. The worker loop catches its own exceptions and
// prints them, so a worker whose auth, faucet, registration, or submission all
// failed would otherwise sit there looking healthy for the whole window and be
// reported green. A snippet passes only when it prints the result the page says
// it prints.
function classify(snippet, { code, timedOut, output }) {
  if (snippet.failOn && snippet.failOn.test(output)) {
    return { ok: false, note: `printed an error it swallowed (/${snippet.failOnDescription}/)` };
  }
  const satisfied = !snippet.expect || snippet.expect.test(output);

  if (timedOut) {
    return {
      ok: false,
      note: snippet.expect
        ? `timed out after ${snippet.timeoutSeconds}s without printing /${snippet.expectDescription}/`
        : `timed out after ${snippet.timeoutSeconds}s`,
    };
  }
  if (code !== 0) return { ok: false, note: `exited with code ${code}` };
  if (!satisfied) {
    return { ok: false, note: `exited 0 but never printed /${snippet.expectDescription}/` };
  }
  return { ok: true, note: `exited 0` + (snippet.expect ? ` after printing /${snippet.expectDescription}/` : '') };
}

function execute(snippet, runDir, toolchains) {
  const { command, args, cwd, env } = commandFor(snippet, runDir, toolchains);
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env, PYTHONUNBUFFERED: '1' },
      // No TTY and no stdin: a snippet that tries to prompt must fail rather
      // than hang until the job's own timeout kills the whole run.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let settled = null; // 'success' | 'failure' -- decided from streamed output
    let timedOut = false;

    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10000).unref();
    };

    const collect = chunk => {
      output += chunk;
      // Keep memory bounded on a chatty worker loop; the tail is what matters.
      if (output.length > 200000) output = output.slice(-200000);
      if (settled) return;
      if (snippet.failOn && snippet.failOn.test(output)) {
        settled = 'failure';
        stop();
      } else if (snippet.mode === 'long-running' && snippet.expect && snippet.expect.test(output)) {
        // The worker did the thing. No reason to hold the runner open for the
        // rest of the window.
        settled = 'success';
        stop();
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, snippet.timeoutSeconds * 1000);

    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\nfailed to launch ${command}: ${err.message}` });
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (settled === 'success') {
        resolve({ ok: true, output, note: `printed /${snippet.expectDescription}/` });
        return;
      }
      if (settled === 'failure') {
        resolve({
          ok: false,
          output,
          note: `printed an error it swallowed (/${snippet.failOnDescription}/)`,
        });
        return;
      }
      const verdict = classify(snippet, { code, timedOut, output });
      resolve({ ...verdict, output });
    });
  });
}

// ---------------------------------------------------------------------------

function writeReport(reportPath, results, plan) {
  const failures = results.filter(r => r.status === 'FAIL');
  const lines = ['# Snippet run report', ''];
  lines.push(`- snippets discovered: ${plan.length}`);
  lines.push(`- executed: ${results.filter(r => r.status !== 'SKIP').length}`);
  lines.push(`- failed: ${failures.length}`);
  const warmUpFailures = failures.filter(f => f.phase === 'warm-up');
  if (warmUpFailures.length > 0) {
    lines.push(
      `- of those, ${warmUpFailures.length} failed while preparing the toolchain, ` +
        `not while running the snippet`
    );
  }
  lines.push('');
  for (const failure of failures) {
    lines.push(`## \`snippets/${failure.name}\``);
    lines.push('');
    if (failure.phase === 'warm-up') {
      lines.push(
        '**Toolchain warm-up failed — the snippet never ran, so this says nothing ' +
          'about whether the snippet itself is correct.**'
      );
      lines.push('');
    }
    lines.push(`${failure.note}`);
    lines.push('');
    lines.push('```');
    lines.push(failure.output.trim().split('\n').slice(-60).join('\n'));
    lines.push('```');
    lines.push('');
  }
  fs.writeFileSync(reportPath, lines.join('\n'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadConfig(opts.configPath);
  let plan = discover(opts, config);
  if (opts.only) plan = plan.filter(s => s.name === opts.only);
  if (plan.length === 0) {
    console.error('No snippets matched.');
    process.exit(2);
  }

  console.log(`Snippets directory: ${opts.snippetsDir}`);
  for (const snippet of plan) {
    const detail = snippet.skip
      ? `skipped -- ${snippet.reason || 'no reason given'}`
      : `${snippet.language}, ${snippet.mode}, ${snippet.timeoutSeconds}s` +
        (snippet.requires.length ? `, needs ${snippet.requires.join('+')}` : '') +
        (snippet.expect ? `, must print /${snippet.expectDescription}/` : '');
    console.log(`  ${snippet.name.padEnd(28)} ${detail}`);
  }
  if (opts.list) return 0;

  const runnable = plan.filter(s => !s.skip);
  preflightCredentials(runnable);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allora-snippets-'));
  registerWorkDir(workDir, opts.keepWorkDir);
  console.log(`\nWork directory: ${workDir}${opts.keepWorkDir ? ' (kept; wallet key still removed)' : ''}`);

  const toolchains = {};
  const languages = new Set(runnable.map(s => s.language));
  if (languages.has('python')) {
    console.log('\nPython toolchain');
    toolchains.python = setupPython(workDir, runnable.filter(s => s.language === 'python'), config.toolchain);
  }
  if (languages.has('node')) {
    console.log('\nNode toolchain');
    toolchains.node = setupNode(workDir, runnable.filter(s => s.language === 'node'), config.toolchain);
  }
  if (languages.has('go')) {
    console.log('\nGo toolchain');
    toolchains.go = setupGo(workDir);
  }

  console.log('\nRunning snippets\n');
  const results = [];
  for (const snippet of plan) {
    if (snippet.skip) {
      console.log(`SKIP  ${snippet.name} -- ${snippet.reason || 'no reason given'}`);
      results.push({ name: snippet.name, status: 'SKIP', note: snippet.reason, output: '' });
      continue;
    }
    const runDir = prepareRunDir(workDir, snippet, opts);
    let result;
    try {
      const warmUpSeconds = warmUp(snippet, runDir, toolchains, config.toolchain);
      if (warmUpSeconds > 0) {
        console.log(
          `WARM  ${snippet.name} -- toolchain ready in ${warmUpSeconds.toFixed(1)}s ` +
            `(not charged to the ${snippet.timeoutSeconds}s run budget)`
        );
      }
      result = await execute(snippet, runDir, toolchains);
    } catch (err) {
      // Keep the two apart: a warm-up failure means the toolchain could not be
      // prepared, which says nothing about whether the snippet works.
      result = err.isWarmUpFailure
        ? { ok: false, phase: 'warm-up', output: String(err.detail || ''), note: err.message }
        : { ok: false, phase: 'setup', output: String(err.stderr || err.message), note: 'setup failed' };
    }
    // Snippet output is arbitrary third-party output and can quote the
    // credentials it was handed. Redact before it reaches the console (which is
    // teed to an uploaded artifact) or the report (which is posted into a
    // public issue).
    result.output = redact(result.output);
    const status = result.ok ? 'PASS' : 'FAIL';
    const label = result.phase === 'warm-up' ? 'FAIL(warm-up)' : status;
    console.log(`${label}  ${snippet.name} -- ${result.note}`);
    if (!result.ok) {
      console.log(result.output.trim().split('\n').slice(-40).map(l => `      | ${l}`).join('\n'));
    }
    results.push({
      name: snippet.name,
      status,
      phase: result.phase || 'run',
      note: result.note,
      output: result.output,
    });
  }

  const failures = results.filter(r => r.status === 'FAIL');
  const skipped = results.filter(r => r.status === 'SKIP');
  console.log(
    `\n${results.length - failures.length - skipped.length} passed, ` +
      `${failures.length} failed, ${skipped.length} skipped`
  );
  if (opts.report) writeReport(opts.report, results, plan);
  return failures.length === 0 ? 0 : 1;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(`\n${err.message}`);
    process.exit(2);
  });
