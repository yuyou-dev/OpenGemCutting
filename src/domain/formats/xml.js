import { FORMAT_LIMITS, fail } from "./shared.js";

/* A bounded, non-validating reader for the XML subset Gem Cut Studio writes.
 * No DTD, external or custom entities, network access or evaluation; attribute
 * maps have no prototype, so names such as __proto__ remain plain data. */

const NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function allowedCodePoint(code) {
  return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff)
    || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

export function unescapeXml(text, line) {
  return text.replace(/&([^;\s]*);|&/g, (whole, entity) => {
    if (entity && Object.hasOwn(NAMED, entity)) return NAMED[entity];
    if (entity && /^#(?:\d{1,7}|x[\da-f]{1,6})$/i.test(entity)) {
      const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (allowedCodePoint(code)) return String.fromCodePoint(code);
    }
    return fail("XML_ENTITY", "文件含未定义实体或非法字符引用。", line);
  });
}

export function escapeXml(value) {
  return String(value).replace(/[&<>"'\r\n\t]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;", "\r": "&#13;", "\n": "&#10;", "\t": "&#9;",
  }[char]));
}

export function parseXml(text) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) fail("XML_CONTROL", "文件含非法控制字符。");
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) fail("XML_DTD_FORBIDDEN", "出于安全原因，不读取带 DTD 或自定义实体的文件。");
  let position = 0;
  let line = 1;
  let nodes = 0;
  let root = null;
  const stack = [];
  const advance = (end) => {
    for (let cursor = position; cursor < end; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
    position = end;
  };

  while (position < text.length) {
    if (text[position] !== "<") {
      const next = text.indexOf("<", position);
      const end = next < 0 ? text.length : next;
      const value = unescapeXml(text.slice(position, end), line);
      if (stack.length) {
        if (value.trim()) stack.at(-1).text = (stack.at(-1).text ?? "") + value;
      } else if (value.trim()) {
        fail("XML_OUTSIDE_ROOT", "根节点之外存在文本。", line);
      }
      advance(end);
      continue;
    }
    if (text.startsWith("<!--", position)) {
      const end = text.indexOf("-->", position + 4);
      if (end < 0 || text.slice(position + 4, end).includes("--")) fail("XML_COMMENT", "XML 注释未闭合或非法。", line);
      advance(end + 3);
      continue;
    }
    if (text.startsWith("<?", position)) {
      const end = text.indexOf("?>", position + 2);
      if (end < 0) fail("XML_PI", "XML 声明未闭合。", line);
      advance(end + 2);
      continue;
    }
    if (text.startsWith("<![CDATA[", position)) {
      const end = text.indexOf("]]>", position + 9);
      if (end < 0 || !stack.length) fail("XML_CDATA", "CDATA 位置错误或未闭合。", line);
      stack.at(-1).text = (stack.at(-1).text ?? "") + text.slice(position + 9, end);
      advance(end + 3);
      continue;
    }

    let end = position + 1;
    let quote = null;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (quote) { if (char === quote) quote = null; } else if (char === "\"" || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === text.length) fail("XML_TAG", "XML 标签未闭合。", line);
    const body = text.slice(position + 1, end);
    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      if (!stack.length || stack.at(-1).name !== name) fail("XML_MISMATCH", `XML 闭合标签不匹配：${name.slice(0, 40)}`, line);
      stack.pop();
      advance(end + 1);
      continue;
    }
    const selfClosing = /\/\s*$/.test(body);
    const inside = selfClosing ? body.replace(/\/\s*$/, "") : body;
    const nameMatch = inside.match(/^([A-Za-z_][\w.:-]*)/);
    if (!nameMatch) fail("XML_TAG", "非法 XML 标签。", line);
    const node = { name: nameMatch[1], attrs: Object.create(null), children: [], line };
    let cursor = nameMatch[0].length;
    let attributeCount = 0;
    while (cursor < inside.length) {
      const rest = inside.slice(cursor);
      if (!rest.trim()) break;
      const match = rest.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\2/);
      if (!match || match[3].includes("<")) fail("XML_ATTRIBUTE", "XML 属性缺少引号、分隔或含非法字符。", line);
      if (Object.hasOwn(node.attrs, match[1])) fail("XML_DUPLICATE_ATTRIBUTE", `重复属性 ${match[1]}。`, line);
      attributeCount += 1;
      if (attributeCount > FORMAT_LIMITS.xmlAttributes) fail("XML_ATTRIBUTE_BUDGET", "节点属性过多。", line);
      node.attrs[match[1]] = unescapeXml(match[3].replace(/[\r\n\t]/g, " "), line);
      cursor += match[0].length;
    }
    nodes += 1;
    if (nodes > FORMAT_LIMITS.xmlNodes) fail("XML_NODE_BUDGET", "XML 节点数量超出限制。");
    if (stack.length) stack.at(-1).children.push(node);
    else if (root) fail("XML_MULTIPLE_ROOTS", "只能有一个 XML 根节点。", line);
    else root = node;
    if (!selfClosing) {
      stack.push(node);
      if (stack.length > FORMAT_LIMITS.xmlDepth) fail("XML_DEPTH_BUDGET", `XML 嵌套深度超过 ${FORMAT_LIMITS.xmlDepth}。`, line);
    }
    advance(end + 1);
  }
  if (stack.length || !root) fail("XML_INCOMPLETE", "XML 为空或未完整闭合。");
  return root;
}

export function writeXml(node, indent = "") {
  const attributes = Object.entries(node.attrs ?? {}).map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join("");
  if (!node.children?.length && !node.text) return `${indent}<${node.name}${attributes}/>`;
  const children = node.children?.length
    ? `\n${node.children.map((child) => writeXml(child, `${indent}  `)).join("\n")}\n${indent}`
    : "";
  return `${indent}<${node.name}${attributes}>${node.text ? escapeXml(node.text) : ""}${children}</${node.name}>`;
}
