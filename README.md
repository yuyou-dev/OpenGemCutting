<div align="center">

<img src="public/brand/logo-header.webp" width="72" alt="SUVA" />

# OpenGemCutting

**切磨工作台 · 让琢型设计，从一段对话开始。**

96 齿参数化切割 · 真实几何 · 逐刀演示 · Codex 辅助设计

[快速开始](#快速开始) · [用 Codex 设计](#用-codex-设计) · [操作手册](public/manual/facet-96-operation-manual.pdf) · [参与贡献](CONTRIBUTING.md)

![Release candidate](https://img.shields.io/badge/version-1.0.0--rc.2-ed225d)
![MIT](https://img.shields.io/badge/license-MIT-222222)
![Local first](https://img.shields.io/badge/data-local_first-ffffff)

</div>

> **1.0 RC 候选版** · 设计与几何计算在浏览器本地完成。独立部署无需 Codex、登录或 API Key；搭配 Codex 可从参考图构建可编辑的琢型，再用真实三视图反复校准。

![参数化切磨工作台，真实运行截图](docs/images/workbench.jpg)

展示琢型：**PC 01.338 Eight Main Highlight** · Long, R H & Steele, N W；源记录 *Facet Design v5 (1984) pC12*。可在预设库按名称载入，配图对应仓库内的真实可编辑文档。

## 从形状，到每一刀

| 设计 | 观察 | 交付 |
| --- | --- | --- |
| 连续角度、96 齿分度、旋转与镜像 | 顶视、底视、侧视及三维观察 | 完整参数化 JSON |
| Meet / Jump 与可回退的 CUT 序列 | 光学仿真与材质观察 | 可搜索中文的 PDF 切割报告 |
| 原创预设或导入闭合 OBJ 晶体 | 保留凹槽、孔及分离组件 | 带预检与能力提示的 GemCad ASC |

### 切割助手：边看，边理解工序

右侧仪表给出**下一刀**的分度、行业角、切入深度和本组刀序；底部播放器独立提供逐步、逐组、进度定位与自动播放。每刀完成后停留 0.5 秒，再平滑转到侧偏 45° 的观察角度；停稳后才显示下一刀平面。可调整转场速度。手动操作与切到后台会暂停播放，退出后回到原编辑现场。

![切割助手：独立仪表与播放器](docs/images/cutting-assistant.jpg)

### 琢型试作：把参考与真实模型放在一起

同一份 JSON 驱动顶视、底视、侧视和轴测图。保留参考图片、比例说明与待确认项，下载后继续在工作台调整。截图使用完整预设 Eight Main Highlight，参考技术图与模型来自同一预设，仅演示对照流程。

![琢型试作：参考与模型对照](docs/images/design-review.jpg)

## 快速开始

### 不安装 先试单机版

**[打开浏览器单机版 Live Demo](https://yuyou-dev.github.io/OpenGemCutting/)**

直接在浏览器手动设计，无需 Codex、MCP、账号或 API Key。它保留参数化切割、预设、保存与导出；没有对话式 AI 创作。线上版本以当前部署为准。

### 复制一句话给 Codex 安装对话设计

先安装并登录可以正常对话的 Codex，然后复制：

```text
请按照 https://github.com/yuyou-dev/OpenGemCutting/blob/main/INSTALL.md 安装完整 OpenGemCutting，配置工作台、运行环境、设计插件、MCP 和 skill，在 Codex 内置浏览器中打开并确认连接。完成后告诉我可以直接提出琢型设计需求。
```

Codex 会完成环境检查与配置。macOS、Windows 都有安装入口；若客户端提示刷新或新开项目任务，完成这一次工具加载即可。只有实际连接网页后才提示可以开始创作。当前改动为本地候选，尚未推送；候选验收使用本地项目中的 INSTALL.md，远程提示词要等本版发布后才会安装到本轮能力。

准备好后，你可以直接说：

> 帮我做一颗圆形、八向对称、台面清楚的基础琢型，先给我看真实模型。

> 冠部再低一点，保留整体轮廓。给我看前后差异，等我选择。

> 根据我上传的草图做一个新琢型，先确认最重要的连接，再给我真实模型对比。

工作台、完整设计 skill、同源 MCP、安装升级模块与设计插件都包含在本仓库。Codex 客户端、模型服务和账号不随源码分发。设计插件调用同一工作台能力，不维护另一套建模代码；社区 Companion 另行选择安装。

### 已安装 一句话升级

```text
请按照 https://github.com/yuyou-dev/OpenGemCutting/blob/main/UPGRADE.md 升级我已有的 OpenGemCutting 和全部对话设计组件，保留我的设计，完成后重新连接内置浏览器，让我继续用对话创作。
```

升级会检查本地改动，并先保留重要设计。需要停止使用时见 [卸载说明](https://github.com/yuyou-dev/OpenGemCutting/blob/main/UNINSTALL.md)。给设计师的简短体验任务见 [用对话设计一颗宝石](docs/mcp/designer-acceptance.md)，不要求测试手动切割。

### 团队从源码部署

已具备开发环境的团队可使用 Node.js 20.19+（20.x）或 22.12+：

```bash
git clone https://github.com/yuyou-dev/OpenGemCutting.git
cd OpenGemCutting
npm ci
npm run dev
```

打开终端实际打印的本机地址。生产构建运行 `npm run build`，部署静态前端 `dist/client/`；GitHub Pages 使用 `npm run build:pages`。没有 Codex、MCP 或模型服务时，基础手动功能照常运行。Linux 保留此源码路径；macOS 和 Windows 的自动配置见 INSTALL.md。

需要 AI 创作时由支持 MCP 的客户端启动 `mcp/server.mjs`；Codex 使用统一 `node setup/cli.mjs install`。协议与同源架构见 [开发文档](docs/mcp/README.md)，安装模块职责见 [setup](setup/README.md)。

## 用 Codex 设计

在安装好的项目新开任务，发送“打开工作台，开始对话设计”。Codex 会在内置浏览器打开本机工作台并确认当前项目，你可以直接提出造型需求、参考草图或修改意见。对话中的真实模型预览与网页使用同一份设计；提交后可继续修改，重要设计请让 Codex 导出文件留存。

## 五分钟完成一次设计练习

| 起点与意图 | 操作入口 | 判断结果 |
| --- | --- | --- |
| [圆形练习 01](docs/manual/examples/01-round-start.json)，观察清晰的八瓣冠部 | 新建项目 → 文件 → 导入 JSON | 顶视八瓣对称，侧视腰厚连续 |
| 改变冠部层次 | CUT STACK 选择冠部 → 编辑 → 调角度/深度 → 保存 | 固定观察方向，比较面宽和冠高；不满意可撤销 |
| 检查施工先后 | 画布左上 → 切割助手 → 下一组/播放 | “已完成”是已经切过的刀数，右栏始终提示下一刀 |
| 留存完整设计 | 文件 → 导出 JSON；需要施工表则导出 PDF | JSON 可再次导入并编辑，PDF 用于阅读与沟通 |

更多 Meet、双 Meet、凹晶体和可恢复操作见 [图解手册 PDF](public/manual/facet-96-operation-manual.pdf) 与 [教学案例](docs/manual/README.md)。

## 数据与支持范围

- 项目自动保存在当前浏览器。清除浏览器数据、切换浏览器或本地端口不会自动迁移项目；重要设计请导出 JSON。
- 新外部文件上限 20 MiB；JSON 最多 4096 个 CUT 平面，mesh stock 最多 20000 个顶点和 20000 个面片。OBJ 最多 4000 顶点、1000 源多边形且分解后不超过 1000 面片。超限会说明原因，当前设计保留。已有本机项目沿用原兼容规则。
- RC 验证环境与实际结果见 [支持与验收](docs/rc-validation.md)。Safari、Firefox 待验证；移动端暂不列为完整创作环境。
- 已有光学仿真可以使用；独立光学实验室仍为开发中入口。图形仿真与教学案例不保证实际切磨收益或某材料的光学等级。

## 开发与贡献

```bash
npm run check           # 公开扫描、领域回归、插件回归、构建与 Sites 验证
npm audit               # 当前依赖审计
npm run manual:build    # 从真实截图与教学案例重建 PDF
```

[开发规范](AGENTS.md) · [状态契约](state-contract.md) · [设计系统](design-system.md) · [ASC 规则](gemcad-asc.md) · [版本记录](CHANGELOG.md)

**OpenGemCutting Companion** 是可选的社区反馈与贡献插件，与设计插件分工独立。见 [插件说明](plugins/opengemcutting-companion/LIFECYCLE.md)。提交反馈时请附可复现步骤与脱敏 JSON；请勿提交原始个人资料或密钥。

[MIT License](LICENSE)。预设与第三方资源的来源、授权范围及品牌说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
