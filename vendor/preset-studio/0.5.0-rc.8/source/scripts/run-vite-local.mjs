import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const hasExplicitPort = args.some((arg, index) => arg === "--port" || arg.startsWith("--port=") || args[index - 1] === "--port");

function reserveEphemeralPort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

const viteArgs = [...args];
if (!hasExplicitPort) {
  viteArgs.push("--port", String(await reserveEphemeralPort()), "--strictPort");
}

const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteBin, ...viteArgs], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
