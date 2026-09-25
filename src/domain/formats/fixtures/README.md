# 格式中心测试样本

仅用于互操作回归，不是推荐切磨配方，也不代表 GemCAD 或 Gem Cut Studio 的官方背书。

| 文件 | 来源与性质 |
| --- | --- |
| `gcs-1.1-resaved.gcs` | 以内置预设 `100058-pc-07-001c-square-emerald-1-4`（Norman W. Steele，来源见预设 catalog）为起点，拆出并磨砂一个冠部面后，由 Gem Cut Studio 1.1 实际打开并保存。只清理层名与标题，数字、表面、法向与顶点保持原样。 |
| `gcs-1.1-edited.gcs` | 同一文件在 Gem Cut Studio 1.1 中把该磨砂面的 38° 改为 39° 后再次保存。 |
| `smallest-square.asc` | Robert H. Long 的 Smallest Square，来源页面标注 Assigned to the Public Domain（https://hackagem.com/doc/posts/gemcad-import/），文件内作者声明保留。 |

三份样本来自用户自有、按 MIT 发布的 Facet Format Bridge 探索版（0.1.0-rc.1）。GemCAD `.gem` 回归使用测试内的合成编码器，不收录第三方 `.gem` 设计。
