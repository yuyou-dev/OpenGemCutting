import { Modal } from './Modal.jsx';
import { Button } from '../controls.jsx';

export function EditResultDialog({ controller, snap }) {
  const review = snap.modal.kind === 'edit-review';
  const result = review ? snap.pendingEdit : snap.editFeedback;
  if (!result) return null;
  return <Modal controller={controller} title={review ? '确认切面变化' : '本次几何变化'} large footer={review ? <>
    <Button label="取消这次修改" onClick={() => controller.closeModal()} />
    <Button label="应用修改" onClick={() => controller.confirmEdit()} />
  </> : undefined}>
    {review && <p>这次修改将使以下 {result.lost?.length ?? 0} 个基础切面消失。画布展示的是待应用预览，确认后记为一步撤销。</p>}
    <dl className="edit-result-metrics">
      <div><dt>联动面</dt><dd>{result.changedPlanes?.length ?? 0}</dd></div>
      <div><dt>最大切角变化</dt><dd>{(result.maxAngleDelta ?? 0).toFixed(4)}°</dd></div>
      <div><dt>交点变化</dt><dd>{result.deltaV > 0 ? '+' : ''}{result.deltaV ?? 0}</dd></div>
      <div><dt>棱线变化</dt><dd>{result.deltaE > 0 ? '+' : ''}{result.deltaE ?? 0}</dd></div>
    </dl>
    <p>消失切面：{result.lost?.join('、') || '无'}；新增有效切面：{result.gained?.join('、') || '无'}。</p>
    <p className="field-note">几何数值残差 {(result.residualMm ?? 0).toExponential(2)} mm，不代表机台制造精度。求解与复核 {result.solveMs?.toFixed(1) ?? '—'} ms。</p>
    <div className="edit-change-table"><table><thead><tr><th>切面</th><th>原切角</th><th>新切角</th><th>偏移变化</th></tr></thead><tbody>
      {result.changedPlanes?.map(p => <tr key={p.id}><td>{p.id}</td><td>{p.fromAngle.toFixed(4)}°</td><td>{p.toAngle.toFixed(4)}°</td><td>{p.offsetDelta.toPrecision(5)}</td></tr>)}
    </tbody></table></div>
  </Modal>;
}
