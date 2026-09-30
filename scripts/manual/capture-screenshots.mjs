// Recaptures the designer manual screenshots from the running workbench.
//
// Usage:
//   npm run dev   (prints http://127.0.0.1:<port>/)
//   node scripts/manual/capture-screenshots.mjs <url> [--locale=zh-CN|en] [--only=name1,name2]
//
// Requires `npm i --no-save puppeteer-core` and a system Google Chrome. The repository
// keeps no browser automation dependency in package.json. Each image uses a fresh
// browser profile; WebGL runs headless through SwiftShader. Images are written to
// docs/manual/screenshots/ (zh-CN) or docs/manual/screenshots/en/ (en). Scenes and
// framing follow docs/manual/README.md; never edit geometry or paint over a capture.
import puppeteer from "puppeteer-core";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [url, ...flags] = process.argv.slice(2);
if (!url || !/^https?:\/\//.test(url)) throw new Error("Usage: node scripts/manual/capture-screenshots.mjs <url> [--locale=zh-CN|en] [--only=a,b]");
const flag = (name) => flags.find((item) => item.startsWith(`--${name}=`))?.split("=")[1];
const locale = flag("locale") === "en" ? "en" : "zh-CN";
const only = flag("only")?.split(",").filter(Boolean);
const outDir = path.join(root, "docs/manual/screenshots", locale === "en" ? "en" : "");
const zh = locale !== "en";

const EXAMPLES = path.join(root, "docs/manual/examples");
const HIGHLIGHT = "Eight Main Highlight";
const DESKTOP = { width: 1600, height: 1000 };

const run = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One session = one fresh browser profile, one page and the helpers used by every scene.
async function openSession(viewport) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "facet96-manual-"));
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    userDataDir: profile,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-unsafe-webgpu", "--hide-scrollbars"],
  });
  const page = (await browser.pages())[0];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate((value) => { localStorage.clear(); localStorage.setItem("facet96.language", value); }, locale);
  await page.reload({ waitUntil: "networkidle0" });
  const s = createHelpers(page);
  s.errors = errors;
  s.close = async () => { await browser.close(); await rm(profile, { recursive: true, force: true }); };
  return s;
}

