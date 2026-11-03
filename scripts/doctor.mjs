#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonMode = process.argv.includes('--json');
const checks = [];

function add(name, status, detail) {
  checks.push({ name, status, detail });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    ...options,
  });
}

function commandWorks(command, args = ['--version']) {
  const result = run(command, args, {
    stdio: 'ignore',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
  return !result.error && result.status === 0;
}

function readEnv() {
  const values = {};
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return { values, exists: false };
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return { values, exists: true };
}

function testTcp(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function proxyEndpoint(env) {
  const raw = env.HTTPS_PROXY || env.HTTP_PROXY || '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return null;
    return {
      host,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    };
  } catch {
    return null;
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
add(
  'Node.js',
  nodeMajor >= 22 ? 'ok' : 'fail',
  `${process.versions.node}${nodeMajor < 24 ? '（Node 24+ 才支持内置代理）' : ''}`,
);

const npmWorks = process.env.npm_execpath
  ? commandWorks(process.execPath, [process.env.npm_execpath, '--version'])
  : process.platform === 'win32'
    ? (() => {
        const result = spawnSync(
          process.env.ComSpec || 'cmd.exe',
          ['/d', '/s', '/c', 'npm --version'],
          { cwd: root, stdio: 'ignore', shell: false },
        );
        return !result.error && result.status === 0;
      })()
    : commandWorks('npm', ['--version']);
add('npm', npmWorks ? 'ok' : 'fail', npmWorks ? '可用' : '未找到 npm');

const gitWorks = commandWorks('git', ['--version']);
add('Git', gitWorks ? 'ok' : 'warn', gitWorks ? '可用' : '未找到 Git，无法一键升级');

const uvWorks = commandWorks('uv', ['--version']);
const pyWorks = commandWorks(
  process.platform === 'win32' ? 'py' : 'python3',
  process.platform === 'win32' ? ['-3.12', '--version'] : ['--version'],
);
add(
  'Python / uv',
  uvWorks || pyWorks ? 'ok' : 'warn',
  uvWorks ? 'uv 可用' : pyWorks ? 'Python 3.12 可用' : '缺少 uv 或 Python 3.12，pdf2zh 安装会跳过',
);

try {
  const stat = statfsSync(root);
  const freeMb = Math.round((stat.bavail * stat.bsize) / (1024 * 1024));
  add(
    '磁盘空间',
    freeMb >= 900 ? 'ok' : freeMb >= 300 ? 'warn' : 'fail',
    `剩余约 ${freeMb} MB${freeMb < 900 ? '，建议至少预留 900 MB' : ''}`,
  );
} catch {
  add('磁盘空间', 'warn', '无法读取磁盘剩余空间');
}

const envFile = readEnv();
add(
  '.env',
  envFile.exists ? 'ok' : 'warn',
  envFile.exists ? '已存在' : '尚未创建，代理或服务器 Key 可写入 .env',
);
add(
  '服务器 AI Key',
  envFile.values.AI_API_KEY || process.env.AI_API_KEY ? 'ok' : 'warn',
  envFile.values.AI_API_KEY || process.env.AI_API_KEY
    ? `已配置（${envFile.values.AI_PROVIDER || process.env.AI_PROVIDER || 'deepseek'}）`
    : '未配置，首次打开网页时会要求配置',
);

const proxy = proxyEndpoint(envFile.values);
if (proxy) {
  const reachable = await testTcp(proxy.host, proxy.port);
  add(
    '模型代理',
    reachable ? 'ok' : 'warn',
    `${proxy.host}:${proxy.port} ${reachable ? '可连接' : '暂不可用，启动时会自动切换直连'}`,
  );
} else {
  add('模型代理', 'ok', '未配置本地代理，使用直连');
}

const venvPython =
  process.platform === 'win32'
    ? path.join(root, '.runtime', 'pdf2zh-venv', 'Scripts', 'python.exe')
    : path.join(root, '.runtime', 'pdf2zh-venv', 'bin', 'python');
if (!existsSync(venvPython)) {
  add('pdf2zh 运行时', 'warn', '未安装；PDF 全文翻译不可用，可稍后运行 npm run setup:pdf2zh');
} else {
  const imported = run(venvPython, [
    '-c',
    "import pdf2zh_next, bitstring; print('ok')",
  ]);
  add(
    'pdf2zh 运行时',
    imported.status === 0 ? 'ok' : 'warn',
    imported.status === 0
      ? 'Python 环境可导入 pdf2zh_next'
      : '环境存在但导入失败，建议运行 npm run setup:pdf2zh',
  );
}

add(
  '前端构建',
  existsSync(path.join(root, 'dist', 'index.html')) ? 'ok' : 'warn',
  existsSync(path.join(root, 'dist', 'index.html'))
    ? 'dist/index.html 已存在'
    : '尚未构建，部署或 npm run build 后生成',
);

const failures = checks.filter((check) => check.status === 'fail');
const warnings = checks.filter((check) => check.status === 'warn');

if (jsonMode) {
  console.log(JSON.stringify({ checks, failures: failures.length, warnings: warnings.length }, null, 2));
} else {
  console.log('\n海拉环境检查\n');
  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '!' : '×';
    console.log(`  ${icon} ${check.name.padEnd(14)} ${check.detail}`);
  }
  console.log(
    `\n${failures.length === 0 ? '核心检查通过' : `${failures.length} 项必须修复`}${
      warnings.length > 0 ? `，${warnings.length} 项警告` : ''
    }\n`,
  );
}

process.exit(failures.length > 0 ? 1 : 0);
