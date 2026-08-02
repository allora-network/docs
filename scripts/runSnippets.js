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
// Every snippet that runs must declare that pattern -- a runnable snippet with
// no `expect` is a configuration error the runner refuses to start on, never a
// silent pass.
//
// A snippet's timeout measures the snippet, never the toolchain. Installing
// packages and compiling happen in a separate warm-up phase with its own budget,
// so a slow cold start can never be mistaken for a broken snippet.
//
// Usage:
//   node scripts/runSnippets.js                 # run everything
//   node scripts/runSnippets.js --list          # print the plan, run nothing
//   node scripts/runSnippets.js --budget        # print the worst-case run budget
//   node scripts/runSnippets.js --budget-cap-minutes=240   # ...and check it fits
//   node scripts/runSnippets.js --only=quickstart_consume.py
//   node scripts/runSnippets.js --report=out.md # machine-readable failure report
//   node scripts/runSnippets.js --keep-work-dir # keep logs/venv (never the key)
//   node scripts/runSnippets.js --snippets-dir=/tmp/x --config=/tmp/x.json
//
// Credentials come from the environment and are never logged:
//   ALLORA_API_KEY          free key from developer.allora.network
//   ALLORA_WALLET_MNEMONIC  mnemonic of a funded testnet wallet
//
// Nothing but a snippet that asked for them ever sees them. Package
// installation and compilation run with both variables deleted from the child
// environment, and each snippet process gets back only the credentials its
// `requires` list declares. An install hook, or a dependency pulled in by a
// read-only snippet, therefore has no credential in its environment to
// exfiltrate -- and unlike a leaked log line, a network call cannot be redacted
// after the fact.
//
// Snippets that submit transactions all sign with that one wallet, so they are
// run strictly one at a time: two processes signing with the same account would
// race on the account sequence number.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { redact, SECRET_ENV_VARS } = require('./redactSecrets');

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

// The snippet currently running, if any. Cleanup kills it before anything else:
// a worker snippet is a loop that keeps signing testnet transactions with the
// funded wallet, and Ctrl-C or a cancelled CI job that only tore down the runner
// would leave it doing exactly that, unattended and unwatched.
let activeChild = null;

function registerWorkDir(dir, keep) {
  workDirToRemove = keep ? null : dir;
}

// Kill the whole process group, not just the process we spawned. A snippet is a
// Python or Node interpreter that may itself have spawned children, and killing
// only the interpreter can leave those orphaned and still running. Children are
// spawned `detached`, which makes each one a process-group leader, so its pid
// doubles as the group id and a negative pid reaches everything under it.
function killTree(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (err) {
    // ESRCH: it is already gone, which is the outcome we wanted. Anything else
    // (EPERM on a group we do not own) still deserves an attempt at the process
    // itself -- a partial kill beats none.
    if (err.code === 'ESRCH') return;
    try {
      child.kill(signal);
    } catch {
      /* best effort: there is nothing further to try */
    }
  }
}

function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // First, before the key file and the work directory: stopping the transactions
  // matters more than tidying up after them, and this is the only chance to do
  // it -- once this process exits, an orphaned worker has no supervisor left.
  killTree(activeChild, 'SIGKILL');
  activeChild = null;
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

