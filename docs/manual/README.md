# Facet 96 操作手册源文件

`screenshots/` 保存手册使用的真实工作台界面。截图固定为 1280 × 720 的同一桌面视口、白色主题，并覆盖：

- 完成切型及活动 CUT 的参数化工作区
- 预设琢型库与文件菜单
- 完成切型的透视、台面聚焦光学仿真
- 内置帮助中心

更新界面或长期产品规则后，重新采集对应截图并运行：

```bash
npm run manual:build
```

生成结果为 `public/manual/facet-96-operation-manual.pdf`，由应用内帮助中心直接提供。生成器使用本机 Chrome/Chromium 将分页 HTML 输出为 A4 PDF，并与 `package.json` 共用版本号，避免手册版本漂移。
