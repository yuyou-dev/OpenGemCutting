import { Button, NumberSlider, Icon } from './controls.jsx';

export function SurfaceConsole({ controller, snap }) {
  const faces = snap.compiled.faces.filter(face => snap.selectedIds.includes(face.id) && !face.stock);
  const crown = snap.bevelPolicies.crown, pavilion = snap.bevelPolicies.pavilion;
  const frosted = faces.filter(face => face.finish.state === 'frosted').length;
  const single = faces.length === 1 ? faces[0] : null;
  const setFinish = state => single && snap.selectedIds.length === 1 ? controller.setSelectedFinish(state) : controller.setFinishFor(faces.map(face => face.id), state);
  return <section className="surface-console" aria-label="表面控制台">
    <h2>表面控制台</h2>
    <div className="finish-console-card">
    <div className="surface-selection-heading"><strong>{faces.length ? `已选 ${faces.length} 个切面` : '选择切面以设置表面'}</strong><span>{faces.length ? `磨砂 ${frosted} · 抛光 ${faces.length - frosted}` : '单选或多选'}</span></div>
    <div className="finish-actions" role="group" aria-label="所选切面表面处理">
      {[['frosted','磨砂','vertex'],['polished','抛光','face']].map(([state,label,icon]) => <button type="button" key={state} disabled={!faces.length} aria-pressed={faces.length > 0 && (state === 'frosted' ? frosted === faces.length : frosted === 0)} onClick={() => setFinish(state)}><Icon name={icon} />{label}</button>)}
      <Button label="反转" icon="undo" disabled={!faces.length} title="逐面反转所选切面的磨砂与抛光状态" onClick={() => controller.invertFinishFor(faces.map(face => face.id))} />
    </div>
    </div>
    <div className="bevel-console"><h3>磨砂细边 <span>（全局 · 按区域设置）</span></h3>
      <div className="shared-bevel-fields">
        <NumberSlider label="宽度" value={crown.shoulderMm === pavilion.shoulderMm ? crown.shoulderMm : ''} placeholder="不同" min={0.004} max={0.06} step={0.001} unit="mm" onCommit={v => controller.setBevelShoulder(v, 'both')} />
      </div>
      <div className="bevel-apply-switches">
      { [['crown','冠部'],['pavilion','亭部']].map(([side,label]) => {
        const bevel = snap.bevelPolicies[side];
        return <button key={side} type="button" className="bevel-switch" role="switch" aria-checked={bevel.enabled} aria-label={`${label}应用`} onClick={() => controller.setBevelEnabled(!bevel.enabled,side)}><span className="switch-track" /><span>{label}应用</span></button>;

      })}
      </div>
      {snap.compiled.audit.mmPerUnit === null && <Button className="subtle small" label="先标定尺寸以设置毫米细边" onClick={() => controller.openModal('scale')} />}
    </div>
  </section>;
}
