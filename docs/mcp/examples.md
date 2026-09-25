# 可执行设计任务

以下为接口工程练习，不宣称原创审美或实际光学收益。运行入口：`workbench_open` → 浏览器打开 → `workbench_sessions` → `design_read`。每次写操作使用最新返回的 sessionId / projectId / revision。

## 立方体形成冠亭主面

起点：`project_create` 默认起点，name 为“冠亭主面练习”。设计意图：将只有台面与腰部的柱状起点切成有冠亭主面的实体。

向 `design_plan` 传入 operations：

```json
[
  {"kind":"cut","patternId":"crown-main","region":"crown","label":"冠部主面","draft":{"industryAngle":35,"depth":0.6,"baseIndex":0,"repeat":8}},
  {"kind":"cut","patternId":"pavilion-main","region":"pavilion","label":"亭部主面","draft":{"industryAngle":42,"depth":0.8,"baseIndex":0,"repeat":8}}
]
```

提交前用 planId 查看 top、bottom、front、isometric。保持相同视图与等比例投影比较：冠亭是否都形成明确新面，腰部是否仍存在。提交后在网页选中“冠部主面”，调整角度并保存；再请求旧 planId 应失效。最后保存、导出 JSON，在新项目重新导入并比较几何统计。

## 预设改型

起点：通过 `preset_list` 搜索设计师需要的轮廓，在 `project_create` 指定返回的 presetId。`design_read` 读取真实组参数与 Meet 来源，选定一个冠部组，以其 patternId 提交小幅角度调整方案。

设计意图：保留预设整体结构，观察主面倾角对台面与冠部连接的影响。若该组由双 Meet 锁定角度，应先调整自由量或用 `meet.clear` 明确解除。不可因为参数请求成功就认定角度已改变；对比返回 draft 与图像。

前后固定 top/front/isometric 观察条件；检查额外消面、Meet stale 与台面变化。恢复时使用一次撤销。

## 带孔晶体的单平面切磨

起点：`project_create` 指定 `stockPresetId: letter-a`，初始没有 CUT。设计意图：沿上方切下一层，保留真实孔洞。

```json
[{"kind":"cut","patternId":"mesh-table","region":"crown","label":"晶体顶部切面","draft":{"industryAngle":0,"depth":0.3,"repeat":1,"baseIndex":0}}]
```

检查 top/isometric 的孔洞、原石面片数和有效 CUT：虽然切面可分成多片，逻辑有效 CUT 必须为 1。导出 JSON 重开；ASC 应返回既有 mesh 阻断说明，不得替换成凸包。

## 参考图构造

按 `facet-parametric-design` 先冻结独立参考节点与连接。用 `construction_plane` 检查整数候选和共享点，再将求出的行业角、深度及整数主分度放入 CUT；用 `design_topology` 获取正确施工前缀，绑定真实 Meet。

`design_inspect.referenceTopology` 使用现有参考拓扑清单格式。原图像素与构造坐标分开；逐项审计使用共享 `src/domain/projectionAudit.js`，skill 兼容入口仍可调用。对缺视图、无法实现的连接和多余棱分别报告，不把工程通过等同于审美通过。

## 有尺寸约束的方形构造

[独立参考](examples/square-reference.json) 在求解前指定：轮廓 ±0.8、台面 ±0.4、台面 Z=0.45、腰边 Z=±0.05、亭尖 Z=-0.85，并声明顶视 8 个节点和 12 条连接。它是工程尺寸练习，不是照片还原或原创审美样本。

在默认项目中把 [操作序列](examples/square-operations.json) 传入 design_plan，返回 13 个最终有效 CUT 面。用 design_projection 传入参考中的 graph / faceMap、view=top、scale=400、center=[400,400]，逐项检查 8 节点和 12 连接，额外可见顶点仍如实列出。用 front 检查冠亭高度及 0.1 腰厚；不单独缩放坐标轴。

## 120 分度与五次对称

起点为默认项目。设计意图：保持现有 96 分度工序，在同一设计中增加五次对称冠面，检查哪些分度盘可执行最终平面。

```json
[{"kind":"cut","patternId":"five-crown","region":"crown","draft":{"indexTeeth":120,"baseIndex":0,"repeat":5,"industryAngle":35,"depth":0.6}}]
```

用 `design_inspect.indexCompatibility` 比较全部工序与最终有效面：120 齿五次对称的新层不会被静默取整为 96 齿。若存在原 32 折腰部，最终所有平面未必兼容 120 齿；以真实法线结果为准。JSON 重开后五次对称和各组齿数保持。

## 独立叠加凹面加工

起点为已有平面 CUT 的项目。设计意图：保留平面工序，在侧面加一个半径 0.4 的球形凹槽。

```json
[{"kind":"replace-parameters","parameterGroup":{"kind":"facet-parameter-group","schemaVersion":1,"group":"concave","concaveCuts":[{"id":"side-scoop","type":"sphere","position":[0.8,0,0],"radius":0.4,"repeat":1,"segments":24}]}}]
```

在相同正交及立体观察条件下比较凹槽。将同一参数组中的 `concaveCuts` 改为 `[]` 可移除凹面加工；原底胚与平面 CUT 参数不变，撤销恢复凹槽。`group: "stock"` 文件只携带 `stock`，`group: "planar"` 只携带 `facets`，凹切组只携带 `concaveCuts`；不允许混装后暗中替换其他组。球面与柱面按指定段数离散为真实网格，凹切设备需求独立于平面分度兼容结果。
