#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];

function pass(name, detail) {
  console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
}

function warn(name, detail) {
  warnings.push(`${name}：${detail}`);
  console.log(`  ! ${name}：${detail}`);
}

function fail(name, detail) {
  failures.push(`${name}：${detail}`);
  console.log(`  × ${name}：${detail}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(lastError || '超时');
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function main() {
  console.log('\n海拉安装验证\n');
  if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    fail('前端构建', '缺少 dist/index.html，请先运行 npm run build');
  }

  const port = await freePort();
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      PDF2ZH_AUTOSTART: '0',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr?.on('data', (chunk) => stderr.push(String(chunk)));

  const origin = `http://127.0.0.1:${port}`;
  try {
    const health = await waitFor(`${origin}/api/health`, 20_000);
    const healthBody = await health.json();
    pass('Haila HTTP', `/api/health ${health.status}`);

    const config = await fetch(`${origin}/api/config`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!config.ok) throw new Error(`/api/config HTTP ${config.status}`);
    const configBody = await config.json();
    if (configBody.serverConfigured) {
      pass('服务器 AI 配置', `${configBody.provider} / ${configBody.model}`);
    } else {
      warn('服务器 AI 配置', '未在 .env 配置 AI Key，首次打开网页需要配置');
    }

    const home = await fetch(origin, { signal: AbortSignal.timeout(3000) });
    const html = await home.text();
    if (
      home.ok &&
      /<div id="root"/.test(html) &&
      /<title>海拉/.test(html)
    ) {
      pass('前端页面', 'index.html 可访问');
    } else {
      fail('前端页面', `HTTP ${home.status}，页面内容不符合预期`);
    }

    const assetPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    if (assetPath) {
      const asset = await fetch(new URL(assetPath, origin), {
        signal: AbortSignal.timeout(3000),
      });
      if (asset.ok) pass('静态资源', assetPath);
      else fail('静态资源', `${assetPath} HTTP ${asset.status}`);
    } else {
      warn('静态资源', '没有找到入口脚本，页面可能未正确构建');
    }

    const images = await fetch(`${origin}/api/images`, {
      signal: AbortSignal.timeout(2000),
    });
    if (images.ok) pass('图片存储接口', '可访问');
    else warn('图片存储接口', `HTTP ${images.status}`);

    try {
      const pdf2zhHealth = await fetch('http://127.0.0.1:8891/health', {
        signal: AbortSignal.timeout(1800),
      });
      if (pdf2zhHealth.ok) pass('pdf2zh 服务', '127.0.0.1:8891 可访问');
      else warn('pdf2zh 服务', `HTTP ${pdf2zhHealth.status}`);
    } catch {
      warn(
        'pdf2zh 服务',
        '当前未启动；PDF 全文翻译不可用，可运行 npm start 或 npm run setup:pdf2zh',
      );
    }
  } catch (error) {
    fail(
      'Haila HTTP',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await stop(child);
  }

  if (failures.length > 0 && stderr.length > 0) {
    console.log('\n服务端最后输出：');
    console.log(stderr.join('').trim().split(/\r?\n/).slice(-12).join('\n'));
  }

  console.log(
    `\n${failures.length === 0 ? '安装验证通过' : '安装验证失败'}${
      warnings.length > 0 ? `，${warnings.length} 项警告` : ''
    }\n`,
  );
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`[verify] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
