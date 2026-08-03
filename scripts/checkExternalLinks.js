const fs = require('fs');
const path = require('path');
const util = require('util');

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);

const relativeDirectoryPath = process.argv[2] || './pages';
const directoryPath = path.resolve(relativeDirectoryPath);

// Machine-readable manifests under public/api are scanned alongside pages/.
// They hold endpoint URLs that used to be written into page prose, and without
// this every URL moved into a manifest would silently drop out of link
// checking. Skipped when an explicit directory is passed on the command line.
const extraDirectoryPaths = process.argv[2]
  ? []
  : [path.resolve('./public/api')].filter(dir => fs.existsSync(dir));

// Any github.com/allora-network/* link (including raw.githubusercontent.com)
// that does not resolve with a 200 for an anonymous request is a hard failure:
// a private or deleted org repo must count as a dead link. All other domains
// are warn-only.
const hardFailPattern = /^https?:\/\/((www\.)?github\.com|raw\.githubusercontent\.com)\/allora-network(\/|$)/i;

// Hosts that are known to block HEAD requests, anonymous clients, or bots with
// non-2xx statuses even though the content exists. Warn-only hosts listed here
// are skipped entirely instead of producing noisy false-positive warnings.
const flakyHostAllowlist = [
  'twitter.com',      // blocks anonymous/bot requests
  'x.com',            // blocks anonymous/bot requests
  'medium.com',       // 403s bot user agents
  'www.okx.com',      // bot protection
  'aws.amazon.com',   // bot protection on marketing pages
  'www.tiingo.com',   // bot protection
];

// Exact URLs that are intentionally fictional (illustrative examples in code
// snippets) and must not be link-checked. Keep this list short and commented.
const exampleUrlAllowlist = [
  // devs/validators/software-upgrades.mdx: example UpgradeInfo JSON uses a
  // deliberately fake release version to show the payload shape.
  'https://github.com/allora-network/allora-chain/releases/download/v9.9.9/allorad_amd64.tar.gz',
];

// Statuses meaning "the host is alive but gates anonymous/bot clients"
// (auth walls, bot protection, HEAD/media-type rejection). For warn-only
// domains these are treated as reachable so warnings stay high-signal; hard-fail
// org links never use this list — they must return a plain 200.
const accessRestrictedStatuses = [401, 403, 405, 406, 415];

const maxConcurrentHosts = 6;    // hosts checked in parallel
const perHostDelayMs = 500;      // pause between requests to the same host
const maxAttempts = 3;           // total tries per URL (retries on 429/5xx/network errors)
const retryBackoffMs = 1000;     // backoff base: 1s, 2s, ...
const requestTimeoutMs = 15000;
const userAgent = 'allora-docs-link-checker/1.0 (+https://docs.allora.network)';

// .mdx for prose, .json for Nextra's _meta.json and the public/api manifests.
const isScannable = file => file.endsWith('.mdx') || file.endsWith('.json');

