import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "public/manual/facet-96-operation-manual.pdf");
const htmlPath = path.join(root, "tmp/pdfs/manual-v2/facet-96-operation-manual.html");
const screenshotsDir = path.join(root, "docs/manual/screenshots");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const asset = (relativePath) => pathToFileURL(path.join(root, relativePath)).href;
const shot = (file) => pathToFileURL(path.join(screenshotsDir, file)).href;

const screenshots = {
  workspace: shot("01-workspace.jpg"),
  presets: shot("02-preset-library.jpg"),
  optics: shot("03-optics.jpg"),
  help: shot("04-help-center.jpg"),
  opticsTable: shot("05-optics-table.jpg"),
  workspaceComplete: shot("06-workspace-complete.jpg"),
  workspaceTop: shot("07-workspace-top.jpg"),
  fileMenu: shot("08-file-menu.jpg"),
};

const pageChrome = (section, pageNumber) => `
  <header class="page-header"><span>${section}</span><span class="page-brand"><img src="${asset("public/brand/logo-header.webp")}" alt=""><strong>切磨工作台</strong><em>Alpha</em><i>SUVA · FACET 96</i></span></header>
  <footer class="page-footer"><span>切磨工作台 · 操作手册 · v${packageJson.version}</span><span><b>${String(pageNumber).padStart(2, "0")}</b> / 12</span></footer>`;

const standardPage = ({ section, index, title, subtitle, pageNumber, body, className = "" }) => `
  <section class="page ${className}">
    ${pageChrome(section, pageNumber)}
    <div class="section-title"><div class="section-index">${index}</div><h1>${title}</h1><p>${subtitle}</p></div>
    ${body}
  </section>`;

