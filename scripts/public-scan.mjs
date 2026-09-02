import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const excluded = new Set([".git", "node_modules", "dist", "tmp", "output"]);
const patterns = [
  ["personal macOS path", new RegExp("/Us" + "ers/[^/\\s]+/")],
  ["personal Linux path", new RegExp("/ho" + "me/[^/\\s]+/")],
  ["personal Windows path", new RegExp("[A-Za-z]:\\\\Us" + "ers\\\\[^\\\\\\s]+\\\\")],
  ["non-public email address", new RegExp("[A-Za-z0-9._%+-]+" + "@(?!users\\.noreply\\.github\\.com)[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")],
  ["private key", new RegExp("-----BEGIN [A-Z ]+PRIVATE " + "KEY-----")],
  ["OpenAI-style secret", new RegExp("sk-" + "[A-Za-z0-9_-]{20,}")],
  ["GitHub token", new RegExp("gh[pousr]_" + "[A-Za-z0-9]{20,}")],
  ["Google API key", new RegExp("AIza" + "[A-Za-z0-9_-]{30,}")],
  ["bearer credential", new RegExp("Bearer\\s+" + "[A-Za-z0-9._~-]{16,}", "i")],
  ["internal schema host", new RegExp("schemas\\." + "openai\\.local", "i")],
  ["internal browser host", new RegExp("terminal\\." + "local", "i")],
  ["private source repository", new RegExp("facet-96-" + "editor", "i")],
  ["unresolved repository placeholder", new RegExp("<repository" + "-url>", "i")],
  ["private IPv4 address", new RegExp("(?:^|[^0-9.])(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})(?:$|[^0-9.])", "m")],
  ["wildcard service binding", new RegExp("0\\.0\\.0\\.0")],
];

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

const findings = [];
let scanned = 0;
for (const file of await collect(root)) {
  if (file.endsWith("scripts/public-scan.mjs")) continue;
  if ((await stat(file)).size > 2_000_000) continue;
  const buffer = await readFile(file);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");
  scanned += 1;
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${path.relative(root, file)}: ${label}`);
  }
}

if (findings.length) {
  console.error(`Public scan found ${findings.length} issue(s):\n${findings.join("\n")}`);
  process.exit(1);
}

console.log(`Public scan OK: ${scanned} text files clean`);
