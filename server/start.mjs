import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

try {
  // Load proxy and AI settings before spawning Node so --use-env-proxy sees them.
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env is optional.
}

const nodeMajor = Number(process.versions.node.split('.')[0]) || 0;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const proxyConfigured = Boolean(proxyUrl);
const PROXY_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
];
const originalProxyEnv = Object.fromEntries(
  PROXY_KEYS.map((key) => [key, process.env[key]]),
);

// A proxy configured for the model gateway should not be able to break paper
// imports. Keep academic hosts direct, and let users add more via env.
const PAPER_NO_PROXY = [
  'localhost',
  '127.0.0.1',
  '::1',
  'arxiv.org',
  '.arxiv.org',
  'export.arxiv.org',
  'openreview.net',
  '.openreview.net',
  'aclanthology.org',
  '.aclanthology.org',
  'proceedings.mlr.press',
  '.mlr.press',
  'papers.nips.cc',
  'neurips.cc',
  '.neurips.cc',
  'openaccess.thecvf.com',
  '.thecvf.com',
  'ieeexplore.ieee.org',
  '.ieee.org',
  'link.springer.com',
  '.springer.com',
  'sciencedirect.com',
  '.sciencedirect.com',
  'nature.com',
  '.nature.com',
  'dl.acm.org',
  '.acm.org',
  'usenix.org',
  '.usenix.org',
];
const configuredNoProxy = (process.env.NO_PROXY || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const extraNoProxy = (process.env.HAILA_NO_PROXY || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const noProxyList = [
  ...new Set([...configuredNoProxy, ...PAPER_NO_PROXY, ...extraNoProxy]),
].join(',');

function probeLocalProxy(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return Promise.resolve(false);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    // Do not delay startup or block on a remote proxy that may reject TCP probes.
    return Promise.resolve(true);
  }
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function applyProxyMode(enabled) {
  if (enabled) {
    for (const key of PROXY_KEYS) {
      const value = originalProxyEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.HAILA_PROXY_DISABLED;
    process.env.NO_PROXY = noProxyList;
    process.env.no_proxy = noProxyList;
    process.env.HAILA_EFFECTIVE_NO_PROXY = noProxyList;
    return;
  }

  // Python's OpenAI client (pdf2zh) honors these variables directly, unlike
  // Node's opt-in --use-env-proxy flag. Remove them so translation also falls
  // back to a direct connection instead of failing on a dead local proxy.
  // server/index.mjs reloads .env, so the flag is checked there as well.
  for (const key of PROXY_KEYS) delete process.env[key];
  process.env.HAILA_PROXY_DISABLED = '1';
  // Python/httpx can also read the Windows registry proxy via
  // urllib.request.getproxies(); NO_PROXY=* disables both sources.
  process.env.NO_PROXY = '*';
  process.env.no_proxy = '*';
  process.env.HAILA_EFFECTIVE_NO_PROXY = '*';
}

let proxyEnabled = false;
if (proxyConfigured && nodeMajor >= 24) {
  proxyEnabled = await probeLocalProxy(proxyUrl);
} else if (proxyConfigured) {
  console.warn(
    '[start] 检测到代理配置，但当前 Node.js 不支持 --use-env-proxy；请使用 Node.js 24+，或改用可直连的模型网关。',
  );
}
applyProxyMode(proxyEnabled);
console.log(
  `[start] 代理：${proxyEnabled ? '已启用' : '直连'}；学术站点始终绕过代理。`,
);
if (proxyConfigured && !proxyEnabled && nodeMajor >= 24) {
  console.warn(
    `[start] 本地代理 ${proxyUrl} 不可连接，已自动改用直连；论文导入和 PDF 翻译不受影响。`,
  );
}

let child = null;
let restarting = false;
let shuttingDown = false;

function childArgs() {
  return proxyEnabled
    ? ['--use-env-proxy', 'server/index.mjs']
    : ['server/index.mjs'];
}

function launchChild() {
  child = spawn(process.execPath, childArgs(), {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error('[start] 无法启动服务：', error.message);
    if (!restarting && !shuttingDown) process.exit(1);
  });

  child.on('exit', (code, signal) => {
    child = null;
    if (restarting || shuttingDown) return;
    process.exit(code ?? (signal ? 1 : 0));
  });
}

function terminateChild() {
  const target = child;
  if (!target || target.exitCode !== null) {
    child = null;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      child = null;
      resolve();
    };
    target.once('exit', finish);
    if (process.platform === 'win32') {
      // Kill the Haila process tree as well. The managed pdf2zh Python service
      // inherits proxy settings at spawn time, so it must restart with Haila
      // when proxy availability changes.
      const killer = spawn(
        'taskkill',
        ['/pid', String(target.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.once('error', () => {
        try {
          target.kill();
        } catch {
          // The process may already be gone.
        }
      });
      killer.once('exit', () => setTimeout(finish, 120));
    } else {
      try {
        target.kill('SIGTERM');
      } catch {
        finish();
      }
    }
    setTimeout(finish, 4000).unref();
  });
}

async function restartForProxy(nextEnabled) {
  if (restarting || shuttingDown) return;
  restarting = true;
  console.warn(
    `[start] 代理状态变化：${proxyEnabled ? '可用' : '不可用'} → ${nextEnabled ? '可用' : '不可用'}，重启服务以恢复模型连接`,
  );
  try {
    await terminateChild();
    proxyEnabled = nextEnabled;
    applyProxyMode(proxyEnabled);
    launchChild();
  } finally {
    restarting = false;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void terminateChild().finally(() => process.exit(0));
  });
}

launchChild();

// A local proxy is often started after the browser or laptop. Poll it and
// respawn Haila (and its pdf2zh child) when the state changes, so chat and
// translation recover without asking the user to restart manually.
if (proxyConfigured && nodeMajor >= 24) {
  let observed = proxyEnabled;
  let mismatch = 0;
  setInterval(async () => {
    if (restarting || shuttingDown) return;
    const next = await probeLocalProxy(proxyUrl);
    if (next === observed) {
      mismatch = 0;
      return;
    }
    mismatch += 1;
    if (mismatch < 2) return;
    mismatch = 0;
    observed = next;
    await restartForProxy(next);
  }, 4000);
}