const numberRows = (items) => `
  <div class="number-rows">${items.map(([number, title, text]) => `
    <div class="number-row"><span class="row-number">${number}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join("")}</div>`;

const termRows = (items) => `
  <div class="term-rows">${items.map(([term, code, text]) => `
    <div class="term-row"><div><strong>${term}</strong><small>${code}</small></div><p>${text}</p></div>`).join("")}</div>`;

const callout = (label, text, tone = "pink") => `
  <aside class="callout ${tone}"><strong>${label}</strong><p>${text}</p></aside>`;

const figure = (src, caption, pins = [], className = "") => `
  <figure class="figure ${className}"><div class="image-stage"><img src="${src}" alt="${caption}">${pins.map(({ n, x, y }) => `<span class="pin" style="left:${x}%;top:${y}%">${n}</span>`).join("")}</div><figcaption>${caption}</figcaption></figure>`;

const cover = `
  <section class="page cover">
    <div class="cover-brand"><img src="${asset("public/brand/logo-header.webp")}" alt="SUVA 标志"><div><strong>切磨工作台 <em>Alpha</em></strong><span>SUVA · FACET 96 · 专业版</span></div></div>
    <div class="cover-rule"></div>
    <div class="cover-tag">OPERATION MANUAL · 图解版</div>
    <h1>操作手册</h1>
    <p class="cover-subtitle">从预设琢型到精确切割、文件交换与光学判断</p>
    <figure class="cover-hero"><img src="${screenshots.opticsTable}" alt="Niteowl 水滴形宝石光学仿真台面视图"><figcaption>真实预设切型 · Niteowl Cut by Jerry Capps · 77 F</figcaption></figure>
    <div class="cover-meta"><span>适用版本 <b>v${packageJson.version}</b></span><span>品牌 SUVA / 切磨工作台 / Facet 96</span><span>© 2026</span></div>
  </section>`;

const contents = standardPage({
  section: "目录 · CONTENTS", index: "§§", title: "目录", subtitle: "CONTENTS · 按任务查找，而不是按菜单查找", pageNumber: 2, className: "contents-page",
  body: `<div class="toc">${[
    ["0", "先认识工作方式", "预设起步 · 参数化 CUT · 光学判断", "03"],
    ["1", "界面地图", "参数抽屉 · CUT STACK · 画布 · 命令条", "04"],
    ["2", "五分钟快速开始", "浏览预设 · 核对四视图 · 载入", "05"],
    ["3", "核心概念", "图层 · 行业角 · 深度 · 分度 · 镜像", "06"],
    ["4", "创建与编辑 CUT", "新建 · 预览 · 保存 · 取消", "07"],
    ["5", "保存与交换", "JSON · GemCad ASC · PDF", "08"],
    ["6", "聚焦光学仿真", "材质 · 观察视角 · 判断边界", "09"],
    ["6.1", "台面观察与对照", "完成切型的真实光学图例", "10"],
    ["7", "帮助与快捷操作", "任务式帮助 · 键盘与视口", "11"],
    ["8", "交付前检查", "几何 · 文件 · 报告 · 可恢复性", "12"],
  ].map(([n, title, detail, page]) => `<div class="toc-row"><span class="toc-index">${n}</span><strong>${title}</strong><span>${detail}</span><b>${page}</b></div>`).join("")}</div>${callout("阅读建议", "第一次使用建议按 03 至 07 页走完一次完整流程；遇到文件交换或光学判断时，再直接查阅对应章节。")}`,
});

const orientation = standardPage({
  section: "§0 · 工作方式", index: "§0", title: "先认识工作方式", subtitle: "ONE DOCUMENT · ONE CUT STACK · ONE RECOVERABLE HISTORY", pageNumber: 3,
  body: `<p class="lead">切磨工作台不是自由建模器。你编辑的是一份有顺序、可撤销、可交换的参数化切割文档；画布中的宝石只是这份文档的实时结果。</p>${numberRows([
    ["01", "从完整起点开始", "使用内置预设或标准毛坯。预设会带入真实 CUT STACK、文档名称与来源信息。"],
    ["02", "一次只处理一个 CUT 会话", "选择区域后新建或编辑图层；参数改变前，已保存几何不会被悄悄改写。"],
    ["03", "先看实体，再保存", "同时核对切割面、Gizmo、面数、体积与切割指令；保存才会进入历史。"],
    ["04", "用正确格式交付", "JSON 是完整主文件；ASC 用于 GemCad 交换；PDF 用于阅读、打印和工艺沟通。"],
  ])}<div class="journey"><span><b>01</b> 选择起点</span><i></i><span><b>02</b> 创建 CUT</span><i></i><span><b>03</b> 几何检查</span><i></i><span><b>04</b> 光学观察</span><i></i><span><b>05</b> 保存交付</span></div>${callout("安全原则", "预设载入和文档级变换都会作为一次命令进入历史；任何未保存 CUT 都可以按 Escape 完整取消。", "green")}`,
});

const map = standardPage({
  section: "§1 · 界面地图", index: "§1", title: "界面地图", subtitle: "CAPABILITY MAP · 当前文档的完整编辑现场", pageNumber: 4,
  body: `${figure(screenshots.workspaceComplete, "图 1  载入 Niteowl 水滴形预设后的完整工作区", [
    { n: 1, x: 9, y: 22 }, { n: 2, x: 31, y: 18 }, { n: 3, x: 64, y: 48 }, { n: 4, x: 84, y: 7 }, { n: 5, x: 12, y: 68 }, { n: 6, x: 78, y: 92 },
  ], "large")}<div class="legend-grid">${[
    ["1", "参数抽屉", "行业角、深度、分度、重复与镜像"], ["2", "CUT STACK", "图层顺序、区域筛选、显隐与重排"],
    ["3", "3D 画布", "真实几何、切割 helper 与交互反馈"], ["4", "命令条", "视图、名称、显示模式、文件与历史"],
    ["5", "切割指令", "按亭部、腰部、冠部生成加工清单"], ["6", "视口提示", "旋转、平移、缩放与复位操作"],
  ].map(([n, title, text]) => `<div><span>${n}</span><p><strong>${title}</strong>${text}</p></div>`).join("")}</div>`,
});

const quickStart = standardPage({
  section: "§2 · 快速开始", index: "§2", title: "五分钟快速开始", subtitle: "START FROM A VALIDATED PRESET", pageNumber: 5,
  body: `<p class="lead">第一次体验建议从预设库开始。下面使用 Niteowl Cut by Jerry Capps，水滴形，77 个面，96 齿精确映射。</p>${figure(screenshots.presets, "图 2  预设库同时提供四视图、面数、层数、L/W 与来源", [
    { n: 1, x: 17, y: 33 }, { n: 2, x: 63, y: 30 }, { n: 3, x: 85, y: 70 }, { n: 4, x: 88, y: 92 },
  ], "large")}${numberRows([
    ["01", "查找候选", "文件 → 浏览预设琢型；按名称、作者、来源或外形筛选。"],
    ["02", "核对真实几何", "查看 45° 轴测、顶视、底视与正视；同时确认面数、层数、分度和 L/W。"],
    ["03", "载入并继续编辑", "载入会替换当前文档，但可用一次撤销恢复；继续工作后优先保存为 JSON。"],
  ])}`,
});

const concepts = standardPage({
  section: "§3 · 核心概念", index: "§3", title: "三十秒核心概念", subtitle: "PARAMETRIC CUTTING MODEL", pageNumber: 6,
  body: `<div class="concept-layout">${termRows([
    ["图层", "CUT", "一组参数快照。保存的 CUT STACK 是几何唯一真值。"],
    ["行业角", "ANGLE", "台面 0°，腰部 90°；冠部和亭部按区域解释方向。"],
    ["深度", "DEPTH", "切割平面沿法线向内推进的量，保存全精度。"],
    ["分度", "INDEX", "一圈 96 齿，每齿 3.75°；显示 96 与内部 0 同位。"],
    ["重复", "REPEAT", "让同一图层围绕轴心产生 N 个有效切面。"],
    ["镜像", "MIRROR", "围绕固定反射轴生成第二组切面，重合面去重。"],
  ])}${figure(screenshots.workspaceTop, "图 3  完成切型的顶视轮廓，可直接核对对称性", [], "portrait-fit")}</div>${callout("为什么要理解图层", "撤销、重排、显隐、ASC 交换和 PDF 工艺表都从 CUT STACK 派生。只看最终网格，会丢失继续编辑所需的设计语义。")}`,
});

const cutWorkflow = standardPage({
  section: "§4 · 创建与编辑 CUT", index: "§4", title: "创建与编辑切割", subtitle: "NEW · PREVIEW · COMMIT · CANCEL", pageNumber: 7,
  body: `${figure(screenshots.workspace, "图 4  在已完成的水滴形上新建冠部 CUT：Gizmo、主切割面与会话槽位同时出现", [
    { n: 1, x: 9, y: 25 }, { n: 2, x: 37, y: 26 }, { n: 3, x: 63, y: 28 }, { n: 4, x: 47, y: 53 },
  ], "large")}<div class="two-column-steps">${numberRows([
    ["01", "从会话槽位进入", "CUT STACK 底部绿色入口是唯一的新建入口。"],
    ["02", "调整参数", "蓝色桥架调角度，粉色直杆调深度，双环调分度与镜像。"],
  ])}${numberRows([
    ["03", "检查预览", "所有重复面参与几何，但主 Gizmo 始终对应基础索引。"],
    ["04", "保存或取消", "只有参数确实变化后才能提交；Escape 取消且不写历史。"],
  ])}</div>${callout("编辑不是新建", "点选已保存层只恢复参数。真正修改后才出现未保存预览，保存时在原序列位置替换。", "green")}`,
});

const files = standardPage({
  section: "§5 · 文件与交换", index: "§5", title: "保存与交换", subtitle: "CHOOSE THE FORMAT BY PURPOSE", pageNumber: 8,
  body: `${figure(screenshots.fileMenu, "图 5  文件菜单：完整主文件、行业交换与技术报告各自独立", [
    { n: 1, x: 87, y: 19 }, { n: 2, x: 87, y: 31 }, { n: 3, x: 87, y: 42 },
  ], "medium")}<div class="format-cards"><article><span>01</span><h3>JSON 完整主文件</h3><p>保留文档名称、毛坯、CUT STACK、显式刻面与光学元数据。适合归档与继续编辑。</p><b>默认选择</b></article><article><span>02</span><h3>GemCad ASC</h3><p>交换角度、索引、距离比例与折射率。重复和镜像会展开为显式切面。</p><b>行业交换</b></article><article><span>03</span><h3>PDF 技术报告</h3><p>输出工程视图、尺寸和逐面表。适合打印、复核和工艺沟通。</p><b>阅读交付</b></article></div>${callout("ASC 预检不可跳过", "分度不能精确映射到 96 齿、preform、缺少 0° 台面或多个 0° 台面都会阻断导入；系统不会静默取整或虚构层。")}`,
});

const opticsMaterial = standardPage({
  section: "§6 · 光学仿真", index: "§6", title: "聚焦光学仿真", subtitle: "REAL GEOMETRY · MATERIAL · LIGHT", pageNumber: 9,
  body: `<p class="lead">从显示模式进入光学仿真。编辑工具暂时隐藏，但当前文档、预览与 CUT 会话保持原样；退出后恢复完整现场。</p>${figure(screenshots.optics, "图 6  Niteowl 水滴形的透视光学仿真，不再使用默认毛坯作为示例", [
    { n: 1, x: 40, y: 50 }, { n: 2, x: 87, y: 30 }, { n: 3, x: 88, y: 58 }, { n: 4, x: 53, y: 5 },
  ], "hero")}<div class="legend-grid compact"><div><span>1</span><p><strong>真实几何</strong>当前 77 面预设切型直接参与光学计算</p></div><div><span>2</span><p><strong>材质常量</strong>折射率、色散与临界角保持联动</p></div><div><span>3</span><p><strong>体色与吸收</strong>使用 Beer-Lambert 模型观察光程影响</p></div><div><span>4</span><p><strong>观察命令条</strong>视角、切型名称、退出与实时状态</p></div></div>${callout("判断边界", "曝光和摄影棚只改变观看条件，不会修复破面、漏光或错误的 CUT 顺序。先保证几何正确，再比较材料表现。", "green")}`,
});

const opticsViews = standardPage({
  section: "§6.1 · 光学观察", index: "6.1", title: "用视角完成判断", subtitle: "TABLE · PAVILION · FRONT · SIDE", pageNumber: 10,
  body: `${figure(screenshots.opticsTable, "图 7  台面观察：水滴轮廓、亮暗区域、色散边缘与中心汇聚一目了然", [
    { n: 1, x: 39, y: 50 }, { n: 2, x: 70, y: 39 }, { n: 3, x: 84, y: 15 },
  ], "hero")}<div class="compare-grid"><article><h3>应该观察</h3><ul><li>轮廓是否完整、左右关系是否符合设计意图</li><li>台面和主刻面的亮暗是否具有连续结构</li><li>亭部观察是否出现异常洞口或大片失真</li><li>同一曝光下比较不同材料与体色</li></ul></article><article><h3>不要用观看参数掩盖</h3><ul><li>不要用过曝隐藏黑区或破面</li><li>不要把摄影棚反射当作几何结构</li><li>不要只看一个透视角就判断完成度</li><li>不要忘记退出后回到实体模式复核</li></ul></article></div>${callout("推荐顺序", "先透视理解整体，再看台面和亭部判断光学结构，最后用正视与侧视确认冠高、亭深和轮廓连续性。")}`,
});

const help = standardPage({
  section: "§7 · 帮助与快捷键", index: "§7", title: "随时回到正确下一步", subtitle: "TASK-BASED HELP · STAY IN CONTEXT", pageNumber: 11,
  body: `${figure(screenshots.help, "图 8  更多 → 帮助与操作手册：按任务组织，不离开当前编辑现场", [
    { n: 1, x: 27, y: 30 }, { n: 2, x: 55, y: 36 }, { n: 3, x: 86, y: 92 },
  ], "large")}<div class="shortcut-grid">${[
    ["拖拽 / 方向键", "旋转宝石"], ["Shift + 拖拽", "平移画布"], ["滚轮 / + / -", "缩放视图"],
    ["0", "复位相机"], ["Escape", "取消 CUT 或退出光学仿真"], ["Enter", "提交名称或行内参数"],
  ].map(([key, value]) => `<div><kbd>${key}</kbd><span>${value}</span></div>`).join("")}</div>${callout("帮助不会打断工作", "打开菜单、帮助中心或预设浏览不会修改当前文档；帮助中心内可直接下载本手册的最新版。", "green")}`,
});

const checklist = standardPage({
  section: "§8 · 交付检查", index: "§8", title: "完成设计前的检查清单", subtitle: "GEOMETRY · DOCUMENT · EXCHANGE · REPORT", pageNumber: 12,
  body: `<p class="lead">把设计交给下一位使用者之前，目标不是“看起来完成”，而是几何正确、格式明确，并且任何人都能恢复到同一份 CUT STACK。</p><div class="checklist">${[
    ["01", "保存 JSON 主文件", "确认文件名来自当前切型名称，并能重新导入。"],
    ["02", "检查 CUT STACK", "逐层核对区域、顺序、行业角、深度、索引和面数。"],
    ["03", "检查几何", "使用实体与 X-RAY 查看缺面、过切、异常交线和错误层序。"],
    ["04", "检查光学", "用真实材料参数依次查看透视、台面、亭部、正视和侧视。"],
    ["05", "准备交换", "ASC 导出前阅读展开与有损提示，并与 JSON 一同归档。"],
    ["06", "生成技术报告", "按交付需要决定是否包含腰部逐面表，检查标题和视图。"],
  ].map(([n, title, text]) => `<div><span>${n}</span><i></i><p><strong>${title}</strong>${text}</p></div>`).join("")}</div><div class="archive-box"><div><small>RECOMMENDED ARCHIVE</small><h3>推荐归档组合</h3></div><ol><li>JSON 完整主文件</li><li>PDF 技术报告</li><li>必要时附 GemCad ASC</li></ol></div>${callout("最终原则", "ASC 不替代 JSON，截图不替代文档，漂亮的光学画面也不替代几何检查。")}<aside class="acknowledgements"><strong>开放协作与致谢 <small>OPEN SOURCE &amp; ACKNOWLEDGEMENTS</small></strong><p>OpenGemCutting 公开发行版的代码与原创文档以 MIT License 发布；SUVA、切磨工作台与 Facet 96 的名称和标识保留品牌与商标权益。第三方字体、依赖和预设琢型遵循各自许可与署名要求。感谢所有开源工具、资料作者与项目贡献者；完整条款以公开仓库的 LICENSE、TRADEMARKS.md 与 THIRD_PARTY_NOTICES.md 为准。</p></aside>`,
});

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>切磨工作台 Facet 96 操作手册 v${packageJson.version}</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#d9d9d6;color:#111}body{font-family:"PingFang SC","Helvetica Neue",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{position:relative;width:210mm;height:297mm;padding:18mm 17mm 16mm;background:#fff;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.page-header,.page-footer{position:absolute;left:17mm;right:17mm;display:flex;align-items:center;justify-content:space-between;color:#777;font:500 7.2pt/1.2 "Helvetica Neue",Arial,sans-serif;letter-spacing:1.6px}.page-header{top:8.5mm;padding-bottom:3.2mm;border-bottom:.25mm solid #d4d4d0}.page-footer{bottom:7mm;padding-top:3mm;border-top:.25mm solid #d4d4d0}.page-footer b{color:#e91e57}.section-title{margin-top:11mm;padding-bottom:6mm;border-bottom:.35mm solid #111}.section-index{color:#e91e57;font:700 9pt/1 "SFMono-Regular",Menlo,monospace;letter-spacing:1px;margin-bottom:2mm}.section-title h1{margin:0;font-size:22pt;line-height:1.12;letter-spacing:-.6px}.section-title p{margin:2.2mm 0 0;color:#aaa;font:500 7pt/1.2 "SFMono-Regular",Menlo,monospace;letter-spacing:2.2px}.lead{margin:6mm 0 4.5mm;color:#555;font-size:9.4pt;line-height:1.78}.figure{margin:5mm 0 0}.figure .image-stage{position:relative;border:.25mm solid #cfcfcb;border-radius:2.2mm;overflow:hidden;background:#f6f6f4;box-shadow:0 1mm 3mm rgba(0,0,0,.06)}.figure img{display:block;width:100%;height:100%;object-fit:contain;background:#fff}.figure.large .image-stage{height:94mm}.figure.medium .image-stage{height:65mm}.figure.hero .image-stage{height:105mm}.figure figcaption{margin-top:2.2mm;color:#666;font-size:7.2pt;line-height:1.45}.pin{position:absolute;width:7.2mm;height:7.2mm;display:grid;place-items:center;transform:translate(-50%,-50%);border-radius:50%;color:#fff;background:#e91e57;border:.7mm solid #fff;box-shadow:0 1mm 2mm rgba(0,0,0,.14);font:700 8pt/1 Arial}.number-rows{margin-top:4mm}.number-row{display:grid;grid-template-columns:13mm 1fr;gap:3mm;padding:3.2mm 0;border-bottom:.2mm solid #ddd}.number-row:last-child{border-bottom:0}.row-number{color:#e91e57;font:700 10pt/1.3 "SFMono-Regular",Menlo,monospace}.number-row h3{margin:0 0 1mm;font-size:9.5pt}.number-row p{margin:0;color:#666;font-size:8pt;line-height:1.55}.callout{margin-top:5mm;padding:3.6mm 4.5mm;border:.25mm solid #ccc;border-left:1mm solid #e91e57;border-radius:1.5mm;background:#fff}.callout.green{border-left-color:#2f7b50;background:#f1f8f4}.callout strong{display:block;margin-bottom:1mm;color:#e91e57;font:700 7pt/1.2 "SFMono-Regular",Menlo,monospace;letter-spacing:1px}.callout.green strong{color:#2f7b50}.callout p{margin:0;color:#555;font-size:7.8pt;line-height:1.55}.toc{margin-top:6mm;border-top:.25mm solid #111}.toc-row{min-height:14.4mm;display:grid;grid-template-columns:12mm 49mm 1fr 10mm;align-items:center;gap:3mm;border-bottom:.2mm solid #ddd}.toc-index{color:#e91e57;font:700 8pt/1 "SFMono-Regular",Menlo,monospace}.toc-row strong{font-size:9.5pt}.toc-row span:nth-of-type(2){color:#777;font-size:7.5pt}.toc-row b{color:#777;font:500 8pt/1 "SFMono-Regular",Menlo,monospace;text-align:right}.contents-page .callout{margin-top:7mm}.journey{margin-top:10mm;padding:5mm;display:flex;align-items:center;justify-content:center;background:#f6f6f3;border:.25mm solid #ddd;border-radius:1.5mm}.journey span{white-space:nowrap;font-size:7.3pt}.journey span b{color:#e91e57;margin-right:1mm}.journey i{width:9mm;height:.25mm;margin:0 1.8mm;background:#bbb}.legend-grid{margin-top:4.5mm;display:grid;grid-template-columns:1fr 1fr;column-gap:8mm}.legend-grid>div{min-height:16mm;display:grid;grid-template-columns:9mm 1fr;gap:2.5mm;padding:2.5mm 0;border-bottom:.2mm solid #ddd}.legend-grid span{width:6.5mm;height:6.5mm;display:grid;place-items:center;border-radius:50%;color:#fff;background:#e91e57;font:700 7.5pt/1 Arial}.legend-grid p{margin:0;color:#666;font-size:7.5pt;line-height:1.42}.legend-grid strong{display:block;color:#111;margin-bottom:.7mm;font-size:8.5pt}.legend-grid.compact>div{min-height:14mm}.concept-layout{margin-top:6mm;display:grid;grid-template-columns:1.05fr .95fr;gap:7mm}.term-row{display:grid;grid-template-columns:27mm 1fr;gap:4mm;padding:4.2mm 0;border-bottom:.2mm solid #ddd}.term-row:first-child{border-top:.2mm solid #ddd}.term-row strong{display:block;font-size:9.3pt}.term-row small{display:block;margin-top:1mm;color:#aaa;font:500 6.6pt/1 "SFMono-Regular",Menlo,monospace;letter-spacing:1.5px}.term-row p{margin:0;color:#666;font-size:7.8pt;line-height:1.55}.portrait-fit{margin-top:0}.portrait-fit .image-stage{height:85mm}.portrait-fit img{width:100%;max-width:100%;object-position:center}.two-column-steps{display:grid;grid-template-columns:1fr 1fr;gap:8mm}.two-column-steps .number-row{grid-template-columns:10mm 1fr}.format-cards{margin-top:5mm;display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.format-cards article{min-height:51mm;padding:4mm;border:.25mm solid #d2d2ce;border-top:.8mm solid #111;border-radius:1.5mm}.format-cards article>span{color:#e91e57;font:700 8pt/1 monospace}.format-cards h3{margin:3mm 0 2mm;font-size:9.5pt}.format-cards p{margin:0;color:#666;font-size:7.3pt;line-height:1.55}.format-cards b{display:inline-block;margin-top:3mm;padding:1.2mm 2.3mm;color:#2f7b50;background:#eef7f1;border-radius:4mm;font-size:6.5pt}.compare-grid{margin-top:5mm;display:grid;grid-template-columns:1fr 1fr;gap:5mm}.compare-grid article{padding:4mm 5mm;border:.25mm solid #d2d2ce;border-radius:1.5mm}.compare-grid h3{margin:0 0 2mm;font-size:9.3pt}.compare-grid ul{margin:0;padding-left:4.5mm;color:#666;font-size:7.4pt;line-height:1.65}.shortcut-grid{margin-top:5mm;display:grid;grid-template-columns:1fr 1fr;gap:0 7mm;border-top:.25mm solid #aaa}.shortcut-grid>div{min-height:13mm;display:grid;grid-template-columns:34mm 1fr;align-items:center;border-bottom:.2mm solid #ddd}kbd{width:max-content;padding:1.2mm 2mm;border:.25mm solid #aaa;border-bottom-width:.7mm;border-radius:1mm;background:#fff;font:600 7pt/1.1 "SFMono-Regular",Menlo,monospace}.shortcut-grid span{color:#555;font-size:7.8pt}.checklist{margin-top:7mm}.checklist>div{min-height:19mm;display:grid;grid-template-columns:13mm 8mm 1fr;align-items:start;gap:3mm;padding:3.4mm 0;border-bottom:.2mm solid #ddd}.checklist>div>span{color:#e91e57;font:700 9pt/1.4 monospace}.checklist i{width:5.2mm;height:5.2mm;border:.3mm solid #aaa;border-radius:50%}.checklist p{margin:0;color:#666;font-size:8pt;line-height:1.5}.checklist p strong{display:block;color:#111;margin-bottom:.8mm;font-size:9.5pt}.archive-box{margin-top:7mm;padding:5mm 6mm;display:grid;grid-template-columns:1fr 1.2fr;align-items:center;color:#fff;background:#111;border-radius:1.5mm}.archive-box small{color:#f26b91;font:600 6.5pt/1 monospace;letter-spacing:1.5px}.archive-box h3{margin:1.8mm 0 0;font-size:12pt}.archive-box ol{margin:0;padding-left:5mm;font-size:8pt;line-height:1.8}.cover{padding:17mm}.cover-brand{display:flex;align-items:center;gap:4mm}.cover-brand img{width:10mm;height:10mm;object-fit:contain}.cover-brand strong{display:block;font-size:12pt}.cover-brand strong em{margin-left:1.2mm;color:#999;font:400 7pt/1 Georgia,serif;letter-spacing:1px}.cover-brand span{display:block;margin-top:1mm;color:#999;font:500 6.5pt/1 monospace;letter-spacing:1.7px}.cover-rule{margin-top:7mm;border-top:.35mm solid #111}.cover-tag{display:inline-block;margin-top:20mm;padding:2.7mm 4mm;color:#e91e57;border:.3mm solid #e91e57;border-radius:1mm;font:700 7pt/1 monospace;letter-spacing:1.7px}.cover h1{margin:8mm 0 0;font-size:36pt;line-height:1;letter-spacing:-1px}.cover-subtitle{margin:5mm 0 0;color:#666;font-size:11pt}.cover-hero{margin:12mm 0 0}.cover-hero img{display:block;width:100%;height:105mm;object-fit:contain;background:#fff;border:.25mm solid #ccc;border-radius:2mm}.cover-hero figcaption{margin-top:2mm;color:#777;font-size:7pt}.cover-meta{position:absolute;left:17mm;right:17mm;bottom:16mm;padding-top:4mm;display:flex;justify-content:space-between;border-top:.25mm solid #bbb;color:#777;font-size:7pt}.cover-meta b{color:#111}
.page-header{z-index:2;background:#fff}.page-brand{display:flex;align-items:center;gap:1.3mm;letter-spacing:.4px}.page-brand img{width:4.5mm;height:4.5mm;object-fit:contain}.page-brand strong{color:#111;font-size:7.2pt}.page-brand em{color:#aaa;font:400 6pt/1 Georgia,serif}.page-brand i{margin-left:.8mm;padding-left:1.6mm;border-left:.2mm solid #ccc;color:#888;font:500 6.2pt/1 "SFMono-Regular",Menlo,monospace;font-style:normal;letter-spacing:1.1px}.acknowledgements{margin-top:4mm;padding:3.2mm 4.2mm;border-top:.35mm solid #111;background:#f7f7f5}.acknowledgements strong{display:flex;align-items:baseline;gap:2.5mm;font-size:8pt}.acknowledgements strong small{color:#999;font:500 5.8pt/1 "SFMono-Regular",Menlo,monospace;letter-spacing:1.1px}.acknowledgements p{margin:1.6mm 0 0;color:#666;font-size:6.6pt;line-height:1.5}
</style></head><body>${cover}${contents}${orientation}${map}${quickStart}${concepts}${cutWorkflow}${files}${opticsMaterial}${opticsViews}${help}${checklist}</body></html>`;

await mkdir(path.dirname(htmlPath), { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(htmlPath, html, "utf8");

const browserCandidates = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
let browserPath;
for (const candidate of browserCandidates) {
  try {
    await access(candidate);
    browserPath = candidate;
    break;
  } catch {
    // Continue to the next known browser location.
  }
}
if (!browserPath) throw new Error("Chrome or Chromium is required to build the operation manual PDF.");

await execFileAsync(browserPath, ["--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files", "--no-pdf-header-footer", "--print-to-pdf-no-header", `--print-to-pdf=${outputPath}`, "--run-all-compositor-stages-before-draw", "--virtual-time-budget=2500", pathToFileURL(htmlPath).href], { maxBuffer: 1024 * 1024 * 4 });
console.log(`Generated ${path.relative(root, outputPath)} (12 pages)`);
