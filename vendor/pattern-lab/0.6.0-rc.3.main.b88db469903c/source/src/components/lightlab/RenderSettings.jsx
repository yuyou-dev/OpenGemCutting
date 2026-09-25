import { ComparisonDialog, NumberField, SelectField, ColorField, Toggle } from './Fields.jsx';

export function RenderSettings({ api, state, onClose }) {
  const r = state.render, choices = state.renderChoices, ranges = state.renderRanges;
  const observation = state.environment.observation.kind !== 'none';
  return <ComparisonDialog title="LightLab 成像设置" subtitle="仅作用于光学验证画面" onClose={onClose}>
    <section className="lightlab-settings-section"><h3>追迹质量</h3>
      {observation ? <p className="lightlab-note">观察环境固定使用无色 D 线。</p> : <SelectField label="色散求解" value={r.spectral} onChange={spectral => api.setRender({ spectral })}><option value="rgb">3 波段 · 实时预览</option><option value="spectral">12 波段积分 · 精细近似</option><option value="mono">D 线单色 · 无色散</option></SelectField>}
      <SelectField label="界面事件上限" value={r.maxBounces} onChange={maxBounces => api.setRender({ maxBounces: Number(maxBounces) })}>{choices.maxBounces.map(value => <option key={value} value={value}>{value} 次</option>)}</SelectField>
      <SelectField label="像素采样" value={r.targetSamples} onChange={targetSamples => api.setRender({ targetSamples: Number(targetSamples) })}>{choices.targetSamples.map(value => <option key={value} value={value}>{value} SPP</option>)}</SelectField>
      <SelectField label="渲染高度" value={r.resolution} onChange={resolution => api.setRender({ resolution: Number(resolution) })}>{choices.resolution.map(value => <option key={value} value={value}>{value} px</option>)}</SelectField>
      <Toggle label="光源采样与 MIS" checked={r.nee} onChange={nee => api.setRender({ nee })} note="结合光源方向和表面采样，降低噪点。" /><Toggle label="引导降噪显示" checked={r.denoise} onChange={denoise => api.setRender({ denoise })} note="关闭后查看原始样本。" />
    </section>
    <section className="lightlab-settings-section"><h3>显示变换</h3>
      {observation ? <p className="lightlab-note">观察参考颜色不经过曝光和色调映射。</p> : <><NumberField label="曝光" value={r.exposure} min={ranges.exposure[0]} max={ranges.exposure[1]} step={.05} unit="EV" slider onChange={exposure => api.setRender({ exposure })} /><SelectField label="色调映射" value={r.toneMapping} onChange={toneMapping => api.setRender({ toneMapping })}><option value="aces">ACES 拟合 · 展示</option><option value="reinhard">Reinhard · 高光压缩</option><option value="linear">线性裁切 · 核对</option></SelectField></>}
      <ColorField label="画布背景" value={r.background} onChange={background => api.setRender({ background })} />
      {!observation && <><Toggle label="启用头部遮挡" checked={r.headEnabled} onChange={headEnabled => api.setRender({ headEnabled })} /><NumberField label="遮挡锥半角" value={r.headAngle} min={ranges.headAngle[0]} max={ranges.headAngle[1]} step={.5} unit="°" disabled={!r.headEnabled} onChange={headAngle => api.setRender({ headAngle })} /></>}
      <Toggle label="刻面边线" checked={r.showEdges} onChange={showEdges => api.setRender({ showEdges })} />
    </section>
  </ComparisonDialog>;
}
