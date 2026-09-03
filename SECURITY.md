# Security Policy

## Supported version

安全修复以 `main` 上最新版本为目标。当前不承诺旧版本的长期支持；发布 tag 用于定位问题，不代表独立维护分支。

## Reporting a vulnerability

请勿在公开 Issue、Discussion、截图或示例 JSON 中披露漏洞、真实凭据或私人数据。仓库发布后，优先使用 GitHub Private Vulnerability Reporting；如果未启用，请使用维护者 GitHub 资料页提供的私密联系方式。

报告建议包含：受影响版本或提交、最小复现、潜在影响、已知缓解方式，以及问题是否已公开。不要发送真实密钥；请先撤销任何已暴露凭据。

## Scope

OpenGemCutting 当前是本地优先的浏览器应用，不需要账号、后端或 API Key。安全范围包括 JSON/ASC/PDF 文件处理、预设资料加载、浏览器渲染、GitHub Pages 构建与 Sites worker 链路。公开仓库不得读取、打包或分发用户凭据、个人绝对路径或私有服务地址。
