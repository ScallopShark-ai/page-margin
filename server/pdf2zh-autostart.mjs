import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = Number(process.env.PDF2ZH_PORT) || 8891;
const serviceLogPath = path.join(root, '.runtime', 'pdf2zh-service.log');
const autoStart = !['0', 'false', 'no', 'off'].includes(
  String(process.env.PDF2ZH_AUTOSTART ?? '1').trim().toLowerCase(),
);
const healthUrl = `http://127.0.0.1:${port}/health`;

let child = null;
let starting = null;
let ownedByHaila = false;
let lastLines = [];
let logStream = null;

function appendLog(chunk) {
  const text = String(chunk).replace(/\r/g, '');
  logStream?.write(text);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    lastLines.push(line);
    if (lastLines.length > 60) lastLines.shift();
    // The upstream server prints a progress bar continuously; keep the Haila
    // console readable and preserve full output in .runtime/pdf2zh-service.log.
    if (
      /traceback|exception|error|failed|失败|错误|server将启动|running on|服务已就绪/i.test(
        line,
      )
    ) {
      console.log(`[pdf2zh] ${line.trim()}`);
    }
  }
}

async function isHealthy(timeoutMs = 1200) {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

function candidates() {
  const values = [];
  if (process.env.PDF2ZH_HOME) values.push(process.env.PDF2ZH_HOME);
  values.push(
    path.join(root, '.runtime', 'zotero-pdf2zh', 'server'),
    path.join(root, 'tools', 'zotero-pdf2zh', 'server'),
    path.join(root, '..', 'zotero-pdf2zh', 'server'),
  );
  return values.map((value) => path.resolve(value));
}

function findServerDir() {
  for (const dir of candidates()) {
    if (existsSync(path.join(dir, 'server.py'))) return dir;
  }
  return null;
}

function findPython() {
  if (process.env.PDF2ZH_PYTHON) {
    return path.resolve(process.env.PDF2ZH_PYTHON);
  }
  const candidates = [
    path.join(root, '.runtime', 'pdf2zh-venv', 'Scripts', 'python.exe'),
    path.join(root, '.runtime', 'pdf2zh-venv', 'bin', 'python'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isolatedCacheEnv() {
  const cacheRoot = path.join(root, '.runtime', 'pdf2zh-cache');
  const dirs = {
    HF_HOME: path.join(cacheRoot, 'huggingface'),
    MODELSCOPE_CACHE: path.join(cacheRoot, 'modelscope'),
    XDG_CACHE_HOME: path.join(cacheRoot, 'xdg'),
    TORCH_HOME: path.join(cacheRoot, 'torch'),
  };
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

async function waitUntilHealthy(deadline) {
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    if (child && child.exitCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

async function start() {
  if (!autoStart) {
    console.log('[pdf2zh] 自启动已关闭（PDF2ZH_AUTOSTART=0）');
    return;
  }
  if (await isHealthy()) {
    console.log(`[pdf2zh] 服务已在 127.0.0.1:${port} 运行，跳过自启动`);
    return;
  }
  const serverDir = findServerDir();
  const python = findPython();
  if (!serverDir || !python) {
    console.warn(
      '[pdf2zh] 未找到本地 pdf2zh 服务，跳过自启动。' +
        '需要 .runtime/zotero-pdf2zh/server/server.py 和 .runtime/pdf2zh-venv。',
    );
    return;
  }

  const cacheEnv = isolatedCacheEnv();
  const env = {
    ...process.env,
    ...cacheEnv,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PATH: `${path.dirname(python)}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  const args = [
    'server.py',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--enable_venv',
    'false',
    '--check_update',
    'false',
  ];
  mkdirSync(path.dirname(serviceLogPath), { recursive: true });
  try {
    logStream?.end();
    logStream = createWriteStream(serviceLogPath, { flags: 'w' });
  } catch {
    logStream = null;
  }
  console.log(`[pdf2zh] 启动本地服务：${serverDir} (127.0.0.1:${port})`);
  console.log(`[pdf2zh] 完整日志：${serviceLogPath}`);
  child = spawn(python, args, {
    cwd: serverDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedByHaila = true;
  lastLines = [];
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);
  child.on('error', (error) => {
    console.error('[pdf2zh] 启动失败：', error.message);
  });
  child.on('exit', (code, signal) => {
    if (ownedByHaila && code !== 0 && code !== null) {
      console.error(
        `[pdf2zh] 服务退出（code=${code}${signal ? `, signal=${signal}` : ''}）`,
      );
      if (lastLines.length > 0) {
        console.error('[pdf2zh] 最后输出：');
        for (const line of lastLines.slice(-12)) console.error(`  ${line}`);
      }
    }
    child = null;
    ownedByHaila = false;
  });

  const ready = await waitUntilHealthy(Date.now() + 60_000);
  if (ready) {
    console.log(`[pdf2zh] 服务已就绪：http://127.0.0.1:${port}`);
    return;
  }
  console.error(
    `[pdf2zh] 服务启动后 60 秒内未就绪，请查看上方日志或手动打开 http://127.0.0.1:${port}`,
  );
}

export function startPdf2zhService() {
  if (!starting) {
    starting = start().catch((error) => {
      console.error('[pdf2zh] 自启动异常：', error);
    });
  }
  return starting;
}

export function stopPdf2zhService() {
  if (child && ownedByHaila) {
    try {
      child.kill();
    } catch {
      // The process may already have exited.
    }
  }
  child = null;
  ownedByHaila = false;
  logStream?.end();
  logStream = null;
}

process.once('exit', stopPdf2zhService);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopPdf2zhService();
    process.exit(0);
  });
}
