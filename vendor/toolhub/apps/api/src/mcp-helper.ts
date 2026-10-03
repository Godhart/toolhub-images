import { spawn, ChildProcess } from "child_process";

function safeKillProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  try {
    child.kill(signal);
    setTimeout(() => {
      try {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
      } catch {}
    }, 2000).unref();
  } catch {}
}

export async function callMcpStdio(
  command: string, 
  args: string[], 
  env: any, 
  request: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const finalArgs = [...args];
    if ((command === 'bunx' || command === 'npx') && !finalArgs.includes('-y')) {
      finalArgs.unshift('-y');
    }

    const finalEnv = { 
      ...process.env, 
      ...(typeof env === 'string' ? JSON.parse(env) : env) 
    };

    const child = spawn(command, finalArgs, {
      env: finalEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let buffer = "";
    let stderr = "";
    let initialized = false;
    const initId = 1;
    const requestId = 2;

    const timeout = setTimeout(() => {
      safeKillProcess(child, 'SIGKILL');
      reject(new Error(`MCP Timeout (60s). Stderr: ${stderr}`));
    }, 60000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`MCP Spawn Error: ${err.message}`));
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
      console.log(`[MCP STDERR]: ${data.toString().trim()}`);
    });

    child.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg: any;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (msg.id === initId && !initialized) {
          initialized = true;
          const notification = {
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {}
          };
          child.stdin.write(JSON.stringify(notification) + "\n");

          const realRequest = {
            jsonrpc: "2.0",
            id: requestId,
            ...request
          };
          child.stdin.write(JSON.stringify(realRequest) + "\n");
          continue;
        }

        if (msg.id === requestId) {
          clearTimeout(timeout);
          safeKillProcess(child, 'SIGTERM');
          
          if (msg.error) {
            reject(new Error(`MCP Error: ${JSON.stringify(msg.error)}`));
          } else {
            resolve(msg);
          }
          return;
        }
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`MCP process closed (code ${code}) without response. Stderr: ${stderr}`));
    });

    const initRequest = {
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "tool-hub", version: "1.5.0" }
      }
    };
    child.stdin.write(JSON.stringify(initRequest) + "\n");
  });
}