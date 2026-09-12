import { createTranslator } from '../src/i18n/format.js';
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { manualPages as sourcePages } from "./manual/content.mjs";
import { importFacetingJSON } from "../src/domain/faceting.js";
import { buildConstructionStages } from "../src/domain/constructionHistory.js";
const locale = process.argv.includes('--locale=en') ? 'en' : 'zh-CN';
const t = createTranslator(locale);
const localize = (value) => Array.isArray(value) ? value.map(localize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item)])) : t(value);
const manualPages = localize(sourcePages);
const suffix = locale === 'en' ? '-en' : '';
const screenshots = locale === 'en' ? 'docs/manual/screenshots/en' : 'docs/manual/screenshots';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  root,
  `public/manual/facet-96-operation-manual${suffix}.pdf`,
);
const htmlPath = path.join(
  root,
  `tmp/pdfs/manual-v2/facet-96-operation-manual${suffix}.html`,
);
const { version } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(path.join(root, "docs/manual/examples/manifest.json"), "utf8"),
);
for (const item of manifest.examples) {
  const doc = importFacetingJSON(
    await readFile(path.join(root, "docs/manual/examples", item.file), "utf8"),
  );
  const stages = buildConstructionStages(doc);
  if (
    stages.at(-1).afterSolid.faces.length !== item.faces ||
    (stages.at(-1).construction?.status ?? null) !== item.constructionStatus
  )
    throw Error(`Manual example differs from manifest: ${item.file}`);
}
const names = new Set(
  manualPages
    .flatMap((p) => [p.hero, p.image, ...(p.pair ?? []).map((x) => x[0])])
    .filter(Boolean),
);
await Promise.all(
  [...names].map((name) =>
    access(path.join(root, screenshots, `${name}.jpg`)),
  ),
);
const asset = (relative) => pathToFileURL(path.join(root, relative)).href;
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const image = (name, caption = "") =>
  `<figure><img src="${asset(`${screenshots}/${name}.jpg`)}" alt="${esc(caption)}">${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
const renderPage = (page, index) => {
  const classes = [
    "page",
    index === 0 ? "cover" : "",
    !page.image && !page.pair && !page.hero ? "no-image text-only" : "",
    page.image?.includes("controls") ? "controls" : "",
    page.compactImage ? "compact-image" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const brand = `<img src="${asset("public/brand/logo-header.webp")}"><span><b>${t("切磨工作台")}</b><small>${esc(version)} · SUVA / FACET 96</small></span>`;
  const heading =
    index === 0
      ? `<div class="cover-brand">${brand}</div>`
      : `<header class="chrome head"><span><img src="${asset("public/brand/logo-header.webp")}"><b>${t("切磨工作台")}</b><em>${esc(version)} · SUVA / FACET 96</em></span><span>${t("设计师操作手册")}</span></header>`;
  const illustration =
    page.hero || page.image
      ? image(page.hero || page.image, page.caption)
      : page.pair
        ? `<div class="pair">${page.pair.map(([name, caption]) => image(name, caption)).join("")}</div><p class="caption">${esc(page.caption)}</p>`
        : "";
  const contents = page.toc
    ?.map(
      ([title, number, detail]) => `
    <article><span>${number}</span><div><h3>${title}</h3><p>${detail}</p></div></article>
  `,
    )
    .join("");
  const blocks = page.blocks
    ?.map(
      ([title, detail]) => `
    <div class="block"><h3>${title}</h3><p>${detail}</p></div>
  `,
    )
    .join("");
  const steps = page.steps
    ?.map(
      ([title, detail], stepIndex) => `
    <div class="step"><b>${stepIndex + 1}</b><div><h3>${title}</h3><p>${detail}</p></div></div>
  `,
    )
    .join("");
  return `
    <section class="${classes}">
      ${heading}
      <main class="body">
        <div class="kicker">${esc(page.kicker)}</div>
        <h1>${index === 0 ? (locale === "en" ? "From an idea<br>to a gem of your own" : "从一个想法<br>到一颗自己的宝石") : esc(page.title)}</h1>
        <p class="intro">${esc(page.intro)}</p>
        ${illustration}
        ${contents ? `<div class="toc">${contents}</div>` : ""}
        ${blocks ? `<div class="blocks">${blocks}</div>` : ""}
        ${steps ? `<div class="steps">${steps}</div>` : ""}
        ${page.question ? `<aside class="question"><b>${locale === "en" ? "Pause and make a design judgment" : "停下来，作一个设计判断"}</b>${page.question}</aside>` : ""}
        ${page.note ? `<aside class="note"><b>${locale === "en" ? "Before you continue" : "继续操作前请知道"}</b>${page.note}</aside>` : ""}
      </main>
      <footer class="chrome foot"><span>v${version} · ${locale === "en" ? "Learning edition · 7 JSON exercises + 1 rough OBJ" : "教学版 · 配套 7 份 JSON + 1 份原晶 OBJ"}</span><span><b>${String(index + 1).padStart(2, "0")}</b> / ${manualPages.length}</span></footer>
    </section>
  `;
};
const html = `<!doctype html>
<html lang="${locale}"><head>
  <meta charset="utf-8">
  <title>${t("切磨工作台")} · ${t("设计师操作手册")} v${version}</title>
  <link rel="stylesheet" href="${asset("node_modules/@fontsource-variable/noto-sans-sc/index.css")}">
  <style>${await readFile(path.join(root, "scripts/manual/manual.css"), "utf8")}</style>
</head><body>${manualPages.map(renderPage).join("")}</body></html>`;

await mkdir(path.dirname(htmlPath), { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(htmlPath, html);
let browserPath;
for (const candidate of [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean)) {
  try {
    await access(candidate);
    browserPath = candidate;
    break;
  } catch {}
}
if (!browserPath)
  throw Error(
    "Chrome or Chromium is required to build the operation manual PDF.",
  );
await promisify(execFile)(
  browserPath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--allow-file-access-from-files",
    "--no-pdf-header-footer",
    `--print-to-pdf=${outputPath}`,
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=4000",
    pathToFileURL(htmlPath).href,
  ],
  { maxBuffer: 4 * 1024 * 1024 },
);
console.log(
  `Generated ${path.relative(root, outputPath)} (${manualPages.length} pages). HTML: ${path.relative(root, htmlPath)}`,
);
