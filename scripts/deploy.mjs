#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const setupScript = path.join(root, 'scripts', 'setup-pdf2zh.mjs');
const doctorScript = path.join(root, 'scripts', 'doctor.mjs');
const apiScript = path.join(root, 'scripts', 'configure-api.mjs');
const verifyScript = path.join(root, 'scripts', 'verify.mjs');
const args = new Set(process.argv.slice(2));
const skipPdf2zh = args.has('--skip-pdf2zh');
const requirePdf2zh = args.has('--require-pdf2zh');
const skipApi = args.has('--skip-api');
const forceApi = args.has('--configure-api');
const skipVerify = args.has('--skip-verify');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env is optional.
}

function log(message) {
  console.log(`[deploy] ${message}`);
}

function run(command, commandArgs, cwd = root) {
  log(`$ ${[command, ...commandArgs].join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: command.endsWith('.cmd') || command.endsWith('.bat'),
  });
  if (result.error) throw new Error(`${command} 无法执行：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} 失败，退出码 ${result.status}`);
}

function runNpm(npmArgs) {
  if (npmCli) {
    run(process.execPath, [npmCli, ...npmArgs]);
    return;
  }
  if (process.platform === 'win32') {
    run(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      `npm ${npmArgs.join(' ')}`,
    ]);
    return;
  }
  run(npm, npmArgs);
}

function hasEnvApiKey() {
  if (process.env.AI_API_KEY?.trim()) return true;
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) return false;
  return /^\s*AI_API_KEY\s*=\s*\S+/m.test(readFileSync(envPath, 'utf8'));
}

function writeStatus(status) {
  try {
    mkdirSync(path.join(root, '.runtime'), { recursive: true });
    writeFileSync(
      path.join(root, '.runtime', 'deployment-status.json'),
      `${JSON.stringify(status, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Status reporting must not fail an otherwise successful deployment.
  }
}

let pdf2zhReady = false;
let pdf2zhError = '';
let apiConfigured = false;
let verified = false;
let apiSkipped = false;

try {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    throw new Error(`需要 Node.js 22+，当前是 ${process.versions.node}`);
  }

  log('环境预检');
  try {
    run(process.execPath, [doctorScript]);
  } catch {
    throw new Error('环境预检未通过，请先修复上面的必需项');
  }

  if (skipApi) {
    apiSkipped = true;
  } else {
    log('配置首次使用的 API（如果 .env 中已有 Key 会自动跳过）');
    try {
      const apiArgs = [apiScript];
      if (forceApi) apiArgs.push('--force');
      run(process.execPath, apiArgs);
      apiConfigured = hasEnvApiKey();
      if (!apiConfigured) apiSkipped = true;
    } catch (error) {
      apiSkipped = true;
      console.warn(
        `[deploy] 命令行 API 配置未完成，首次打开网页时会要求配置：${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  log('安装前端 / 服务端依赖');
  runNpm([
    existsSync(path.join(root, 'package-lock.json')) ? 'ci' : 'install',
  ]);

  if (skipPdf2zh) {
    log('已跳过 pdf2zh；论文对话等功能仍可使用');
  } else {
    log('准备独立 pdf2zh 运行时（失败不会阻断核心部署）');
    try {
      run(process.execPath, [setupScript]);
      pdf2zhReady = true;
    } catch (error) {
      pdf2zhError = error instanceof Error ? error.message : String(error);
      if (requirePdf2zh) {
        throw new Error(`pdf2zh 安装失败（--require-pdf2zh）：${pdf2zhError}`);
      }
      console.warn(
        `[deploy] pdf2zh 未安装成功，继续部署核心功能。\n[deploy] 原因：${pdf2zhError}\n[deploy] 可稍后运行 npm run setup:pdf2zh 重试。`,
      );
    }
  }

  log('构建海拉');
  runNpm(['run', 'build']);

  if (!skipVerify) {
    log('运行安装验证');
    try {
      run(process.execPath, [verifyScript]);
      verified = true;
    } catch {
      throw new Error('安装验证失败，请查看上面的错误和日志');
    }
  } else {
    log('已跳过安装验证');
  }

  writeStatus({
    version: 2,
    createdAt: new Date().toISOString(),
    pdf2zh: pdf2zhReady,
    pdf2zhError,
    apiConfigured,
    apiSkipped,
    verified,
  });

  log('部署完成');
  log(
    `核心功能：${verified ? '验证通过' : '已构建（未验证）'}；API：${
      apiConfigured ? '已配置' : '未配置（网页兜底）'
    }；pdf2zh：${pdf2zhReady ? '可用' : skipPdf2zh ? '已跳过' : '不可用'}`,
  );
  log('启动：npm start');
  log('首次打开海拉时，如果已配置 .env 中的 AI Key，不会再弹出模型配置。');
  if (!pdf2zhReady) {
    log('PDF 全文翻译暂不可用；可稍后运行 npm run setup:pdf2zh。');
  }
} catch (error) {
  writeStatus({
    version: 2,
    createdAt: new Date().toISOString(),
    pdf2zh: pdf2zhReady,
    pdf2zhError,
    apiConfigured,
    apiSkipped,
    verified,
    failed: true,
  });
  console.error(
    `[deploy] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
