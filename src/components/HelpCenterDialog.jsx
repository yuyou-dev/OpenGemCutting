import { useEffect, useRef, useState } from "react";
import {
  IconBook2,
  IconChevronRight,
  IconDownload,
  IconFileDescription,
  IconKeyboard,
  IconSparkles,
  IconTool,
  IconX,
} from "@tabler/icons-react";

const HELP_SECTIONS = [
  {
    id: "start",
    label: "快速开始",
    eyebrow: "START HERE",
    icon: IconSparkles,
    title: "从预设或新建设计开始",
    intro: "先建立可工作的几何，再进入精确切割。所有保存动作都会进入同一份 CUT STACK。",
    steps: [
      ["01", "选择起点", "从文件菜单载入经过校验的预设，或新建边长 2.000 的标准毛坯。"],
      ["02", "创建切割", "在 CUT STACK 底部进入新建，选择冠部、腰部或亭部并设置参数。"],
      ["03", "检查并保存", "观察实体预览与 Gizmo，确认面数和几何后再加入序列。"],
    ],
    note: "已有备份时会提示恢复或开始新设计；本地备份不能代替 JSON 归档。打开菜单和帮助不改变文档。",
  },
  {
    id: "cut",
    label: "切割工作流",
    eyebrow: "CUT WORKFLOW",
    icon: IconTool,
    title: "一套参数控制一个切割图层",
    intro: "行业角、深度、96 分度、重复与镜像共同定义当前图层；保存的图层是几何唯一真值。",
    facts: [
      ["行业角", "控制切割面的垂直姿态，冠部与亭部在内部使用相反的 β 符号。"],
      ["切入深度", "沿当前切割面法线移动，始终保存完整精度。"],
      ["96 分度", "1-96 为操作读数，其中 96 与内部索引 0 同位。"],
      ["重复 / 镜像", "生成完整对称轨道；实体中全部切面都参与计算。"],
      ["编辑图层", "点击图层参数或面数进入编辑；点击名称可直接改名，Enter / 失焦提交，Escape 取消。"],
      ["Jump 定位", "新建 CUT 从 0.000 深度开始，并预告切面前方的下一点；预告区会标出仅接触、有效切面或覆盖影响；锁定 Meet 后先解除才能浏览交点。"],
      ["单顶点 Meet", "显式选择顶点并预览后锁定；角度、索引、重复或镜像变化会自动补偿深度。"],
      ["面数读数", "命令条统计已提交有效刻面；视口另列毛坯面；会话槽位显示有效 / 生成面数。"],
      ["覆盖已有面", "普通冠部/亭部切面允许覆盖旧面；整层消失时再次确认，台面、腰部或全部材料失效时仍会阻止。"],
    ],
    note: "Meet 拾取中第一次 Escape 只退出选择，第二次才取消 CUT；所有取消都不会写入历史。",
  },
  {
    id: "files",
    label: "文件与交换",
    eyebrow: "FILES & EXCHANGE",
    icon: IconFileDescription,
    title: "按用途选择正确的文件格式",
    intro: "完整保存、行业交换和工艺交付分别使用不同格式，避免把有损格式当作主文件。",
    facts: [
      ["本地恢复", "提交后的文档与材质会自动备份；文件菜单可恢复，刷新后会提示。草稿、相机与旧撤销历史不恢复，各页面互不覆盖。"],
      ["JSON", "完整主文件，保留文档、参数化图层、Meet 构造快照与光学元数据。"],
      ["GemCad ASC", "用于交换最终有效的 96 齿平面；Meet 构造意图和已被覆盖的工序会省略，导出前必须通过持久预检。"],
      ["PDF 技术报告", "输出最终有效面的五视图、逐面参数及 Meet 来源或失效说明，适合工艺交付。"],
      ["预设琢型", "来自公开来源、已经过格式与几何检查，可一键载入并撤销。"],
    ],
    note: "JSON、ASC、PDF 均只导出已提交文档，未保存预览不会被自动提交；需要继续编辑时优先保留 JSON。",
  },
  {
    id: "optics",
    label: "光学仿真",
    eyebrow: "OPTICS",
    icon: IconSparkles,
    title: "在不打断编辑现场的前提下检查光学表现",
    intro: "从显示模式进入聚焦仿真。系统会暂时收起 CUT 工具，只保留当前真实或预览实体。",
    steps: [
      ["01", "进入仿真", "打开显示模式，选择“光学仿真”。当前 CUT 会话会原样挂起。"],
      ["02", "设置材料", "选择材质预设，检查折射率、色散、体色与吸收。"],
      ["03", "切换观察", "使用台面、亭部、正视、侧视或透视检查亮度、火彩和结构。"],
      ["04", "返回编辑", "点击退出仿真或按 Escape，恢复进入前的完整编辑现场。"],
    ],
    note: "材质随文档保存并可撤销，载入预设后撤销也会恢复原材质；VIEW ONLY 参数仅影响当前观察环境。",
  },
  {
    id: "keys",
    label: "视口与快捷键",
    eyebrow: "VIEWPORT & KEYS",
    icon: IconKeyboard,
    title: "保持手在画布上完成高频操作",
    intro: "视口支持鼠标、触控板与键盘。数值输入聚焦时，快捷键不会误触 CUT 会话。",
    keys: [
      ["拖拽 / 方向键", "旋转宝石"],
      ["Shift + 拖拽", "平移画布"],
      ["滚轮 / + / -", "缩放视图"],
      ["0", "复位相机"],
      ["J / Shift + J", "下一 / 上一交点（不循环）"],
      ["Escape", "优先退出顶点选择；再次取消 CUT；光学中退出仿真"],
      ["Enter", "提交切型名称或行内参数"],
    ],
    note: "新建与编辑时，蓝色桥架调行业角，粉色直杆调深度，外圈和内圈分别调索引与镜像轴偏移。",
  },
];

