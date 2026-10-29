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
  console.log(`[upgrade] ${message}`);
}

function run(command, args) {
  log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
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

function capture(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: false,
  });
}

try {
  const probe = capture('git', ['rev-parse', '--is-inside-work-tree']);
  if (probe.status !== 0 || probe.stdout.trim() !== 'true') {
    throw new Error('当前目录不是 Git 仓库，无法升级；请用 git clone 获取项目。');
  }

  const status = capture('git', ['status', '--porcelain', '--untracked-files=no']);
  if (status.status !== 0) throw new Error('无法读取 Git 工作区状态');
  if (status.stdout.trim()) {
    throw new Error(
      '检测到未提交的修改。请先 commit 或 stash，再运行 npm run upgrade，避免升级覆盖本地改动。',
    );
  }

  log('拉取最新代码');
  run('git', ['fetch', '--prune', 'origin']);
  run('git', ['pull', '--ff-only']);

  log('更新前端 / 服务端依赖');
  runNpm(['install']);

  log('同步独立 pdf2zh 运行时');
  run(process.execPath, [setupScript]);

  log('重新构建海拉');
  runNpm(['run', 'build']);

  log('升级完成。请停止当前 npm start 进程后重新运行：npm start');
  log('浏览器文库、模型配置和 DeepSeek API Key 不受影响。');
} catch (error) {
  console.error(
    `[upgrade] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
