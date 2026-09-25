import test from "node:test";
import assert from "node:assert/strict";
import { parseXml, writeXml } from "./xml.js";

const attacks = [
  ["DTD", "<!DOCTYPE GemCutStudio><GemCutStudio/>", "XML_DTD_FORBIDDEN"],
  ["external entity", "<!DOCTYPE g [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><g>&x;</g>", "XML_DTD_FORBIDDEN"],
  ["undefined entity", "<a x=\"&evil;\"/>", "XML_ENTITY"],
  ["bare ampersand", "<a x=\"one & two\"/>", "XML_ENTITY"],
  ["NUL character reference", "<a x=\"&#0;\"/>", "XML_ENTITY"],
  ["surrogate reference", "<a x=\"&#xD800;\"/>", "XML_ENTITY"],
  ["out-of-range reference", "<a x=\"&#x110000;\"/>", "XML_ENTITY"],
  ["duplicate attribute", "<a x=\"1\" x=\"2\"/>", "XML_DUPLICATE_ATTRIBUTE"],
  ["mismatched tags", "<a><b></a>", "XML_MISMATCH"],
  ["multiple roots", "<a/><b/>", "XML_MULTIPLE_ROOTS"],
  ["unterminated tag", "<a x=\"1>", "XML_TAG"],
  ["unquoted attribute", "<a x=1/>", "XML_ATTRIBUTE"],
  ["double hyphen in comment", "<a><!-- x--y --></a>", "XML_COMMENT"],
  ["control character", "<a x=\"\u0001\"/>", "XML_CONTROL"],
  ["nesting depth", `${"<a>".repeat(65)}${"</a>".repeat(65)}`, "XML_DEPTH_BUDGET"],
  ["attribute count", `<a ${Array.from({ length: 65 }, (_, index) => `x${index}="0"`).join(" ")}/>`, "XML_ATTRIBUTE_BUDGET"],
  ["CDATA outside the root", "<![CDATA[a]]><a/>", "XML_CDATA"],
  ["text outside the root", "hello<a/>", "XML_OUTSIDE_ROOT"],
  ["empty document", "", "XML_INCOMPLETE"],
];

for (const [name, text, code] of attacks) {
  test(`bounded XML rejects ${name}`, () => assert.throws(() => parseXml(text), { code }));
}

test("attribute names are plain data and cannot reach object prototypes", () => {
  const node = parseXml("<a __proto__=\"no\" constructor=\"data\"/>");
  assert.equal(Object.getPrototypeOf(node.attrs), null);
  assert.equal(node.attrs.__proto__, "no");
  assert.equal({}.polluted, undefined);
});

test("escaped markup survives a write and read without becoming markup", () => {
  const text = writeXml({ name: "tier", attrs: { name: "<img src=x onerror=alert(1)>", note: "a & b\n\"c\"" }, children: [] });
  const node = parseXml(text);
  assert.equal(node.attrs.name, "<img src=x onerror=alert(1)>");
  assert.equal(node.attrs.note, "a & b\n\"c\"");
  assert.equal(node.children.length, 0);
});