async function getAllFiles(dirPath, arrayOfFiles) {
  const files = await readdir(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  await Promise.all(files.map(async file => {
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = await getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else if (isScannable(file)) {
      arrayOfFiles.push(path.join(dirPath, file));
    }
  }));

  return arrayOfFiles.filter(f => f);
}

function cleanUrl(url) {
  // Trim punctuation that belongs to the surrounding prose/markdown, keeping
  // balanced parentheses (e.g. wikipedia.org/wiki/Focal_point_(game_theory)).
  while (url.length > 0) {
    const last = url[url.length - 1];
    if ('.,;:!?\'"'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')') {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

function shouldSkip(url) {
  if (exampleUrlAllowlist.includes(url)) {
    return 'intentional example URL';
  }
  if (/[{}$]/.test(url)) {
    return 'placeholder URL';
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return 'unparseable URL';
  }
  const nonPublic = nonPublicHostReason(parsed.hostname);
  if (nonPublic) {
    return nonPublic;
  }
  if (flakyHostAllowlist.includes(parsed.hostname)) {
    return 'allowlisted flaky host';
  }
  return null;
}

// Reject hosts that CI must never request: localhost, private/link-local IP
// ranges (which include cloud metadata services), IPv6 literals, and internal
// TLDs. This is a hostname-level guard — it does not resolve DNS, so it does
// not defend against a public name pointing at a private address; it keeps
// the checker from being pointed at internal services by a URL in a PR.
function nonPublicHostReason(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || !hostname.includes('.')) {
    return 'local/internal host';
  }
  if (/\.(local|internal|lan|home|corp)$/i.test(hostname)) {
    return 'local/internal host';
  }
  if (hostname.startsWith('[')) {
    return 'IP-literal host'; // IPv6 literal
  }
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const isPrivate =
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
    return isPrivate ? 'private-range IP host' : 'IP-literal host';
  }
  return null;
}

async function extractUrls(files) {
  // Map of url -> array of files referencing it.
  const urlMap = {};
  const urlRegex = /https?:\/\/[^\s"'`<>\\\[\]*]+/g;

  await Promise.all(files.map(async file => {
    const content = await readFile(file, 'utf8');
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
      const url = cleanUrl(match[0]);
      if (!url || url === 'http://' || url === 'https://') {
        continue;
      }
      if (!urlMap[url]) {
        urlMap[url] = [];
      }
      const relative = path.relative(process.cwd(), file);
      if (!urlMap[url].includes(relative)) {
        urlMap[url].push(relative);
      }
    }
  }));

  return urlMap;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const maxRedirectHops = 5;

async function requestStatus(url, method) {
  // Follow redirects manually so every hop's destination is validated against
  // the non-public-host guard before it is requested.
  let current = url;
  for (let hop = 0; hop <= maxRedirectHops; hop++) {
    const response = await fetch(current, {
      method,
      redirect: 'manual',
      headers: { 'User-Agent': userAgent, 'Accept': '*/*' },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    // Discard any body; only the final status matters.
    if (response.body) {
      try {
        await response.body.cancel();
      } catch (error) {
        // Ignore: some bodies are already consumed or locked.
      }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return response.status;
      }
      const next = new URL(location, current);
      if (!/^https?:$/.test(next.protocol) || nonPublicHostReason(next.hostname)) {
        throw new Error(`redirect to non-public destination blocked: ${next.href}`);
      }
      current = next.href;
      continue;
    }
    return response.status;
  }
  throw new Error(`too many redirects (>${maxRedirectHops})`);
}

async function checkUrl(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let status = await requestStatus(url, 'HEAD');
      if (status >= 400) {
        // Some hosts reject HEAD (405/403/...); retry the same attempt as GET.
        status = await requestStatus(url, 'GET');
      }
      if ((status === 429 || status >= 500) && attempt < maxAttempts) {
        await sleep(retryBackoffMs * attempt);
        continue;
      }
      return { status };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(retryBackoffMs * attempt);
      }
    }
  }
  return { status: 0, error: lastError ? (lastError.cause ? String(lastError.cause) : String(lastError)) : 'unknown error' };
}

async function checkAllUrls(urlMap) {
  const skipped = [];
  const byHost = {};

  for (const url of Object.keys(urlMap).sort()) {
    const skipReason = shouldSkip(url);
    if (skipReason) {
      skipped.push({ url, reason: skipReason });
      continue;
    }
    const host = new URL(url).hostname;
    if (!byHost[host]) {
      byHost[host] = [];
    }
    byHost[host].push(url);
  }

  const failures = [];
  const warnings = [];
  let passed = 0;

  // Small global concurrency across hosts; strictly sequential per host with a
  // delay between requests, so no single host is hammered.
  const hostQueue = Object.keys(byHost);
  async function hostWorker() {
    while (hostQueue.length > 0) {
      const host = hostQueue.shift();
      for (const url of byHost[host]) {
        const { status, error } = await checkUrl(url);
        const isHardFail = hardFailPattern.test(url);
        const ok = isHardFail
          ? status === 200
          : (status >= 200 && status < 400) || accessRestrictedStatuses.includes(status);
        if (ok) {
          passed++;
        } else {
          const detail = { url, status, error, files: urlMap[url] };
          if (isHardFail) {
            failures.push(detail);
            console.log(`DEAD (org repo): ${url} -> ${status || error}`);
          } else {
            warnings.push(detail);
            console.log(`warn: ${url} -> ${status || error}`);
          }
        }
        await sleep(perHostDelayMs);
      }
    }
  }

  await Promise.all(Array.from({ length: maxConcurrentHosts }, () => hostWorker()));

  return { failures, warnings, skipped, passed };
}

(async () => {
  try {
    const files = await getAllFiles(directoryPath);
    const scanned = [directoryPath];
    for (const extra of extraDirectoryPaths) {
      files.push(...await getAllFiles(extra, []));
      scanned.push(extra);
    }
    const urlMap = await extractUrls(files);
    const totalUrls = Object.keys(urlMap).length;
    console.log(`Scanned ${files.length} files under ${scanned.join(', ')}; found ${totalUrls} unique external URLs.`);

    const { failures, warnings, skipped, passed } = await checkAllUrls(urlMap);

    console.log('');
    console.log('Summary:');
    console.log(`  checked: ${passed + failures.length + warnings.length}`);
    console.log(`  passed:  ${passed}`);
    console.log(`  skipped: ${skipped.length} (placeholders, local hosts, allowlisted)`);
    console.log(`  warned:  ${warnings.length}`);
    console.log(`  failed:  ${failures.length}`);

    if (warnings.length > 0) {
      console.log('');
      console.log('Warnings (non-org domains, not fatal):');
      warnings.forEach(({ url, status, error, files: refs }) => {
        console.log(`  ${url} -> ${status || error}`);
        refs.forEach(ref => console.log(`    referenced in ${ref}`));
      });
    }

    if (failures.length > 0) {
      console.log('');
      console.log('Dead github.com/allora-network links (fatal — private or deleted repos count as dead):');
      failures.forEach(({ url, status, error, files: refs }) => {
        console.log(`  ${url} -> ${status || error}`);
        refs.forEach(ref => console.log(`    referenced in ${ref}`));
      });
      throw new Error('Dead allora-network GitHub links found');
    }
  } catch (error) {
    console.error('An error occurred:', error);
    process.exitCode = 1;
  }
})();