function createHelpers(page) {
  const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, { polling: 100, timeout }, arg);
  // Click the first visible element whose trimmed text matches; fails loudly when missing.
  const click = async (pattern, selector = "button") => {
    const found = await page.evaluate((source, sel) => {
      const re = new RegExp(source);
      const el = [...document.querySelectorAll(sel)].find((item) => re.test(item.textContent.trim()) && item.getClientRects().length);
      el?.click();
      return Boolean(el);
    }, pattern.source, selector);
    if (!found) throw new Error(`No ${selector} matching ${pattern}`);
    await wait(300);
  };
  // React-controlled number fields: set through the native setter, then commit on change/blur.
  const setNumber = async (label, value) => {
    const ok = await page.evaluate((name, next) => {
      const input = document.querySelector(`input[aria-label="${name}"]`);
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return true;
    }, label, value);
    if (!ok) throw new Error(`No input labelled ${label}`);
    await wait(400);
  };
  const setSelect = async (selector, value) => {
    await page.select(selector, String(value));
    await wait(400);
  };
  const L = (zhText, enText) => (zh ? zhText : enText);
  const helpers = {
    page, until, click, setNumber, setSelect, L, wait,
    async home() {
      await until(() => document.querySelectorAll(".project-card-open").length >= 2);
      await wait(800);
    },
    async openNewProject() {
      await helpers.home();
      await page.click(".home-create-card");
      await until(() => document.querySelector(".stock-start-panel"));
      await wait(800);
    },
    // Home -> New project -> Default start, optional wheel and outline, then create.
    async newDefaultProject({ gear } = {}) {
      await helpers.openNewProject();
      if (gear) await setSelect(".project-gear select", gear);
      await page.click(".stock-start-panel .modal-actions .primary-action");
      await helpers.workbench();
    },
    async workbench() {
      await until(() => document.querySelector(".toolbar-file-menu") && !document.querySelector(".modal-panel, [role=dialog]"));
      await helpers.settle();
    },
    // Let geometry, previews and the transient toast finish before shooting.
    async settle(ms = 1500) {
      await wait(ms);
      await until(() => !document.querySelector(".toast"), undefined, 15000).catch(() => {});
      await wait(300);
    },
    async openPresetBrowser(query = HIGHLIGHT) {
      await helpers.openNewProject();
      await page.evaluate(() => [...document.querySelectorAll(".stock-start-modes button")][1].click());
      await until(() => document.querySelector(".preset-library-panel .preset-search input"));
      await page.type(".preset-search input", query);
      await until(() => document.querySelectorAll(".preset-list [role=option]").length === 1);
      await wait(1500);
    },
    async openHighlight() {
      await helpers.openPresetBrowser();
      await click(/^(以此琢型新建项目|Create a project from this cut)$/, ".preset-library-panel button");
      await helpers.workbench();
      await until(() => [...document.querySelectorAll("input")].some((input) => /Eight Main/.test(input.value)));
      await helpers.settle(2500);
    },
    // Starter project -> File -> Import JSON. Import creates a separate project.
    async importExample(file) {
      await helpers.home();
      await page.click(".project-card-open");
      await helpers.workbench();
      const input = await page.$('input[type=file][accept="application/json,.json"]');
      await input.uploadFile(path.isAbsolute(file) ? file : path.join(EXAMPLES, file));
      await wait(1500);
      await helpers.settle(2500);
    },
    async openFileMenu() {
      await page.evaluate(() => { document.querySelector(".toolbar-file-menu").open = true; });
      await wait(500);
    },
    // CUT STACK row "Edit" button by layer code (C1, C2 ...); names stay as authored.
    async stackEdit(code) {
      const ok = await page.evaluate((layer) => {
        const button = [...document.querySelectorAll(".cut-stack-edit-button")].find((item) => new RegExp(`\\s${layer}\\s`).test(`${item.getAttribute("aria-label")} `));
        button?.click();
        return Boolean(button);
      }, code);
      if (!ok) throw new Error(`No edit button for ${code}`);
      await helpers.settle(1500);
    },
    async setView(pattern) {
      await page.evaluate(() => { document.querySelector(".toolbar-view-menu").open = true; });
      await click(pattern, ".toolbar-view-menu button");
      await page.evaluate(() => document.querySelectorAll("details[open]").forEach((item) => { item.open = false; }));
      await helpers.settle(1200);
    },
    // 1080 x 1080 detail of the whole stone at 2x: a square centred on the 3D canvas.
    async shootDetail(name) {
      const clip = await page.evaluate(() => {
        const canvas = [...document.querySelectorAll("canvas")].map((item) => item.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return { x: canvas.left + canvas.width / 2 - 270, y: canvas.top + canvas.height / 2 - 270, width: 540, height: 540 };
      });
      return helpers.shoot(name, { clip });
    },
    // Concave -> Add concave -> arc groove (the default five-fold groove on a 120 wheel).
    async addArcGroove() {
      await click(/^(凹切|Concave)$/);
      await until(() => document.querySelector(".concave-tool-choices button"));
      await (await page.$$(".concave-tool-choices button"))[1].click();
      await until(() => document.querySelector(".concave-parameters"));
      await helpers.settle(2500);
    },
    // Default 96 start -> Girdle -> Add girdle layer -> Ring cut (fan, L3 x 3 by default).
    async startRingCut() {
      await helpers.newDefaultProject();
      await click(/^G\s*(腰部|Girdle)$/);
      await page.click(".cut-stack-new-row");
      await wait(600);
      await click(/^(环切|Ring cut)$/, ".pattern-mode button");
      await wait(600);
    },
    // Optical simulation: quartz, soft studio / mist, exposure 0 (the view defaults).
    async openOptics(view) {
      await helpers.openHighlight();
      await click(/^(光学仿真|Optical simulation)$/);
      await until(() => document.querySelector(".optics-inspector select"));
      await setSelect(".optics-inspector select", "quartz");
      if (view) await click(view, ".optics-view-switch button");
      // Progressive ray tracing: give the renderer time to converge.
      await wait(12000);
    },
    async openAssistant(position) {
      await helpers.openHighlight();
      await click(/^(切割助手|Cutting assistant)$/);
      await until(() => document.querySelector(".assistant-player input[type=range]"));
      await wait(1500);
      await helpers.setNumber(helpers.L("切割进度", "Cutting progress"), position);
      await wait(4000);
    },
    async showRingComposer() {
      await page.evaluate(() => document.querySelector(".composer-ring")?.scrollIntoView({ block: "end" }));
      await helpers.settle(1500);
    },
    async shoot(name, options = {}) {
      await mkdir(outDir, { recursive: true });
      const file = path.join(outDir, `${name}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 88, ...options });
      return file;
    },
  };
  return helpers;
}

// ---------------------------------------------------------------------------
// Scenes. Each entry: viewport (CSS px + density) and a function that shoots.

const scenes = {
  "home-projects": {
    async run(s) {
      await s.home();
      await s.wait(1500);
      await s.shoot("home-projects");
    },
  },

  "new-project-start": {
    async run(s) {
      await s.openNewProject();
      await s.click(/^(正方形 · 四次对称|Square · 4-fold)$/, ".stock-start-outline button");
      await s.wait(1200);
      await s.shoot("new-project-start");
    },
  },

  "stock-presets": {
    async run(s) {
      await s.openNewProject();
      await s.page.evaluate(() => [...document.querySelectorAll(".stock-start-modes button")][2].click());
      await s.until(() => document.querySelectorAll(".stock-preset-card").length === 4);
      await s.page.evaluate(() => [...document.querySelectorAll(".stock-preset-card")][3].click());
      await s.wait(2500);
      await s.shoot("stock-presets");
    },
  },

  "02-preset-library": {
    async run(s) {
      await s.openPresetBrowser();
      await s.shoot("02-preset-library");
    },
  },

  "crystal-import": {
    viewport: { width: 1440, height: 1000 },
    async run(s) {
      await s.home();
      await s.page.click(".project-card-open");
      await s.workbench();
      await s.openFileMenu();
      await s.click(/^(从底胚新建项目…|New project from blank…)$/, ".toolbar-file-menu button");
      await s.until(() => document.querySelector(".crystal-import-panel"));
      await s.setSelect(".crystal-import-panel .project-gear select", 120);
      const input = await s.page.$('.crystal-import-panel input[type=file]');
      await input.uploadFile(path.join(EXAMPLES, "08-concave-crystal.obj"));
      await s.until(() => document.querySelector(".crystal-import-summary"));
      await s.wait(2500);
      await s.shoot("crystal-import");
    },
  },

  "recovery-empty": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      await s.openHighlight();
      await s.openFileMenu();
      await s.click(/^(恢复本地设计|Recover local design)$/, ".toolbar-file-menu button");
      await s.until(() => document.querySelector("[role=dialog]"));
      await s.wait(1500);
      await s.shoot("recovery-empty");
    },
  },

  "round-files": {
    async run(s) {
      await s.openHighlight();
      await s.openFileMenu();
      await s.shoot("round-files");
    },
  },

  "parameter-groups": {
    async run(s) {
      await s.newDefaultProject({ gear: 120 });
      await s.addArcGroove();
      await s.openFileMenu();
      await s.shoot("parameter-groups");
    },
  },

  "concave-tools": {
    async run(s) {
      await s.newDefaultProject({ gear: 120 });
      await s.addArcGroove();
      await s.shoot("concave-tools");
    },
  },

  "multi-index": {
    viewport: { width: 1375, height: 908 },
    async run(s) {
      await s.newDefaultProject({ gear: 120 });
      await s.shoot("multi-index");
    },
  },

  // Crop of the "choose destination" step at 2x so the PDF stays readable.
  "format-center": {
    viewport: { width: 1600, height: 1400, deviceScaleFactor: 2 },
    async run(s) {
      await s.home();
      await s.click(/^(格式中心|Format center)$/);
      await s.until(() => document.querySelector(".formats-drop input"));
      const input = await s.page.$(".formats-drop input");
      await input.uploadFile(path.join(root, "src/domain/formats/fixtures/gcs-1.1-resaved.gcs"));
      await s.until(() => document.querySelectorAll(".formats-target").length >= 3);
      await (await s.page.$$(".formats-target"))[1].click();
      await s.wait(800);
      // From the step heading to just below the export action (1184 px wide, 2x density).
      const clip = await s.page.evaluate(() => {
        const layout = document.querySelector(".lab-layout");
        const section = document.querySelectorAll(".formats-step")[1];
        layout.scrollTo(0, section.getBoundingClientRect().top + layout.scrollTop - 80);
        const top = section.getBoundingClientRect();
        const actions = document.querySelector(".formats-detail-actions").getBoundingClientRect();
        return { x: top.left - 12, y: top.top - 1, width: top.width + 24, height: actions.bottom - top.top + 12 };
      });
      await s.wait(400);
      await s.shoot("format-center", { clip });
    },
  },

  // Eight Main Highlight, C1 edited with a slightly shallower depth: the side previews follow.
  "highlight-workspace": {
    async run(s) {
      await s.openHighlight();
      await s.stackEdit("C1");
      await s.setNumber(s.L("切入深度数值", "Cut depth value"), 0.785);
      await s.settle(1500);
      await s.shoot("highlight-workspace");
    },
  },

  "round-optics": {
    viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
    async run(s) {
      await s.openOptics();
      await s.shoot("round-optics");
    },
  },

  "round-optics-top": {
    viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
    async run(s) {
      await s.openOptics(/^(台面|Table)$/);
      await s.shoot("round-optics-top");
    },
  },

  "assistant-stepping": {
    async run(s) {
      await s.openAssistant(86);
      await s.shoot("assistant-stepping");
    },
  },

  "assistant-finished": {
    async run(s) {
      await s.openAssistant(97);
      await s.shoot("assistant-finished");
    },
  },

  // Lab -> bring in the current design (Eight Main Highlight) -> pattern design module.
  "optical-lab": {
    viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
    async run(s) {
      await s.openHighlight();
      await s.click(/^(实验室|Lab)$/);
      await s.until(() => document.querySelector(".labs-primary"));
      await s.wait(1000);
      await s.page.click(".labs-primary");
      await s.wait(12000);
      // Select one crown main facet so the surface console shows its state.
      await s.page.evaluate(() => [...document.querySelectorAll("input[type=checkbox]")].filter((item) => item.getClientRects().length)[3]?.click());
      await s.wait(3000);
      await s.shoot("optical-lab");
    },
  },

  // Design review page from `npm run design:review` for Eight Main Highlight. The reference is
  // the preset's own technical top view, rasterised to 660 x 660 (as in the original study).
  "design-review": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      const work = path.join(root, "tmp/manual-design-review");
      const out = path.join(work, "study");
      await rm(work, { recursive: true, force: true });
      await mkdir(work, { recursive: true });
      const svg = await readFile(path.join(root, "public/presets/previews/94504-pc-01-338-eight-main-highlight-top.svg"), "utf8");
      const reference = await s.page.browser().newPage();
      await reference.setViewport({ width: 880, height: 660 });
      const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
      await reference.setContent(`<body style="margin:0;background:#fff"><img src="${image}" style="display:block;width:880px;height:660px"></body>`, { waitUntil: "load" });
      await reference.screenshot({ path: path.join(work, "reference.png"), clip: { x: 110, y: 0, width: 660, height: 660 } });
      await reference.close();
      await writeFile(path.join(work, "views.json"), JSON.stringify({ width: 660, height: 660, views: { top: { x: 0, y: 0, width: 660, height: 660 } } }));
      await writeFile(path.join(work, "notes.txt"), "界面演示：Eight Main Highlight（PC 01.338），设计者 Long, R H & Steele, N W。参考图来自预设的真实技术顶视，右图由同一预设 JSON 生成。本页演示对照与交付流程，不作为照片还原精度证据。来源：Facet Design v5 (1984) pC12；预设库保留原作者与来源链接。");
      await run(process.execPath, ["scripts/create-design-review.mjs", "public/presets/documents/94504-pc-01-338-eight-main-highlight.json",
        "--out", out, "--reference", path.join(work, "reference.png"), "--views", path.join(work, "views.json"), "--notes", path.join(work, "notes.txt")], { cwd: root });
      await s.page.goto(`${url}?review=${encodeURIComponent(path.relative(root, path.join(out, "review.json")))}`, { waitUntil: "networkidle0" });
      await s.until(() => document.querySelector(".review-comparison svg"));
      await s.wait(1500);
      await s.shoot("design-review");
    },
  },

  // Optional MCP bridge: needs `npm run build` and `npm ci --prefix mcp`. The stdio server
  // hosts the built workbench on its own loopback port and returns the bridge URL.
  "local-design-bridge": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      const sdk = path.join(root, "mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client");
      const { Client } = await import(path.join(sdk, "index.js"));
      const { StdioClientTransport } = await import(path.join(sdk, "stdio.js"));
      const client = new Client({ name: "manual-capture", version: "1.0.0" });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ["mcp/server.mjs"], cwd: root, stderr: "inherit" }));
      try {
        const opened = await client.callTool({ name: "workbench_open", arguments: {} });
        const result = opened.structuredContent ?? JSON.parse(opened.content[0].text);
        await s.page.goto(result.url, { waitUntil: "networkidle0" });
        await s.page.evaluate((value) => { localStorage.clear(); localStorage.setItem("facet96.language", value); }, locale);
        await s.page.reload({ waitUntil: "networkidle0" });
        await s.openHighlight();
        await s.until(() => /已连接|connected/i.test(document.querySelector(".design-connection strong")?.textContent ?? ""));
        await s.settle(1500);
        await s.shoot("local-design-bridge");
      } finally {
        await client.close();
      }
    },
  },

  "round-edit": {
    viewport: zh ? { ...DESKTOP, deviceScaleFactor: 2 } : DESKTOP,
    async run(s) {
      await s.importExample("01-round-start.json");
      await s.stackEdit("C1");
      await s.shoot("round-edit");
    },
  },

  "01-workspace": {
    viewport: zh ? { ...DESKTOP, deviceScaleFactor: 2 } : DESKTOP,
    async run(s) {
      await s.importExample("01-round-start.json");
      await s.page.click(".cut-stack-new-row");
      await s.settle(1500);
      await s.shoot("01-workspace");
    },
  },

  "round-stack": {
    async run(s) {
      await s.importExample("01-round-start.json");
      await s.stackEdit("C1");
      await s.shoot("round-stack");
    },
  },

  "round-stack-actions": {
    async run(s) {
      await s.importExample("01-round-start.json");
      await s.stackEdit("C1");
      await s.shoot("round-stack-actions");
    },
  },

  // New crown cut at 50 degrees, I36; jump to the C1 x T1 vertex and lock it as Meet A.
  "meet-single-current": {
    async run(s) {
      await s.importExample("01-round-start.json");
      await s.page.click(".cut-stack-new-row");
      await s.settle(800);
      await s.setNumber(s.L("行业角数值", "Faceting angle value"), 50);
      for (let step = 0; ; step += 1) {
        if (step > 20) throw new Error("No C1 x T1 intersection found");
        await s.click(/^(下一交点|Next intersection)$/, ".construction-panel button");
        await s.wait(600);
        const source = await s.page.evaluate(() => document.querySelector(".construction-readout span:nth-child(3) b")?.textContent);
        if (source === "C1 × T1") break;
      }
      await s.click(/^(锁定 Meet A|Lock Meet A)$/, ".construction-panel button");
      await s.settle(1200);
      await s.shoot("meet-single-current");
    },
  },

  "third-edit": {
    viewport: zh ? { ...DESKTOP, deviceScaleFactor: 2 } : DESKTOP,
    async run(s) {
      await s.importExample("02-edge-third.json");
      await s.stackEdit("C2");
      await s.shoot("third-edit");
    },
  },

  "dual-edit": {
    async run(s) {
      await s.importExample("04-dual-meet.json");
      await s.stackEdit("C2");
      await s.shoot("dual-edit");
    },
  },

  // Narrow crop of the left column from the cut parameters down, taller than the viewport.
  // The tall viewport keeps the sidebar edge toggle (vertically centred) below the crop.
  "dual-controls": {
    viewport: { width: 1600, height: 2800 },
    async run(s) {
      await s.importExample("04-dual-meet.json");
      await s.stackEdit("C2");
      const clip = await s.page.evaluate((height) => {
        const section = [...document.querySelectorAll("summary")].find((item) => /切割参数|Cut parameters/.test(item.textContent)).getBoundingClientRect();
        return { x: 0, y: section.top - 6, width: 291, height };
      }, zh ? 1128 : 1174);
      await s.shoot("dual-controls", { clip });
    },
  },

  "four-edit": {
    async run(s) {
      await s.importExample("06-four-accents.json");
      await s.stackEdit("C2");
      await s.shoot("four-edit");
    },
  },

  "stale-workspace": {
    async run(s) {
      await s.importExample("07-source-changed.json");
      await s.stackEdit("C2");
      await s.shoot("stale-workspace");
    },
  },

  "stale-assistant": {
    async run(s) {
      await s.importExample("07-source-changed.json");
      await s.page.evaluate(() => { document.querySelector(".toolbar-more-menu").open = true; });
      await s.click(/^(逐层试切助理|Stage inspector)$/);
      await s.until(() => document.querySelector("[role=dialog]"));
      await s.wait(1000);
      await s.page.click(".construction-assistant-invalid-jump");
      await s.settle(2000);
      await s.shoot("stale-assistant");
    },
  },

  "round-front-detail": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      await s.importExample("01-round-start.json");
      await s.setView(/^(正视|Front)$/);
      await s.shootDetail("round-front-detail");
    },
  },

  "low-front-detail": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      await s.importExample("05-low-crown.json");
      await s.setView(/^(正视|Front)$/);
      await s.shootDetail("low-front-detail");
    },
  },

  "third-top-detail": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      await s.importExample("02-edge-third.json");
      await s.setView(/^(顶视|Top)$/);
      await s.shootDetail("third-top-detail");
    },
  },

  "two-thirds-top-detail": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      await s.importExample("03-edge-two-thirds.json");
      await s.setView(/^(顶视|Top)$/);
      await s.shootDetail("two-thirds-top-detail");
    },
  },

  "four-top-detail": {
    viewport: { ...DESKTOP, deviceScaleFactor: 2 },
    async run(s) {
      await s.importExample("06-four-accents.json");
      await s.setView(/^(顶视|Top)$/);
      await s.shootDetail("four-top-detail");
    },
  },

  "ring-cut": {
    async run(s) {
      await s.startRingCut();
      await s.setNumber(s.L("环切细分间距", "Ring cut spacing"), 25);
      await s.setNumber(s.L("切入深度数值", "Cut depth value"), 0.45);
      await s.showRingComposer();
      await s.shoot("ring-cut");
    },
  },

  "arc-cut": {
    async run(s) {
      await s.startRingCut();
      await s.click(/^(弧形 · 联动深度|Arc · linked depths)$/, ".composer-ring-kind button");
      await s.setNumber(s.L("弧切凸度", "Arc cut bulge"), 0.55);
      await s.setNumber(s.L("切入深度数值", "Cut depth value"), 0.45);
      await s.showRingComposer();
      await s.shoot("arc-cut");
    },
  },
};

// ---------------------------------------------------------------------------

const names = only ?? Object.keys(scenes);
const unknown = names.filter((name) => !scenes[name]);
if (unknown.length) throw new Error(`Unknown scene: ${unknown.join(", ")}`);
let failed = 0;
for (const name of names) {
  const scene = scenes[name];
  const s = await openSession(scene.viewport ?? DESKTOP);
  try {
    await scene.run(s);
    const errors = s.errors.filter((text) => !/GL Driver Message|GPU stall/.test(text));
    console.log(`${locale} ${name}: ok${errors.length ? ` (console: ${errors.slice(0, 3).join(" | ")})` : ""}`);
  } catch (error) {
    failed += 1;
    console.error(`${locale} ${name}: FAILED ${error.message}`);
  } finally {
    await s.close();
  }
}
process.exitCode = failed ? 1 : 0;
