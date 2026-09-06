import { useRef, useState } from "react";
import { useDialogFocus } from "./useDialogFocus.js";
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
    id: "start", label: "快速开始", eyebrow: "START HERE", icon: IconSparkles,
    title: "从项目主页开始你的下一版设计",
    intro: "先想清楚这一版要改变什么：冠部更平缓、刻面会合更整齐，还是四个方向有不同节奏。一次比较一个变化，更容易判断取舍。",
    steps: [
      ["01", "打开或创建项目", "启动后先到项目主页。搜索项目名称并点击卡片继续，或用“新建项目”进入工作台。已有本地备份会迁入项目列表，原备份仍保留。"],
      ["02", "找到接近想法的切型", "文件 → 浏览预设琢型，用外形、有效面数和 L/W 长宽比缩小范围，也可组合名称、作者或来源关键词。逐页比较四视图，载入并命名；先导出 JSON 留住基准版。"],
      ["03", "改变一个设计要素", "右侧 CUT STACK 列出设计步骤，内容多时可滚动。点击图层旁的“编辑”，在左侧调角度或深度；想增加一组刻面，则用列表底部的新建入口。"],
      ["04", "同时比较几个方向", "右侧下方提供实时正交预览：上窗切“冠部”看顶视、切“亭部”看底视，下窗看侧面比例。满意后在 CUT STACK 保存，再用显示模式里的光学仿真观察材质。"],
    ],
    note: "项目主页、编辑工作台与光学实验室沿用同一界面规范。回主页或去实验室会保留本页编辑现场，不会替你保存 CUT；切换到另一项目或刷新时，未保存预览不作为项目内容恢复。",
  },
  {
    id: "cut", label: "切割工作流", eyebrow: "CUT WORKFLOW", icon: IconTool,
    title: "让刻面在你希望的位置会合",
    intro: "先决定刻面应经过哪里，再选择合适的定位方式。普通切割用于自由试形，Meet 用于保持会合位置，Jump 帮你逐个比较现成的交点。",
    facts: [
      ["修改已有刻面", "点击图层旁的“编辑”；名称用于改名，参数和面数也保留快捷入口。保存替换原工序，放弃则回到修改前。"],
      ["塑造比例", "角度改变刻面的倾斜，深度改变切入位置。冠部／亭部的“整体变换”可一起调整高度、升降与旋转；先看轮廓，再比较细节。"],
      ["重复与镜像", "用重复建立均匀节奏，用镜像增加成对关系。96 分度的一齿是 3.75°；主切面是当前操纵杆与 Meet 所参考的那一面。"],
      ["一个固定会合点", "选实体顶点并“锁定 Meet A”，再试角度；目标可达时深度会跟着调整，让主切面继续经过 A。想自由调深度时先解除约束。"],
      ["比较沿棱位置", "选一条真实棱，比较 ⅓ 与 ⅔ 等比例位置，观察新增刻面如何分配。完成比例调整后锁定 A；0、1 是棱的两个端点。"],
      ["用第二点定角度", "在单 A 后选择 B，并“锁定 B · 双 Meet”，当前主分度可解时，系统同时确定角度与深度。不可达可换点或主分度。解除 B 留下 A；解除 A 会把 B 提升为 A。"],
      ["逐个尝试交点", "点击“下一交点”预览候选；有 A 后则浏览第二点。金色预告不移动切面，锁定仍需保存；双 Meet 锁定后停止 Jump。"],
      ["做有意的方向变化", "在自定义索引中保留希望切割的方向，并明确选择其中一个主分度。可用手册的四向装饰案例，与八向均匀节奏比较。"],
      ["找出要修的会合关系", "看到 Meet 失效时，用更多工具的“逐层试切助理”查看来源与切割前后。返回对应层编辑，解除失效约束并重新选点；已保存切面不会自动连带变化。"],
      ["保留施工意图", "“预形工序”标记这一刀的用途，仍会参与切割与面数统计。Meet / Jump 支持冠部／亭部，腰部和固定台面保持原角度限制。"],
    ],
    note: "先看新增刻面是否实际形成、是否覆盖了你想保留的形状，再点击“加入序列／保存”。仅接触且有效 0 面不能保存；覆盖已有面需检查影响，不代表一律禁止。",
  },
  {
    id: "files", label: "文件与交换", eyebrow: "FILES & EXCHANGE", icon: IconFileDescription,
    title: "留住设计变体 再交给下一位协作者",
    intro: "先给设计起一个能区分版本的名字，例如“圆形 低冠方案”。保留能继续编辑的主文件，再按协作需要导出工艺资料。",
    facts: [
      ["继续设计用 JSON", "保留已保存图层、A/B、棱点比例、主分度、预形用途与材质。比较方案前后分别保存一份，也用它跨电脑交接。"],
      ["继续本地项目", "已提交图层与材质会自动保存到当前项目，刷新后从主页点击原卡片继续，不会新建副本。只保存已提交设计；草稿、相机与旧撤销历史不跨刷新恢复。"],
      ["保留旧设计", "升级前的本地备份会一次性迁入项目，原备份仍可从文件菜单恢复。再次打开不会覆盖项目的新修改；删除迁入项目也不会让同一备份再次出现。"],
      ["返回或切换项目", "返回主页后“继续当前设计”可保留本页草稿与撤销历史；切换另一项目或新建时，会先确认是否放弃未保存预览，并为打开的项目重新建立撤销历史。"],
      ["讨论工艺用 PDF", "导出当前切型的工艺报告，查看真实视图、有效刻面参数及 Meet 来源。报告用于阅读与沟通，不能代替 JSON 继续编辑。"],
      ["与 GemCad 交换", "ASC 交换最终有效切面与折射率，不保留 Meet 构造意图和预形用途。先阅读预检，确认齿轮映射、比例与省略内容。"],
      ["从练习到自己的作品", "手册中的案例 JSON 可作为练习起点；理解每次变化后，再在自己的切型上比较。练习参数不代表所有宝石都适用。"],
    ],
    note: "JSON、ASC、PDF 都只导出已保存的设计，预览不会自动提交。本地项目只属于当前浏览器和站点地址，不能代替长期归档。保存失败时请重试或导出 JSON，不能把未成功写入的内容当作已保存。",
  },
  {
    id: "optics", label: "光学仿真", eyebrow: "OPTICS", icon: IconSparkles,
    title: "在同样的观察条件下比较两个方案",
    intro: "先明确要观察什么：台面下的亮暗分布、转动时的闪光节奏，或侧面的体色。保持材质、环境和视角一致，才方便比较几何变化。",
    steps: [
      ["01", "进入观察", "显示模式 → 光学仿真。当前保存或预览形状会进入仿真，切割工具暂时收起。"],
      ["02", "选定材质与环境", "选择材质预设，确认体色、折射率等设置；先固定环境和观察角度，再比较不同切型。"],
      ["03", "比较并记录取舍", "在画布左上切换台面、亭部、正视和透视，再转动宝石。记录哪种变化更符合设计目标，不只凭某一帧的亮度决定。"],
      ["04", "返回继续设计", "退出仿真或按 Escape，回到原编辑现场。需要留住当前造型时，回到工作台再保存。"],
    ],
    note: "主页和编辑页另有“光学实验室”入口，v0.8.0 只提供保留当前项目的空白页面，实验工具准备中。现有光学仿真继续从显示模式进入；仿真不保证实际切磨表现，VIEW ONLY 观察设置不写入项目。",
  },
  {
    id: "keys", label: "视口与快捷键", eyebrow: "VIEWPORT & KEYS", icon: IconKeyboard,
    title: "先看清目标 再动手调整",
    intro: "选点前先旋转宝石，让目标棱或顶点清楚可见。粉色切面边框、圆环与机械臂是操作辅助，不是宝石的真实棱。",
    facts: [
      ["同时看冠亭与侧面", "右侧两窗同步展示当前真实或预览造型。冠部／亭部按钮只切换上窗观察方向，不会旋转中央画布或修改切割。正交视图适合核对轮廓、刻面分布与冠亭比例。"],
      ["返回项目与反馈", "顶部可返回项目主页或进入光学实验室。“GitHub 仓库”始终保留，三个页面和光学仿真均可使用；点击在新标签页打开 OpenGemCutting，当前设计留在原页。"],
    ],
    keys: [
      ["拖拽 / 方向键", "旋转宝石，查看背面的刻面关系"],
      ["Shift + 拖拽", "平移画布，把要看的细节移到中间"],
      ["滚轮 / + / -", "缩放查看会合点与整体轮廓"],
      ["0", "复位相机"],
      ["J / Shift + J", "浏览下一个／上一个交点；有 A 时浏览第二点"],
      ["V", "进入或退出顶点选择"],
      ["M / B", "锁定当前 A／第二点 B 候选"],
      ["行内参数框 Enter", "编辑已有图层时，在行内参数框提交当前修改"],
      ["Escape", "先退出当前浮层或选择工具，再退出预览或编辑"],
    ],
    note: "按 Escape 退出棱比例工具时会保留当前候选；退出 B 预览才恢复原单 A 参数。输入框中的快捷键不会误操作底层 CUT；拿不准时使用界面的文字按钮。",
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

      <aside className="help-note"><strong>使用提示</strong><span>{section.note}</span></aside>
    </div>
  );
}

export function HelpCenterDialog({ onClose }) {
  const [activeId, setActiveId] = useState("start");
  const panelRef = useRef(null);
  const activeSection = HELP_SECTIONS.find((section) => section.id === activeId) ?? HELP_SECTIONS[0];
  const manualUrl = `${import.meta.env.BASE_URL}manual/facet-96-operation-manual.pdf`;

  useDialogFocus(panelRef, onClose);

  return (
    <div className="modal-backdrop help-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        tabIndex={-1}
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
            <p id="help-dialog-summary">从设计目标到造型比较，按任务找到下一步。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭帮助中心">
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
          <div><IconBook2 size={16} stroke={1.7} /><span><strong>完整操作手册</strong><small>A4 PDF · 设计案例与前后对比 · 可打印</small></span></div>
          <a className="secondary-button help-manual-link" href={manualUrl} download>
            <IconDownload size={15} stroke={1.8} />下载 PDF
          </a>
          <button type="button" className="primary-action help-close-action" onClick={onClose}>返回工作台</button>
        </footer>
      </section>
    </div>
  );
}
