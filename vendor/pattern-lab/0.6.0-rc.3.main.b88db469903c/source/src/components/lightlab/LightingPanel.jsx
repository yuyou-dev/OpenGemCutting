import { IconEye, IconEyeOff, IconInfoCircle } from '@tabler/icons-react';
import { Dome } from './Dome.jsx';

function ObservationGuide({ state }) {
  const kind = state.environment.observation.kind;
  return <div className="lightlab-observation-guide"><h3>观察环境</h3><p>{kind === 'hearts' ? '环形白光与红色侧向照明。心箭图样由当前切面形成。' : kind === 'aset' ? '按观察轴编码入射方向，查看各角域的入射光贡献。' : '红色观察环境、黑色观察孔与背面照明，用于观察方向来源和漏光分布。'}</p>
    {kind === 'aset' && <dl><div><dt>蓝 · 轴向对比区</dt><dd>0–15°</dd></div><div><dt>红 · 中角区</dt><dd>15–45°</dd></div><div><dt>绿 · 近水平区</dt><dd>45–90°</dd></div></dl>}
    <p>正面轴向适合比较；可自由倾斜观察图样变化。此参考模拟不提供切工或心箭评级。</p>
    <a target="_blank" rel="noreferrer" href={kind === 'hearts' ? 'https://files.octonus.com/documents/Article3_HA_Lighting_specs.pdf' : kind === 'aset' ? 'https://www.gia.edu/dam/jcr:c55bd12f-5d87-411d-b535-c652320ebdde/GG-SU13-Gilbertson.pdf' : 'https://ideal-scope.com/light-return-shadows/'}>查看研究来源</a>
  </div>;
}

/** Read-only lighting panel: builtin preset picker, light list with
 * eye/solo/select, and the angle dome for dragging the selected light. */
export function LightingPanel({ api, state }) {
  const observation = state.environment.observation.kind !== 'none';
  const knownPreset = state.projects.some(p => p.id === state.activeProjectId);
  return (
    <aside className="side-panel lightlab-left-panel" aria-label="布光">
      <div className="design-section-heading"><h2>布光</h2><span className="section-meta">{observation ? '观察环境' : `${state.environment.lights.length} 盏灯`}</span></div>
      <label className="select-field"><span>布光预设</span>
        <select aria-label="布光预设" value={state.activeProjectId} onChange={(e) => api.loadProject(e.target.value)}>
          {!knownPreset && <option value={state.activeProjectId}>当前布光（已修改）</option>}
          {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {state.libraryError && <p className="lightlab-error" role="alert">{state.libraryError}</p>}
      {observation ? (
        <ObservationGuide state={state} />
      ) : (
        <>
          <div className="lightlab-light-list" role="group" aria-label="光源列表">
            {state.environment.lights.length ? state.environment.lights.map(light => <div key={light.id} className={`lightlab-light-row${state.selectedLightId === light.id ? ' selected' : ''}${light.enabled ? '' : ' disabled'}`}>
              <button className="lightlab-light-eye" aria-label={`${light.enabled ? '隐藏' : '显示'} ${light.name}`} title={`${light.enabled ? '隐藏' : '显示'} ${light.name}`} onClick={() => api.toggleLight(light.id)}>{light.enabled ? <IconEye size={18} /> : <IconEyeOff size={18} />}</button>
              <button className="lightlab-light-select" aria-pressed={state.selectedLightId === light.id} aria-label={`选择 ${light.name}`} title={`${light.name} · 方位 ${light.azimuth.toFixed(1)}° / 仰角 ${light.elevation.toFixed(1)}°`} onClick={() => api.selectLight(light.id)}><strong>{light.name}</strong><small>{light.blocker ? '黑卡' : `${light.ev.toFixed(1)} EV`}</small></button>
              <button className={`lightlab-solo${state.environment.solo === light.id ? ' active' : ''}`} aria-label={`独显 ${light.name}`} aria-pressed={state.environment.solo === light.id} onClick={() => api.soloLight(light.id)}>独显</button>
            </div>) : <div className="lightlab-empty">只有环境底光。选择摄影布光预设查看灯具。</div>}
          </div>
          <div className="design-section-heading"><h2>角度穹顶</h2><div className="segment lightlab-hemisphere" role="group" aria-label="灯光所在半球">{[['upper', '上半球'], ['lower', '下半球']].map(([id, label]) => <button key={id} className={state.hemisphere === id ? 'active' : ''} aria-pressed={state.hemisphere === id} onClick={() => api.setHemisphere(id)}>{label}</button>)}</div></div>
          <Dome api={api} state={state} />
          <p className="lightlab-dome-caption">拖动灯点定位 · 方向键微调 · Shift 加速</p>
        </>
      )}
      <p className="lightlab-scope-note"><IconInfoCircle size={16} />布光仅作用于光学验证画面</p>
    </aside>
  );
}
