import { spawn } from 'node:child_process';
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
const hasProxy = Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
const args = [];

if (hasProxy && nodeMajor >= 24) {
  args.push('--use-env-proxy');
} else if (hasProxy) {
  console.warn(
    '[start] 检测到代理配置，但当前 Node.js 不支持 --use-env-proxy；请使用 Node.js 24+，或改用可直连的模型网关。',
  );
}
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
