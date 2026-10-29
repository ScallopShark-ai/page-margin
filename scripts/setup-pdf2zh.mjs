#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.runtime');
const repo = path.join(runtime, 'zotero-pdf2zh');
const serverDir = path.join(repo, 'server');
const venvDir = path.join(runtime, 'pdf2zh-venv');
const pdf2zhVersion = 'v4.1.7';
const repoUrl = 'https://github.com/guaguastandup/zotero-pdf2zh.git';

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env is optional.
}

function log(message) {
  console.log(`[setup:pdf2zh] ${message}`);
}

function run(command, args, options = {}) {
  const rendered = [command, ...args].join(' ');
  log(`$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: process.env,
    stdio: 'inherit',
    shell: options.shell ?? false,
  });
  if (result.error) {
    throw new Error(`${command} 无法执行：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} 失败，退出码 ${result.status ?? 'unknown'}`);
  }
}

function capture(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: false,
  });
}

function commandWorks(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'ignore',
    shell: false,
  });
  return !result.error && result.status === 0;
}

function venvPython() {
  const candidates =
    process.platform === 'win32'
      ? [path.join(venvDir, 'Scripts', 'python.exe')]
      : [path.join(venvDir, 'bin', 'python')];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runtimeReady() {
  const python = venvPython();
  if (!python) return false;
  const result = spawnSync(
    python,
    [
      '-c',
      "import pdf2zh_next, bitstring, importlib.metadata as m; print(m.version('pdf2zh_next')); print(m.version('bitstring'))",
    ],
    { cwd: root, env: process.env, stdio: 'ignore' },
  );
  if (result.status !== 0) return false;
  const bitstring = capture(python, [
    '-c',
    "import importlib.metadata as m; print(m.version('bitstring'))",
  ]);
  if (bitstring.status !== 0) return false;
  const version = bitstring.stdout.trim().split('.').map(Number);
  return version[0] < 5;
}

function ensureClone() {
  if (existsSync(path.join(repo, '.git'))) {
    const current = capture('git', [
      '-C',
      repo,
      'describe',
      '--tags',
      '--exact-match',
    ]);
    const tag = current.status === 0 ? current.stdout.trim() : '';
    if (tag === pdf2zhVersion) {
      log(`已存在 ${path.relative(root, repo)}（${pdf2zhVersion}），跳过更新`);
      return;
    }
    log(`已存在 ${path.relative(root, repo)}，固定到 ${pdf2zhVersion}`);
    run('git', ['-C', repo, 'fetch', '--depth', '1', 'origin', 'tag', pdf2zhVersion]);
    run('git', ['-C', repo, 'checkout', '--force', pdf2zhVersion]);
    return;
  }
  mkdirSync(runtime, { recursive: true });
  log(`克隆 zotero-pdf2zh ${pdf2zhVersion}`);
  run('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    pdf2zhVersion,
    repoUrl,
    repo,
  ]);
}

function ensureVenv() {
  if (runtimeReady()) {
    log('独立 Python 环境和 pdf2zh_next 已就绪');
    return;
  }

  const uvAvailable = commandWorks('uv');
  if (!uvAvailable && !commandWorks('py', ['-3.12', '--version'])) {
    throw new Error(
      '未找到 uv 或 Python 3.12。请先安装 uv（推荐）或 Python 3.12 后重试。',
    );
  }

  if (!venvPython()) {
    if (uvAvailable) {
      run('uv', ['venv', venvDir, '--python', '3.12']);
    } else {
      run('py', ['-3.12', '-m', 'venv', venvDir]);
    }
  }

  const python = venvPython();
  if (!python) throw new Error('Python 虚拟环境创建失败');
  const requirements = path.join(serverDir, 'requirements.txt');
  if (!existsSync(requirements)) throw new Error(`缺少依赖清单：${requirements}`);

  if (uvAvailable) {
    run('uv', [
      'pip',
      'install',
      '--python',
      python,
      '-r',
      requirements,
      'pdf2zh_next>=2.9.0,<3.0.0',
      'bitstring<5',
    ]);
  } else {
    run(python, [
      '-m',
      'pip',
      'install',
      '-r',
      requirements,
      'pdf2zh_next>=2.9.0,<3.0.0',
      'bitstring<5',
    ]);
  }
  if (!runtimeReady()) {
    throw new Error('依赖安装完成，但 pdf2zh_next / bitstring<5 仍无法导入');
  }
}

function ensureConfig() {
  const configDir = path.join(serverDir, 'config');
  mkdirSync(configDir, { recursive: true });
  const tomlPath = path.join(configDir, 'config.toml');
  const examplePath = path.join(configDir, 'config.toml.example');
  if (!existsSync(tomlPath)) {
    if (!existsSync(examplePath)) throw new Error('缺少 config.toml.example');
    copyFileSync(examplePath, tomlPath);
  }
  let toml = readFileSync(tomlPath, 'utf8');
  if (/^deepseek\s*=/m.test(toml)) {
    toml = toml.replace(/^deepseek\s*=\s*false\s*$/m, 'deepseek = true');
  } else {
    toml = `deepseek = true\n${toml}`;
  }
  writeFileSync(tomlPath, toml, 'utf8');

  const jsonPath = path.join(configDir, 'config.json');
  const jsonExample = path.join(configDir, 'config.json.example');
  if (!existsSync(jsonPath) && existsSync(jsonExample)) {
    copyFileSync(jsonExample, jsonPath);
  }
  for (const dir of [
    'pdf2zh-cache',
    'pdf2zh-cache/huggingface',
    'pdf2zh-cache/modelscope',
    'pdf2zh-cache/xdg',
    'pdf2zh-cache/torch',
    'zotero-pdf2zh/server/translated',
  ]) {
    mkdirSync(path.join(runtime, dir), { recursive: true });
  }
}

function main() {
  log(`项目：${root}`);
  log('准备独立 pdf2zh 运行时（不会修改系统 conda 环境）');
  ensureClone();
  ensureVenv();
  ensureConfig();
  log('完成。启动海拉后会自动启动 8891 服务：');
  log('  npm start');
}

try {
  main();
} catch (error) {
  console.error(`[setup:pdf2zh] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
