#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const setupScript = path.join(root, 'scripts', 'setup-pdf2zh.mjs');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env is optional.
}

function log(message) {
  console.log(`[deploy] ${message}`);
}

function run(command, args, cwd = root) {
  log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: command.endsWith('.cmd') || command.endsWith('.bat'),
  });
  if (result.error) throw new Error(`${command} 无法执行：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} 失败，退出码 ${result.status}`);
}

function runNpm(args) {
  if (npmCli) {
    run(process.execPath, [npmCli, ...args]);
    return;
  }
  run(npm, args);
}

try {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    throw new Error(`需要 Node.js 22+，当前是 ${process.versions.node}`);
  }

  log('安装前端 / 服务端依赖');
  runNpm(['install']);

  log('准备独立 pdf2zh 运行时');
  run(process.execPath, [setupScript]);

  log('构建海拉');
  runNpm(['run', 'build']);

  log('部署完成。启动：npm start');
  log('首次打开海拉时会要求配置 DeepSeek API。');
} catch (error) {
  console.error(`[deploy] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