// Ceiling for each step of the once-per-run language setup (venv creation, pip
// install, npm install). Same purpose as warmupTimeoutSeconds, but not
// per-snippet: these steps are shared, so they are not configurable per snippet
// either. A stalled package registry hits this ceiling and is reported as a
// warm-up failure instead of hanging until the CI job's own timeout kills the
// run with nothing to show for it.
const SETUP_TIMEOUT_SECONDS = 600;

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
    budget: false,
    budgetCapMinutes: null,
    only: null,
    report: null,
    keepWorkDir: false,
    snippetsDir: path.join(REPO_ROOT, 'snippets'),
    configPath: path.join(REPO_ROOT, 'scripts', 'snippets.config.json'),
  };
  for (const arg of argv) {
    if (arg === '--list') opts.list = true;
    else if (arg === '--budget') opts.budget = true;
    else if (arg.startsWith('--budget-cap-minutes=')) {
      opts.budgetCapMinutes = Number(arg.slice('--budget-cap-minutes='.length));
      opts.budget = true;
      if (!Number.isFinite(opts.budgetCapMinutes) || opts.budgetCapMinutes <= 0) {
        console.error(`--budget-cap-minutes needs a positive number, got "${arg}"`);
        process.exit(2);
      }
    } else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length);
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
      reason: typeof override.reason === 'string' ? override.reason.trim() : '',
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

  // Every snippet that runs must say what proves it worked. Without an
  // "expect" pattern the only available verdict is "the process exited 0" --
  // and for a long-running one, not even that, only "it stayed alive". Both are
  // equally true of a snippet that silently did nothing, so a newly added file
  // with no config entry would otherwise be reported green from its very first
  // night. A missing pattern is a configuration error, never a pass.
  const withoutExpect = plan.filter(snippet => !snippet.skip && !snippet.expect);
  if (withoutExpect.length > 0) {
    throw new Error(
      `No "expect" pattern configured for: ${withoutExpect.map(s => s.name).join(', ')}.\n` +
        `Every runnable snippet needs one in ${opts.configPath}: it is the line the\n` +
        `snippet prints when it actually did its job, and it is the only thing that\n` +
        `can distinguish a working snippet from one that exited 0 (or stayed alive)\n` +
        `having done nothing. Add "expect", or "skip" the file with a reason.`
    );
  }

  // A skip is the one way to remove a file from nightly coverage, so it is the
  // one place a silent regression can hide: the snippet stops being tested and
  // nothing on the record says why, or for how long. The config documents a
  // written reason as mandatory -- enforce it, rather than printing "no reason
  // given" and carrying on as if that were a reason.
  const unexplained = plan.filter(snippet => snippet.skip && !snippet.reason);
  if (unexplained.length > 0) {
    throw new Error(
      `Skipped without a reason: ${unexplained.map(s => s.name).join(', ')}.\n` +
        `Every "skip" in ${opts.configPath} needs a non-empty "reason": it is the\n` +
        `only record of why a snippet stopped being tested, and what would have to\n` +
        `be true to test it again. Write one, or remove the skip.`
    );
  }

  // `files` names get joined onto the run directory and onto the snippets
  // directory, so anything with a path separator in it would write or read
  // outside both. The config is in-repo and reviewed, but a rule that only holds
  // because nobody has broken it yet is not a rule -- and the check costs a
  // line. Both halves must be a plain entry name, and the source must be a
  // snippet that exists.
  for (const snippet of plan) {
    for (const [dest, source] of Object.entries(snippet.files)) {
      for (const [role, value] of [['destination', dest], ['source', source]]) {
        if (value !== path.basename(value) || value === '.' || value === '..') {
          throw new Error(
            `${snippet.name}: "files" ${role} "${value}" is not a plain filename. ` +
              `These are copied into the snippet's run directory, so a path with ` +
              `separators in it would read or write outside it.`
          );
        }
      }
      if (!fs.existsSync(path.join(opts.snippetsDir, source))) {
        throw new Error(
          `${snippet.name}: "files" names "${source}", which is not in ${opts.snippetsDir}.`
        );
      }
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

// Every variable that must not reach a child process by accident. Unioned with
// redactSecrets' list so the two can never drift apart: a value worth redacting
// out of the logs is a value worth withholding from a process that has no
// business reading it.
const CREDENTIAL_ENV_VARS = [
  ...new Set([...Object.values(CREDENTIALS).map(credential => credential.env), ...SECRET_ENV_VARS]),
];

// The base environment for every child the runner spawns: this process's own,
// minus every credential. Package managers, compilers and their install hooks
// get exactly this and nothing more.
function credentialFreeEnv() {
  const env = { ...process.env };
  for (const name of CREDENTIAL_ENV_VARS) delete env[name];
  return env;
}

// The environment a snippet runs in: credential-free, plus back exactly the
// credentials it declared in `requires`. A read-only snippet that only needs
// the API key never has the funded wallet's mnemonic in its environment, so
// neither does anything it imports.
function envForSnippet(snippet) {
  const env = credentialFreeEnv();
  for (const key of snippet.requires) {
    const credential = CREDENTIALS[key];
    if (!credential) throw new Error(`${snippet.name}: unknown requirement "${key}"`);
    const value = process.env[credential.env];
    if (value !== undefined) env[credential.env] = value;
  }
  return env;
}

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
//
// Installing packages is running third-party code, so it happens in the
// credential-free environment and under a bounded budget: an install hook has
// nothing to steal, and a stalled registry ends the step at
// SETUP_TIMEOUT_SECONDS with a "warm-up" verdict instead of hanging the job.
// Each step goes through warmUpStep for exactly that reason -- the snippets of
// that language are then reported FAIL(warm-up), which says "the toolchain
// could not be prepared", not "the snippet is broken".
// ---------------------------------------------------------------------------

function setupPython(workDir, plan, toolchain) {
  const venv = path.join(workDir, 'venv');
  const env = credentialFreeEnv();
  console.log(`  creating a clean virtualenv at ${venv} (${PYTHON})`);
  warmUpStep(`${PYTHON} -m venv`, PYTHON, ['-m', 'venv', venv], workDir, env, SETUP_TIMEOUT_SECONDS);
  const pip = path.join(venv, 'bin', 'pip');
  const packages = [...new Set([...toolchain.pip, ...plan.flatMap(s => s.pip)])];
  if (packages.length > 0) {
    console.log(`  pip install ${packages.join(' ')}`);
    warmUpStep('pip install --upgrade pip', pip, ['install', '--quiet', '--upgrade', 'pip'], workDir, env, SETUP_TIMEOUT_SECONDS);
    warmUpStep(`pip install ${packages.join(' ')}`, pip, ['install', '--quiet', ...packages], workDir, env, SETUP_TIMEOUT_SECONDS);
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
  const env = credentialFreeEnv();
  const packages = [...new Set([...toolchain.npm, ...plan.flatMap(s => s.npm)])];
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'allora-doc-snippets', private: true, type: 'module' }, null, 2) + '\n'
  );
  if (packages.length > 0) {
    console.log(`  npm install ${packages.join(' ')}`);
    // --ignore-scripts: no lifecycle script of any package in the tree runs.
    // The snippets need the published JavaScript, nothing a postinstall hook
    // would build, and the packages the pages tell readers to install are
    // verified to work installed this way.
    warmUpStep(
      `npm install ${packages.join(' ')}`,
      'npm',
      ['install', '--silent', '--no-audit', '--no-fund', '--ignore-scripts', ...packages],
      projectDir,
      env,
      SETUP_TIMEOUT_SECONDS
    );
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
  //
  // `go get`/`go build` fetch and compile third-party code, so like pip and npm
  // they run without the credentials.
  const env = { ...credentialFreeEnv(), GOCACHE: goCacheDir, GOFLAGS: '-mod=mod' };
  console.log(`  build cache at ${goCacheDir} (shared by every Go snippet)`);
  return { goCacheDir, env };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function prepareRunDir(workDir, snippet, opts) {
  // The snippet's own filename, not a sanitised version of it. Sanitising was a
  // collision waiting to happen: `a-b.go` and `a_b.go` both became `a_b_go`, so
  // the second Go snippet would inherit the first one's go.mod and compiled
  // binary and fail in its warm-up instead of running. The name is already a
  // valid directory entry -- it came from readdir -- and names are unique within
  // a directory, so using it as-is is collision-free by construction.
  const runDir = path.join(workDir, 'runs', snippet.name);
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
      // SIGKILL rather than the default SIGTERM: a package manager or compiler
      // that has stopped responding is exactly the process least likely to
      // honour a polite request, and this budget has already expired.
      killSignal: 'SIGKILL',
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
//
// Judged from `sawExpect`/`sawFailOn`, which were decided as the output
// streamed, never by re-matching the retained buffer -- that buffer is
// truncated, so re-matching it would silently fail a snippet whose result
// scrolled out of the window.
function classify(snippet, { code, timedOut, sawExpect, sawFailOn }) {
  if (sawFailOn) {
    return { ok: false, note: `printed an error it swallowed (/${snippet.failOnDescription}/)` };
  }
  // discover() refuses to start without a pattern for every runnable snippet,
  // so this is unreachable in a normal run. It is restated here so that no
  // future caller of this function can turn "nothing to check against" into a
  // pass: with no pattern there is no evidence, and no evidence is a failure.
  if (!snippet.expect) {
    return {
      ok: false,
      note: 'has no "expect" pattern configured, so nothing it printed could count as success',
    };
  }
  const satisfied = sawExpect;

  if (timedOut) {
    return {
      ok: false,
      note: `timed out after ${snippet.timeoutSeconds}s without printing /${snippet.expectDescription}/`,
    };
  }
  if (code !== 0) return { ok: false, note: `exited with code ${code}` };
  if (!satisfied) {
    return { ok: false, note: `exited 0 but never printed /${snippet.expectDescription}/` };
  }
  return { ok: true, note: `exited 0 after printing /${snippet.expectDescription}/` };
}

// How much output is kept for the log and the failure report. The verdict does
// NOT depend on this: see the scan window below.
const OUTPUT_LIMIT = 200000;

// How much of the stream is carried across chunk boundaries when looking for the
// `expect` and `failOn` markers. A marker can straddle two reads, so each chunk
// is matched together with the tail of the previous one; 8 KiB is far longer
// than any line these snippets print.
const SCAN_OVERLAP = 8192;

function execute(snippet, runDir, toolchains) {
  const { command, args, cwd, env } = commandFor(snippet, runDir, toolchains);
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      // The only place a credential is handed to a child process, and only the
      // ones this snippet declared in `requires`.
      env: { ...envForSnippet(snippet), ...env, PYTHONUNBUFFERED: '1' },
      // No TTY and no stdin: a snippet that tries to prompt must fail rather
      // than hang until the job's own timeout kills the whole run.
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so stopping it stops whatever it spawned too --
      // see killTree.
      detached: true,
    });
    activeChild = child;

    let output = '';
    let settled = null; // 'success' | 'failure' -- decided from streamed output
    let timedOut = false;

    // The verdict, accumulated as the stream arrives. Once a marker has been
    // seen it stays seen: the output buffer below is truncated, and a snippet
    // that printed its result and then chattered past the limit used to have
    // that result thrown away and be reported as a failure.
    let sawExpect = false;
    let sawFailOn = false;
    let scanTail = '';

    const stop = () => {
      killTree(child, 'SIGTERM');
      setTimeout(() => killTree(child, 'SIGKILL'), 10000).unref();
    };

    const collect = chunk => {
      // Match first, on a window that spans the chunk boundary, and only then
      // append to the bounded buffer.
      const window = scanTail + chunk;
      if (!sawFailOn && snippet.failOn && snippet.failOn.test(window)) sawFailOn = true;
      if (!sawExpect && snippet.expect && snippet.expect.test(window)) sawExpect = true;
      scanTail = window.length > SCAN_OVERLAP ? window.slice(-SCAN_OVERLAP) : window;

      output += chunk;
      // Keep memory bounded on a chatty worker loop; the tail is what matters
      // for reading the failure afterwards. Nothing is decided from this buffer.
      if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);

      if (settled) return;
      if (sawFailOn) {
        settled = 'failure';
        stop();
      } else if (snippet.mode === 'long-running' && sawExpect) {
        // The worker did the thing. No reason to hold the runner open for the
        // rest of the window.
        settled = 'success';
        stop();
      }
    };
    // Decode once, here, so a multi-byte character split across two reads is
    // not turned into replacement characters that a marker could hide behind.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, snippet.timeoutSeconds * 1000);

    const finish = result => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      resolve(result);
    };

    child.on('error', err => {
      finish({
        ok: false,
        output: `${output}\nfailed to launch ${command}: ${err.message}`,
        note: `could not be launched (${err.message})`,
      });
    });

    child.on('close', code => {
      if (settled === 'success') {
        finish({ ok: true, output, note: `printed /${snippet.expectDescription}/` });
        return;
      }
      if (settled === 'failure') {
        finish({
          ok: false,
          output,
          note: `printed an error it swallowed (/${snippet.failOnDescription}/)`,
        });
        return;
      }
      finish({ ...classify(snippet, { code, timedOut, sawExpect, sawFailOn }), output });
    });
  });
}

