#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const force = process.argv.includes('--force');
const nonInteractive = process.argv.includes('--non-interactive');

function readEnv() {
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
    if (match) values[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

function updateEnv(values) {
  const lines = existsSync(envPath)
    ? readFileSync(envPath, 'utf8').split(/\r?\n/)
    : [];
  const keys = Object.keys(values);
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=/);
    if (!match || !keys.includes(match[1].trim())) return line;
    const key = match[1].trim();
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  if (next.length > 0 && next[next.length - 1] === '') next.pop();
  for (const key of keys) {
    if (!seen.has(key)) next.push(`${key}=${values[key]}`);
  }
  writeFileSync(envPath, `${next.join('\n')}\n`, 'utf8');
}

async function readSecret(label) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let value = '';
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', (chunk) => {
        value = String(chunk).split(/\r?\n/)[0];
        resolve(value);
      });
      process.stdin.resume();
    });
  }

  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (chunk) => {
      // Remove cursor keys / bracketed-paste markers so pasting a key works.
      const clean = String(chunk).replace(
        /\x1b\[[0-9;?]*[ -/]*[@-~]/g,
        '',
      );
      for (const character of clean) {
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          const error = new Error('用户取消');
          error.code = 'CANCELLED';
          reject(error);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (character === '\u001b') continue;
        value += character;
        process.stdout.write('*');
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

async function main() {
  const env = readEnv();
  const existing = (env.AI_API_KEY || process.env.AI_API_KEY || '').trim();
  if (existing && !force) {
    console.log('[api] 已检测到服务器 AI_API_KEY，跳过命令行配置。');
    console.log('[api] 如需更换，运行 npm run configure:api -- --force');
    return;
  }
  if (nonInteractive || !process.stdin.isTTY) {
    console.warn(
      '[api] 当前不是交互式终端，跳过 API 配置。首次打开网页时会要求填写 API Key。',
    );
    return;
  }

  console.log('\n首次部署：配置 DeepSeek API\n');
  console.log('Key 会写入项目根目录 .env（该文件已被 .gitignore 忽略）。');
  console.log('如果使用自定义网关，也可以稍后在网页设置中修改。\n');

  let apiKey = '';
  try {
    apiKey = (await readSecret('DeepSeek API Key: ')).trim();
  } catch (error) {
    if (error?.code === 'CANCELLED') process.exit(130);
    throw error;
  }
  if (!apiKey) {
    console.warn('[api] 未输入 Key，跳过。首次打开网页时会要求配置。');
    return;
  }
  if (!/^sk-[A-Za-z0-9_-]{8,}$/.test(apiKey) && !/^[A-Za-z0-9._-]{12,}$/.test(apiKey)) {
    console.warn('[api] Key 格式看起来不常见，仍继续保存。');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const baseAnswer = await rl.question(
      'API Base URL [https://api.deepseek.com]: ',
    );
    const modelAnswer = await rl.question('模型 [deepseek-chat]: ');
    const baseUrl =
      normalizeUrl(baseAnswer) ?? 'https://api.deepseek.com';
    const model = modelAnswer.trim() || 'deepseek-chat';
    updateEnv({
      AI_PROVIDER: 'deepseek',
      AI_API_KEY: apiKey,
      AI_BASE_URL: baseUrl,
      AI_MODEL: model,
    });
    console.log(`\n[api] 已写入 .env：${baseUrl} / ${model}\n`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`[api] 配置失败：${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
