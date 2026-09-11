# 文档入口

当前版本见 [package.json](../package.json)。

- [产品与快速开始](../README.md)
- [安装](../INSTALL.md)、[升级](../UPGRADE.md)、[卸载](../UNINSTALL.md)
- [图解手册与原创练习](manual/README.md)
- [对话设计师测试：5 个任务](mcp/designer-acceptance.md)
- [本地 MCP 与能力文档](mcp/README.md)
- [设计 skill](../.agents/skills/facet-parametric-design/SKILL.md)
- [状态契约](architecture/state-contract.md)、[视觉规范](architecture/design-system.md)、[ASC](architecture/gemcad-asc.md)、[预设库](architecture/preset-library.md)
- [文件与设计边界](limits.md)、[性能](cut-performance.md)、[支持与验收](validation.md)
- [贡献指南](../.github/CONTRIBUTING.md)、[社区准则](../.github/CODE_OF_CONDUCT.md)、[安全反馈](../.github/SECURITY.md)
- [第三方来源](legal/THIRD_PARTY_NOTICES.md)、[品牌说明](legal/TRADEMARKS.md)
- [版本记录](../CHANGELOG.md)

状态规则、视觉规则、导入导出规则分别回填所属文档。一次性验收证据保存在忽略的 tmp/；不要将个人参考图、内部交接或凭证提交到公开仓库。

## 根目录与文档归档

根目录保留产品 README、许可证、版本记录、AGENTS 及安装／升级／卸载入口。工程契约集中在 `docs/architecture/`；新增维护资料进入对应文档目录，不再散落根目录。MCP 的资源 URI 是稳定接口，内部文档迁移须同步资源映射、skill、链接及协议回归。
