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
// Usage:
//   node scripts/runSnippets.js                 # run everything
//   node scripts/runSnippets.js --list          # print the plan, run nothing
//   node scripts/runSnippets.js --only=quickstart_consume.py
//   node scripts/runSnippets.js --report=out.md # machine-readable failure report
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

const REPO_ROOT = path.resolve(__dirname, '..');

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
    snippetsDir: path.join(REPO_ROOT, 'snippets'),
    configPath: path.join(REPO_ROOT, 'scripts', 'snippets.config.json'),
  };
  for (const arg of argv) {
    if (arg === '--list') opts.list = true;
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length);
    else if (arg.startsWith('--report=')) opts.report = arg.slice('--report='.length);
    else if (arg.startsWith('--snippets-dir=')) opts.snippetsDir = path.resolve(arg.slice('--snippets-dir='.length));
    else if (arg.startsWith('--config=')) opts.configPath = path.resolve(arg.slice('--config='.length));
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

  return names.map(name => {
    const override = config.snippets[name] || {};
    return {
      name,
      file: path.join(opts.snippetsDir, name),
      language: LANGUAGES[path.extname(name)],
      mode: override.mode || DEFAULTS.mode,
      timeoutSeconds: override.timeoutSeconds || DEFAULTS.timeoutSeconds,
      skip: Boolean(override.skip),
      reason: override.reason || '',
      requires: override.requires || [],
      pip: override.pip || [],
      npm: override.npm || [],
      // { "model.py": "worker_model.py" } -- copy sibling snippets a snippet imports.
      files: override.files || {},
    };
  });
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
  const projectDir = path.join(workDir, 'node');
  fs.mkdirSync(projectDir, { recursive: true });
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
  return { goCacheDir };
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
    fs.writeFileSync(path.join(runDir, '.allora_key'), process.env.ALLORA_WALLET_MNEMONIC.trim() + '\n', {
      mode: 0o600,
    });
  }
  return runDir;
}

function commandFor(snippet, runDir, toolchains) {
  switch (snippet.language) {
    case 'python':
      return { command: toolchains.python.python, args: [snippet.name], cwd: runDir, env: {} };
    case 'node': {
      // Run out of the prepared project so the SDK and tsx resolve, but keep the
      // snippet's own directory as the working directory.
      const tsx = path.join(toolchains.node.projectDir, 'node_modules', '.bin', 'tsx');
      const runner = snippet.name.endsWith('.ts') ? tsx : process.execPath;
      return {
        command: runner,
        args: [snippet.name],
        cwd: runDir,
        env: { NODE_PATH: path.join(toolchains.node.projectDir, 'node_modules') },
      };
    }
    case 'go':
      return { command: 'go', args: ['run', '.'], cwd: runDir, env: { GOFLAGS: '-mod=mod' } };
    default:
      throw new Error(`${snippet.name}: no runner for language ${snippet.language}`);
  }
}

function prepareGoModule(runDir, snippet, toolchains, toolchain) {
  const moduleName = 'allora-doc-snippet-' + path.basename(snippet.name, '.go').replace(/_/g, '-');
  const env = { ...process.env, GOCACHE: path.join(toolchains.go.goCacheDir, 'build') };
  run('go', ['mod', 'init', moduleName], runDir);
  if (toolchain.goModule) {
    execFileSync('go', ['get', toolchain.goModule], { cwd: runDir, env, stdio: 'pipe' });
  }
  execFileSync('go', ['mod', 'tidy'], { cwd: runDir, env, stdio: 'pipe' });
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
    const collect = chunk => {
      output += chunk;
      // Keep memory bounded on a chatty worker loop; the tail is what matters.
      if (output.length > 200000) output = output.slice(-200000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10000).unref();
    }, snippet.timeoutSeconds * 1000);

    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\nfailed to launch ${command}: ${err.message}` });
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        // A worker loop has no natural end -- surviving the window IS the pass.
        const ok = snippet.mode === 'long-running';
        resolve({
          ok,
          output,
          note: ok
            ? `ran for ${snippet.timeoutSeconds}s without exiting (expected for a worker loop)`
            : `timed out after ${snippet.timeoutSeconds}s`,
        });
        return;
      }
      resolve({ ok: code === 0, output, note: `exited with code ${code}` });
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
  lines.push('');
  for (const failure of failures) {
    lines.push(`## \`snippets/${failure.name}\``);
    lines.push('');
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
        (snippet.requires.length ? `, needs ${snippet.requires.join('+')}` : '');
    console.log(`  ${snippet.name.padEnd(28)} ${detail}`);
  }
  if (opts.list) return 0;

  const runnable = plan.filter(s => !s.skip);
  preflightCredentials(runnable);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allora-snippets-'));
  console.log(`\nWork directory: ${workDir}`);

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
      if (snippet.language === 'go') prepareGoModule(runDir, snippet, toolchains, config.toolchain);
      result = await execute(snippet, runDir, toolchains);
    } catch (err) {
      result = { ok: false, output: String(err.stderr || err.message), note: 'setup failed' };
    }
    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(`${status}  ${snippet.name} -- ${result.note}`);
    if (!result.ok) {
      console.log(result.output.trim().split('\n').slice(-40).map(l => `      | ${l}`).join('\n'));
    }
    results.push({ name: snippet.name, status, note: result.note, output: result.output });
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