function HelpContent({ section }) {
  return (
    <div className="help-content">
      <small>{section.eyebrow}</small>
      <h3>{section.title}</h3>
      <p>{section.intro}</p>

      {section.steps ? (
        <ol className="help-step-list">
          {section.steps.map(([number, title, description]) => (
            <li key={number}>
              <span>{number}</span>
              <div><strong>{title}</strong><p>{description}</p></div>
            </li>
          ))}
        </ol>
      ) : null}

      {section.facts ? (
        <dl className="help-fact-list">
          {section.facts.map(([term, description]) => (
            <div key={term}><dt>{term}</dt><dd>{description}</dd></div>
          ))}
        </dl>
      ) : null}

      {section.keys ? (
        <dl className="help-key-list">
          {section.keys.map(([keys, action]) => (
            <div key={keys}><dt>{keys}</dt><dd>{action}</dd></div>
          ))}
        </dl>
      ) : null}

      <aside className="help-note"><strong>NOTE</strong><span>{section.note}</span></aside>
    </div>
  );
}

export function HelpCenterDialog({ onClose }) {
  const [activeId, setActiveId] = useState("start");
  const closeButtonRef = useRef(null);
  const activeSection = HELP_SECTIONS.find((section) => section.id === activeId) ?? HELP_SECTIONS[0];
  const manualUrl = `${import.meta.env.BASE_URL}manual/facet-96-operation-manual.pdf`;

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop help-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        aria-describedby="help-dialog-summary"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-dialog__header">
          <div>
            <small>HELP CENTER · FACET 96</small>
            <h2 id="help-dialog-title">工作台使用帮助</h2>
            <p id="help-dialog-summary">从第一个切面到光学检查，按任务快速找到答案。</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭帮助中心">
            <IconX size={17} stroke={1.8} />
          </button>
        </header>

        <div className="help-dialog__body">
          <nav aria-label="帮助主题">
            {HELP_SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = section.id === activeId;
              return (
                <button
                  type="button"
                  className={active ? "is-active" : ""}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setActiveId(section.id)}
                  key={section.id}
                >
                  <Icon size={15} stroke={1.7} />
                  <span>{section.label}</span>
                  <IconChevronRight size={13} stroke={1.7} />
                </button>
              );
            })}
          </nav>
          <HelpContent section={activeSection} />
        </div>

        <footer className="help-dialog__footer">
          <div><IconBook2 size={16} stroke={1.7} /><span><strong>完整操作手册</strong><small>A4 PDF · 图解工作流 · 可打印</small></span></div>
          <a className="secondary-button help-manual-link" href={manualUrl} download>
            <IconDownload size={15} stroke={1.8} />下载 PDF
          </a>
          <button type="button" className="primary-action help-close-action" onClick={onClose}>返回工作台</button>
        </footer>
      </section>
    </div>
  );
}
