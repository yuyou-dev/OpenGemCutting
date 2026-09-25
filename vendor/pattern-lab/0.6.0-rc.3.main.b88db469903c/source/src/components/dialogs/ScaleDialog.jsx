import { useState } from 'react';
import { Modal } from './Modal.jsx';
import { Button } from '../controls.jsx';

export function ScaleDialog({ controller, snap }) {
  const dimensions = snap.physicalDimensions;
  const [width, setWidth] = useState(dimensions.millimetres ? String(dimensions.millimetres[0]) : '');
  const value = Number(width), valid = width.trim() !== '' && Number.isFinite(value) && value > 0;
  const preview = valid ? dimensions.units.map(unit => unit * value / dimensions.units[0]) : null;
  return <Modal controller={controller} title="标定实际尺寸" subtitle="毫米尺度 · 仅保存到当前实验稿" className="scale-dialog"
    footer={<><Button label="取消" onClick={() => controller.closeModal()} /><Button className="primary" label="应用标定" disabled={!valid} onClick={() => {
      if (controller.calibrateWidth(value)) controller.closeModal();
    }} /></>}>
    <p>输入实物在共同切割参考系中沿 X 轴的测量宽度。平面图中为左右方向；请勿将模型单位当成毫米。</p>
    <label className="scale-width-field">实测 X 向宽度（mm）<input type="number" inputMode="decimal" min="0" step="any" value={width} placeholder="输入实测值" onChange={event => setWidth(event.target.value)} /></label>
    <dl className="scale-preview">{['X 向宽度', 'Y 向长度', 'Z 向高度'].map((label, index) => <div key={label}><dt>{label}</dt><dd>{preview ? `${preview[index].toFixed(3)} mm` : '待标定'}</dd></div>)}</dl>
    <p className="field-note">仅建立毫米与原坐标的比例，原始来源保持不变。标定可撤销，保存后可恢复；已有细边会按其毫米肩宽重新核算。</p>
    <p className="field-note">没有实测尺寸时，可以继续查看、选择和返回现有几何。点线面编辑、磨砂细边生成和光学验证需要先标定。</p>
  </Modal>;
}