// ---------------------------------------------------------------------------
// Run budget
//
// The nightly job's `timeout-minutes` is a number somebody typed; the time this
// runner is allowed to take is computed from snippets.config.json. Those two
// drift apart the moment a snippet is added, and the drift is invisible until
// the night the job is cancelled halfway -- writing no report, opening no issue,
// and looking like nothing was wrong. So the number is derived here and the
// workflow checks it against its own cap, which turns silent drift into a red
// run with an arithmetic breakdown.
//
// Worst case, not expected case: every window burned in full. The happy path is
// minutes, because each window ends the moment its snippet prints what it must.
// ---------------------------------------------------------------------------

const MARGIN_MINUTES = 15; // checkout, the language setup actions, upload, issue

function computeBudget(plan, toolchain) {
  const runnable = plan.filter(s => !s.skip);
  const languages = new Set(runnable.map(s => s.language));
  const lines = [];
  let seconds = 0;

  if (languages.has('python')) {
    // venv, then (only if there is anything to install) pip upgrade + install.
    const packages = new Set([...toolchain.pip, ...runnable.flatMap(s => s.pip)]);
    const steps = 1 + (packages.size > 0 ? 2 : 0);
    seconds += steps * SETUP_TIMEOUT_SECONDS;
    lines.push(`Python setup    ${steps} x ${SETUP_TIMEOUT_SECONDS}s`);
  }
  if (languages.has('node')) {
    const packages = new Set([...toolchain.npm, ...runnable.flatMap(s => s.npm)]);
    const steps = packages.size > 0 ? 1 : 0;
    seconds += steps * SETUP_TIMEOUT_SECONDS;
    lines.push(`Node setup      ${steps} x ${SETUP_TIMEOUT_SECONDS}s`);
  }

  const goSnippets = runnable.filter(s => s.language === 'go');
  if (goSnippets.length > 0) {
    // mod init, mod tidy, build -- plus `go get` when a module is configured.
    const stepsEach = 3 + (toolchain.goModule ? 1 : 0);
    const goSeconds = goSnippets.reduce((total, s) => total + stepsEach * s.warmupTimeoutSeconds, 0);
    seconds += goSeconds;
    lines.push(`Go warm-up      ${goSnippets.length} snippet(s) x ${stepsEach} steps`);
  }

  const windows = runnable.reduce((total, s) => total + s.timeoutSeconds, 0);
  seconds += windows;
  lines.push(`Snippet windows ${runnable.length} runnable, ${windows}s total`);

  return { seconds, minutes: Math.ceil(seconds / 60), lines, runnable: runnable.length };
}

