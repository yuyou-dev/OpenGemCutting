# 共同三维交互模块 1.0.0

候选中的 `navigation.js` 是无 React、DOM、存储或渲染依赖的 ESM。实验室结构、表面与 LightLab 视图都消费这一文件的同一源码 `src/ui/viewportNavigation.js`；组件共用 `useViewportNavigation` 事件适配器。交互不修改几何，也不进入几何撤销栈。

## 主项目复用

与候选整体同步，在主项目编辑切割和光学视图动态导入同一个固定版本的 `navigation.js`，不要再次复制公式。现有选择、点编辑、Gizmo 和渲染调度优先级保持不变；只有未被编辑工具消费的视口输入交给本模块。

```js
const nav = await import(/* @vite-ignore */ navigationUrl);
const camera = nav.createViewportCamera({ yaw: -.72, pitch: -.52, zoom: 1, panX: 0, panY: 8 });
// pointerdown: 仅主按钮；focus、setPointerCapture，并保存最后的 clientX/Y
// pointermove: dx/dy 是上次事件之后的 CSS 像素增量
nav.dragViewport(camera, dx, dy, event.shiftKey);
nav.zoomViewport(camera, event.deltaY); // wheel listener 必须 passive:false
if (nav.keyViewport(camera, event.key, event.shiftKey, homePose)) event.preventDefault();
// 每个主项目绘制帧，保留已有调度器：
const moving = nav.advanceViewportCamera(camera, performance.now());
// moving 时继续请求帧；pointerup/cancel/lostcapture 结束拖拽，停止多余输入
// 双击/0/Home：nav.resetViewport(camera, homePose)
```

规范：旋转 0.008 rad/CSS px；右拖增加 yaw、下拖减少 pitch，pitch 限于 ±π/2。Shift 拖动与平移箭头以 CSS px 记录，不乘 DPR。滚轮目标 zoom 乘 exp(-deltaY × 0.0012)，限于 0.48–2.8。每帧旋转/缩放追赶 0.16、平移 0.18，分别以 1e-6 / 1e-3 收敛。方向键旋转水平 0.12、竖直 0.1 rad，Shift 方向键 14 px，+/− 比例 1.12。`orbitViewport` 接受弧度增量；`advanceViewportCamera` 支持主项目原有 transition 结构及完成回调。

编辑切割的 yaw/pitch 可直接使用。实验室的 Z-up 适配位于 `src/ui/solidView.js`：theta = −yaw−π/2，phi = π/2+pitch；光学射线与软件投影共用同一相机。主项目旧光学相机若保留自己的 yaw/elevation 表达，应按此 camera frame 对齐，不能再把原来的反号输入重复叠加。初始构图、切割动画与相机复位姿态由各宿主视图决定，不由模块改写模型参考系。

实验室所有三维窗口有主按钮旋转、Shift 平移、滚轮、键盘和双击复位；共享相机状态。暂停/卸载停止帧、捕获与渲染；恢复不补播旧目标。光学 pan 只影响射线原点和去噪导向，不移动场景、灯光、切面或物理尺寸。

## 参考来源与边界

只读基准：主项目 `dec1386f8dc412effe9f928678f49ea492b44b7b` 工作树（有未提交变动），编辑切割页面。读取时内容指纹：

- `src/components/viewportOrbit.js`：`08890884b81827c1c5eb84a8376f1a099b593e3a166b932c74bd66739d083094`
- `src/components/viewportFrames.js`：`5c248294b803d281dfd77bd330cde4e5f7b8fa7edd9d16ab48ef8ad9bf1ed24c`
- `src/components/GemViewport.jsx`：`80c85c07563ff49fe868158d2d6aba71291f621928309b70dfaaf34cbd460137`

本轮仅在实验室交付共同实现。主项目尚未切换到此模块，需其同步后验证编辑切割、光学、Gizmo 优先级、切割动画和窄屏手感；不能将实验室测试算作宿主验收通过。公共几何契约仍为 1.0.0。
