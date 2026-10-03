import { spawn, ChildProcess } from "child_process";

interface PoolEntry {
  process: ChildProcess;
  lastUsed: number;
  initialized: boolean;
  buffer: string;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>;
}

const pool = new Map<number, PoolEntry>();
const TTL = 5 * 60 * 1000; // 5 минут idle
let globalRequestIdCounter = 1;

function safeKillProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  try {
    child.kill(signal);
    // Fallback на жесткий SIGKILL через 2 секунды, если процесс завис
    setTimeout(() => {
      try {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
      } catch {}
    }, 2000).unref();
  } catch {}
}

// Периодическая очистка неактивных процессов
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [catId, entry] of pool.entries()) {
    if (now - entry.lastUsed > TTL) {
      console.log(`[MCP Pool] Terminating idle process for category ${catId} (PID: ${entry.process.pid})`);
      safeKillProcess(entry.process, 'SIGTERM');
      pool.delete(catId);
    }
  }
}, 60_000);

cleanupInterval.unref();

export function cleanupAllPoolProcesses() {
  for (const [catId, entry] of pool.entries()) {
    try {
      console.log(`[MCP Pool] Cleaning up process for category ${catId} (PID: ${entry.process.pid})`);
      safeKillProcess(entry.process, 'SIGTERM');
    } catch {}
  }
  pool.clear();
}

function spawnAndInit(
  catId: number,
  command: string,
  args: string[],
  env: any
): Promise<PoolEntry> {
  return new Promise((resolve, reject) => {
    const finalArgs = [...args];
    if ((command === "bunx" || command === "npx") && !finalArgs.includes("-y")) {
      finalArgs.unshift("-y");
    }

    const finalEnv = {
      ...process.env,
      ...(typeof env === "string" ? JSON.parse(env) : env),
    };

    const child = spawn(command, finalArgs, {
      env: finalEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const entry: PoolEntry = {
      process: child,
      lastUsed: Date.now(),
      initialized: false,
      buffer: "",
      pending: new Map(),
    };

    const initId = ++globalRequestIdCounter;
    let initDone = false;

    const initTimeout = setTimeout(() => {
      safeKillProcess(child, 'SIGKILL');
      pool.delete(catId);
      reject(new Error(`[MCP Pool] Initialization timeout (60s) for category ${catId}`));
    }, 60_000);

    child.on("error", (err) => {
      clearTimeout(initTimeout);
      pool.delete(catId);
      reject(new Error(`[MCP Pool] Spawn Error for category ${catId}: ${err.message}`));
    });

    child.stderr.on("data", (data) => {
      console.log(`[MCP Pool STDERR cat=${catId}]: ${data.toString().trim()}`);
    });

    child.stdout.on("data", (data) => {
      entry.buffer += data.toString();
      const lines = entry.buffer.split("\n");
      entry.buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg: any;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }

        // Ответ на initialize handshake
        if (!initDone && msg.id === initId) {
          initDone = true;
          clearTimeout(initTimeout);

          child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n"
          );

          entry.initialized = true;
          pool.set(catId, entry);
          resolve(entry);
          continue;
        }

        // Ответы на запросы из очереди
        if (msg.id !== undefined && entry.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = entry.pending.get(msg.id)!;
          entry.pending.delete(msg.id);
          if (msg.error) {
            rej(new Error(`MCP Error: ${JSON.stringify(msg.error)}`));
          } else {
            res(msg);
          }
        }
      }
    });

    child.on("close", (code) => {
      console.log(`[MCP Pool] Process for category ${catId} closed (code ${code})`);
      for (const { reject: rej } of entry.pending.values()) {
        rej(new Error(`MCP process died with exit code ${code}`));
      }
      entry.pending.clear();
      pool.delete(catId);

      if (!initDone) {
        clearTimeout(initTimeout);
        reject(new Error(`MCP process closed before init completed (code ${code})`));
      }
    });

    // Handshake
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: initId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "tool-hub", version: "1.5.0" },
        },
      }) + "\n"
    );
  });
}

export async function callMcpPooled(
  catId: number,
  command: string,
  args: string[],
  env: any,
  request: any
): Promise<any> {
  let entry = pool.get(catId);
  if (!entry || entry.process.exitCode !== null) {
    entry = await spawnAndInit(catId, command, args, env);
  }

  entry.lastUsed = Date.now();
  const requestId = ++globalRequestIdCounter;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      entry!.pending.delete(requestId);
      reject(new Error(`[MCP Pool] Request timeout (60s)`));
    }, 60_000);

    entry!.pending.set(requestId, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });

    entry!.process.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: requestId, ...request }) + "\n"
    );
  });
}

export function killMcpProcess(catId: number) {
  const entry = pool.get(catId);
  if (entry) {
    safeKillProcess(entry.process, 'SIGTERM');
    pool.delete(catId);
    console.log(`[MCP Pool] Manually killed process for category ${catId}`);
  }
}

export function getPoolStatus() {
  const status: any[] = [];
  for (const [catId, entry] of pool.entries()) {
    status.push({
      catId,
      pid: entry.process.pid,
      idleSec: Math.round((Date.now() - entry.lastUsed) / 1000),
      pendingRequests: entry.pending.size,
    });
  }
  return status;
}