function reportBudget(plan, toolchain, capMinutes) {
  const budget = computeBudget(plan, toolchain);
  console.log('\nWorst-case run budget');
  budget.lines.forEach(line => console.log(`  ${line}`));
  console.log(`  ${'='.repeat(40)}`);
  console.log(`  worst case ${budget.seconds}s = ${budget.minutes} min`);
  console.log(`  + ${MARGIN_MINUTES} min for checkout, language setup, upload and the issue`);
  console.log(`  => the job's timeout-minutes must be at least ${budget.minutes + MARGIN_MINUTES}`);

  if (capMinutes === null) return 0;

  const required = budget.minutes + MARGIN_MINUTES;
  if (capMinutes < required) {
    console.error(
      `\n::error::The snippets job allows ${capMinutes} minutes, but the snippets ` +
        `configured in scripts/snippets.config.json can legitimately take ${budget.minutes} ` +
        `and need ${required} with room for the rest of the job. A job cancelled at its ` +
        `cap writes no report and opens no issue, so raise timeout-minutes to at least ` +
        `${required} (and update the arithmetic in the comment above it).`
    );
    return 1;
  }
  console.log(`  the job allows ${capMinutes} min: ${capMinutes - required} min to spare`);
  return 0;
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
      ? `skipped -- ${snippet.reason}`
      : `${snippet.language}, ${snippet.mode}, ${snippet.timeoutSeconds}s` +
        (snippet.requires.length ? `, needs ${snippet.requires.join('+')}` : '') +
        (snippet.expect ? `, must print /${snippet.expectDescription}/` : '');
    console.log(`  ${snippet.name.padEnd(28)} ${detail}`);
  }
  if (opts.budget) return reportBudget(plan, config.toolchain, opts.budgetCapMinutes);
  if (opts.list) return 0;

  const runnable = plan.filter(s => !s.skip);
  preflightCredentials(runnable);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allora-snippets-'));
  registerWorkDir(workDir, opts.keepWorkDir);
  console.log(`\nWork directory: ${workDir}${opts.keepWorkDir ? ' (kept; wallet key still removed)' : ''}`);

  const toolchains = {};
  // language -> why its toolchain could not be prepared. Every snippet of that
  // language is then reported FAIL(warm-up) rather than the whole run dying
  // with no report: a stalled registry must still produce the failure report
  // the nightly job turns into an issue.
  const setupFailures = new Map();
  const languages = new Set(runnable.map(s => s.language));

  const prepare = (language, label, build) => {
    if (!languages.has(language)) return;
    console.log(`\n${label} toolchain`);
    try {
      toolchains[language] = build();
    } catch (err) {
      const note = err.isWarmUpFailure
        ? err.message
        : `${label} toolchain setup failed: ${err.message}`;
      console.log(`FAIL(warm-up)  ${label} toolchain -- ${note}`);
      setupFailures.set(language, {
        note,
        output: String(err.detail || err.stderr || err.message || ''),
      });
    }
  };

  prepare('python', 'Python', () =>
    setupPython(workDir, runnable.filter(s => s.language === 'python'), config.toolchain)
  );
  prepare('node', 'Node', () =>
    setupNode(workDir, runnable.filter(s => s.language === 'node'), config.toolchain)
  );
  prepare('go', 'Go', () => setupGo(workDir));

  console.log('\nRunning snippets\n');
  const results = [];
  for (const snippet of plan) {
    if (snippet.skip) {
      // discover() guarantees the reason is there, so there is no "no reason
      // given" fallback to print any more.
      console.log(`SKIP  ${snippet.name} -- ${snippet.reason}`);
      results.push({ name: snippet.name, status: 'SKIP', note: snippet.reason, output: '' });
      continue;
    }
    let result;
    const setupFailure = setupFailures.get(snippet.language);
    if (setupFailure) {
      // Its language's shared toolchain never came up, so this snippet was
      // never given a chance to run. Same verdict shape as a per-snippet
      // warm-up failure, for the same reason: it says nothing about the
      // snippet itself.
      result = { ok: false, phase: 'warm-up', note: setupFailure.note, output: setupFailure.output };
    } else {
      const runDir = prepareRunDir(workDir, snippet, opts);
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

// Set the code and let Node exit on its own rather than calling process.exit().
// Writes to a pipe are asynchronous, and the nightly job pipes this straight
// into `tee` -- process.exit() drops whatever is still queued, which is exactly
// the summary, and on the failure path exactly the message the issue is built
// from. Nothing here holds the event loop open (the escalation timers are
// unref'd), so the process still ends as soon as its output has drained.
main()
  .then(code => {
    process.exitCode = code;
  })
  .catch(err => {
    console.error(`\n${err.message}`);
    process.exitCode = 2;
  });
