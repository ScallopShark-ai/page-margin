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
let hasProxy = Boolean(proxyUrl);
const args = [];

// A proxy configured for the model gateway should not be able to break paper
// imports. Keep academic hosts direct, and let users add more via env.
const PAPER_NO_PROXY = [
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
process.env.NO_PROXY = [
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

if (hasProxy && nodeMajor >= 24) {
  const reachable = await probeLocalProxy(proxyUrl);
  if (reachable) {
    args.push('--use-env-proxy');
  } else {
    hasProxy = false;
    console.warn(
      `[start] 本地代理 ${proxyUrl} 不可连接，已自动改用直连；论文导入不受影响。`,
    );
  }
} else if (hasProxy) {
  console.warn(
    '[start] 检测到代理配置，但当前 Node.js 不支持 --use-env-proxy；请使用 Node.js 24+，或改用可直连的模型网关。',
  );
}
console.log(
  `[start] 代理：${hasProxy ? '已启用' : '直连'}；学术站点始终绕过代理。`,
);
args.push('server/index.mjs');

const child = spawn(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
    const forceExit = setTimeout(() => process.exit(0), 800);
    forceExit.unref();
  });
}

child.on('error', (error) => {
  console.error('[start] 无法启动服务：', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
