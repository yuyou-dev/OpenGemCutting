import { Icon } from './controls.jsx';

const TOOLS = [
  ['select', '选择', '选择切面 · Shift 多选'],
  ['vertex', '点', '移动交点'],
  ['edge', '线', '平移棱线'],
  ['face', '面', '调整切面位置'],
  ['merge', '合并', '将第一个交点合并到第二个交点'],
];

export function ToolRail({ controller, snap }) {
  return (
    <nav className="tool-rail" aria-label="编辑工具">
      <div className="tool-rail-main">
        {TOOLS.map(([tool, label, title]) => (
          <button
            key={tool}
            type="button"
            className={`tool-button${snap.editTool === tool ? ' active' : ''}${tool === 'merge' ? ' tool-separated' : ''}`}
            aria-label={`${label}工具`}
            aria-pressed={snap.editTool === tool}
            title={title}
            onClick={() => controller.setEditTool(tool)}
          >
            <Icon name={tool} size={23} stroke={1.5} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
