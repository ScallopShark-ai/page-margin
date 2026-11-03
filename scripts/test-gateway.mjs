#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  child.kill('SIGTERM');
}

async function main() {
  console.log('\n模型网关连接测试\n');
  const port = await freePort();
  const server = spawn(process.execPath, ['server/start.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      PDF2ZH_AUTOSTART: '0',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderr = [];
  server.stdout?.on('data', () => undefined);
  server.stderr?.on('data', (chunk) => stderr.push(String(chunk)));

  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${origin}/api/health`, 20_000);
    const config = await fetch(`${origin}/api/config`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!config.ok) throw new Error(`/api/config HTTP ${config.status}`);
    const configBody = await config.json();
    if (!configBody.serverConfigured) {
      console.log(
        '  ! 服务器 .env 没有配置 AI_API_KEY；无法在命令行测试网关。',
      );
      console.log(
        '  请先运行 npm run configure:api，或直接在网页中配置模型。\n',
      );
      process.exitCode = 2;
      return;
    }
    console.log(
      `  网关：${configBody.provider} / ${configBody.model}\n  Base URL：${configBody.baseUrl}\n`,
    );
    const startedAt = Date.now();
    const response = await fetch(`${origin}/api/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: {} }),
      signal: AbortSignal.timeout(35_000),
    });
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        message = body.error || body.message || message;
      } catch {
        // Keep the status message.
      }
      throw new Error(message);
    }
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];
    console.log(`  模型列表：${models.length} 个，耗时 ${elapsed}s`);
    for (const model of models.slice(0, 8)) {
      console.log(`    - ${model.id || model.name || model}`);
    }
    if (models.length > 8) console.log('    …');
    console.log('\n模型网关连接测试通过\n');
  } catch (error) {
    console.error(
      `\n模型网关连接测试失败：${error instanceof Error ? error.message : error}\n`,
    );
    if (stderr.length > 0) {
      console.error('服务端输出：');
      console.error(
        stderr.join('').trim().split(/\r?\n/).slice(-12).join('\n'),
      );
    }
    process.exitCode = 1;
  } finally {
    stop(server);
  }
}

main().catch((error) => {
  console.error(
    `[gateway] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
