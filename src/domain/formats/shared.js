/** Bounded reading shared by every foreign design format. Files are data: no
 * format may evaluate, fetch or expand anything it reads. */
export const FORMAT_LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024,
  tiers: 4096,
  facets: 4096,
  xmlNodes: 250000,
  xmlDepth: 64,
  xmlAttributes: 64,
  polygonVertices: 4096,
  totalVertices: 150000,
  coordinate: 1e9,
});

export class FormatError extends Error {
  constructor(code, message, line) {
    super(message);
    this.name = "FormatError";
    this.code = code;
    if (line) this.line = line;
  }
}

export function fail(code, message, line) {
  throw new FormatError(code, message, line);
}

export function diagnostic(severity, code, message, line) {
  return { severity, code, message, ...(line ? { line } : {}) };
}

export function diagnosticFromError(error) {
  if (error instanceof FormatError) return diagnostic("error", error.code, error.message, error.line);
  return diagnostic("error", "UNREADABLE_FILE", `文件无法读取：${error?.message ?? error}`);
}

export function statusFor(diagnostics) {
  if (diagnostics.some((item) => item.severity === "error")) return "error";
  if (diagnostics.some((item) => item.severity === "warning")) return "warning";
  return "ready";
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Strict decimal text: no hex, NaN, Infinity, blanks or unbounded exponents. */
export function readNumber(value, label, { min = -FORMAT_LIMITS.coordinate, max = FORMAT_LIMITS.coordinate, line } = {}) {
  const text = String(value ?? "").trim().replaceAll("−", "-");
  if (text.length > 64 || !NUMBER.test(text)) fail("INVALID_NUMBER", `${label}“${String(value ?? "").slice(0, 40)}”不是有效数字。`, line);
  const number = Number(text);
  if (!Number.isFinite(number) || number < min || number > max) fail("NUMBER_RANGE", `${label}超出允许范围 ${min}–${max}。`, line);
  return number;
}

export function readInteger(value, label, options) {
  const number = readNumber(value, label, options);
  if (!Number.isSafeInteger(number)) fail("INVALID_INTEGER", `${label}必须是整数。`, options?.line);
  return number;
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) fail("NONFINITE_OUTPUT", "禁止写出非有限数字。");
  if (Math.abs(value) < 1e-14) return "0";
  const text = String(Number(value.toPrecision(15)));
  return /e/i.test(text) ? value.toFixed(15).replace(/\.?0+$/, "") : text;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  fail("INPUT_TYPE", "输入必须是文件内容。");
}

/**
 * Decode text without silently replacing characters. A byte-order mark or XML
 * declaration wins; otherwise UTF-8, then the Windows code page old GemCad
 * installations wrote (every byte decodes, so the fallback is reported).
 */
export function decodeText(input) {
  if (typeof input === "string") {
    if (input.length > FORMAT_LIMITS.bytes) fail("FILE_TOO_LARGE", "文件超过 20 MB。");
    return { text: input.replace(/^﻿/, ""), encoding: "utf-8", diagnostics: [] };
  }
  const bytes = toBytes(input);
  if (bytes.byteLength > FORMAT_LIMITS.bytes) fail("FILE_TOO_LARGE", "文件超过 20 MB。");
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
  let declared = null;
  if (!bom) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 256));
    declared = head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  }
  const encoding = bom ?? declared ?? "utf-8";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^﻿/, "");
    return { text, encoding: encoding.toLowerCase(), diagnostics: [] };
  } catch (error) {
    if (bom || (declared && !/^utf-?8$/i.test(declared))) fail("ENCODING_UNREADABLE", `文件声明为 ${encoding} 编码，但内容无法按该编码读取。`);
    const text = new TextDecoder("windows-1252").decode(bytes);
    return {
      text,
      encoding: "windows-1252",
      diagnostics: [diagnostic("warning", "LEGACY_ENCODING", "文件不是 UTF-8，已按旧版 Windows 西文编码读取；请核对标题与说明中的特殊字符。")],
    };
  }
}

function looksBinary(bytes) {
  const sample = bytes.subarray(0, 512);
  let control = 0;
  for (const byte of sample) if (byte === 0 || (byte < 9) || (byte > 13 && byte < 32)) control += 1;
  return control > 0;
}

const EXTENSIONS = { json: "json", asc: "asc", gem: "gem", gcs: "gcs" };

/** Identify by content, never by the extension alone. */
export function detectFormat(input, fileName = "") {
  const extension = EXTENSIONS[String(fileName).split(".").pop()?.toLowerCase()] ?? null;
  const bytes = typeof input === "string" ? null : toBytes(input);
  if (bytes && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff) && looksBinary(bytes)) {
    return { format: "gem", extension };
  }
  const head = (typeof input === "string" ? input.slice(0, 2048) : decodeText(bytes.subarray(0, 2048)).text)
    .replace(/^﻿/, "").trimStart();
  if (head.startsWith("{")) return { format: "json", extension };
  if (/^GemCad\s/i.test(head)) return { format: "asc", extension };
  if (/^<(?:\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<GemCutStudio[\s>]/.test(head) || (head.startsWith("<") && head.includes("<GemCutStudio"))) {
    return { format: "gcs", extension };
  }
  return { format: extension === "asc" || extension === "gcs" ? extension : null, extension };
}
