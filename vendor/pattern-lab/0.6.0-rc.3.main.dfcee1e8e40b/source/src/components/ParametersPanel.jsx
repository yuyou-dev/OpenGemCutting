import { memo, useEffect, useRef, useState } from 'react';
import { facetGroups } from '../ui/format.js';
import { Icon, Button, IconButton, Note, Toggle, DeferredNumber } from './controls.jsx';

function FacetForm({ controller, snap }) {
  const m = snap.selectedMachine;
  const face = snap.selectedFace;
  const [draft, setDraft] = useState({ index: m?.index ?? 0, angle: m?.angle.toFixed(4) ?? '0', offset: face?.offset.toFixed(8) ?? '0' });

  useEffect(() => {
    if (!snap.selectedMachine || !snap.selectedFace) return;
    setDraft({ index: snap.selectedMachine.index, angle: snap.selectedMachine.angle.toFixed(4), offset: snap.selectedFace.offset.toFixed(8) });
  }, [snap.selectedFaceId, snap.plan]);

  if (!face || !m || !snap.selectedIds.length) return <p className="empty-inline">选择一个切面后查看切磨参数。</p>;
  if (snap.selectedIds.length > 1) return <p className="empty-inline">切磨参数需单选切面后调整。</p>;
  const editable = snap.selectedEditable;
  return (
    <>
      <p className="field-note">当前切面 <code>{snap.selectedFaceId}</code> · 这些数值会改变三维切割平面。</p>
      <div className="facet-fields">{[
        ['index', '分度读数', snap.plan.machine.mode==='exact'?0.001:1, 0, snap.plan.machine.teeth, `/ ${snap.plan.machine.teeth}`],
        ['angle', '切割角度', 0.01, 0, 90, '°'],
        ['offset', '平面偏移 d', 0.0001, undefined, undefined, ''],
      ].map(([key, label, step, min, max, unit]) => (
        <div className="field compact" key={key}>
          <div className="field-top"><label htmlFor={`facet-${key}`}>{label}</label><div className="numeric">
            <input id={`facet-${key}`} aria-label={label} type="number" min={min} max={max} step={step} value={draft[key]} disabled={!editable} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
            {unit ? <span>{unit}</span> : null}
          </div></div>
        </div>
      ))}</div>
      <Button className="apply-facet" label="应用切磨参数" disabled={!editable} onClick={() => controller.applyFacet(draft)} />
      <p className="field-note">{snap.selectedHelp}</p>
    </>
  );
}

export function SelectedProperties({ controller, snap }) {
  const selection = snap.editSelection;
  const settings = snap.editSettings ?? { lockOutline: true, symmetry: false, stepMm: 0.01 };
  const hasFaces = snap.selectedIds.length > 0;
  const title = selection
    ? `已选${{ vertex: '交点', edge: '棱线', face: '切面' }[selection.kind]}`
    : hasFaces ? snap.selectedIds.length > 1 ? `已选 ${snap.selectedIds.length} 个切面` : '已选切面' : '开始编辑';
  return (
    <section className="selection-properties" aria-label="当前对象属性">
      <div className="selection-heading"><h2>{title}</h2>
        {selection?.boundary ? <span className="tag">轮廓</span> : null}
        {hasFaces && snap.selectedIds.length === 1 && (!selection || selection.kind === 'face') ? <code className="small-code">{snap.selectedFaceId}</code> : null}
      </div>
      {selection ? (
        <>
          <p className="field-note">{selection.kind === 'face' ? '拖动面内调整位置，拖动边界点或线改变轮廓。' : '拖动选中位置调整图案。'}方向键按步长微调，邻面会自动协调。</p>
          {snap.compiled.audit.mmPerUnit === null ? <p className="field-note">坐标仍为模型单位；标定后显示 X / Y 毫米位置。</p> : <div className="position-fields">
            <DeferredNumber label="X" value={Number(selection.xMm?.toFixed(4)??0)} step={settings.stepMm} unit="mm" disabled={snap.compiled.audit.mmPerUnit===null} onCommit={(v) => controller.setSelectionPosition(v, selection.yMm)} />
            <DeferredNumber label="Y" value={Number(selection.yMm?.toFixed(4)??0)} step={settings.stepMm} unit="mm" disabled={snap.compiled.audit.mmPerUnit===null} onCommit={(v) => controller.setSelectionPosition(selection.xMm, v)} />
          </div>}
          <div className="nudge-row">
            <span>微调</span>
            <div className="nudge-buttons" aria-label="微调选中对象">
              <IconButton icon="left" label="向左微调" onClick={() => controller.nudgeSelection(snap.planSide === 'pavilion' ? 1 : -1, 0)} />
              <IconButton icon="right" label="向右微调" onClick={() => controller.nudgeSelection(snap.planSide === 'pavilion' ? -1 : 1, 0)} />
              <IconButton icon="up" label="向上微调" onClick={() => controller.nudgeSelection(0, 1)} />
              <IconButton icon="down" label="向下微调" onClick={() => controller.nudgeSelection(0, -1)} />
            </div>
          </div>
        </>
      ) : !hasFaces ? (
        <p className="selection-empty">在画布上选择点、线或面，查看位置并精细调整。</p>
      ) : null}
      {selection?.kind === 'face' || (!selection && hasFaces) ? <div className="cutting-properties"><h3>切磨参数</h3><FacetForm controller={controller} snap={snap} /></div> : null}
      {snap.editTool === 'merge' ? <p className="field-note">{snap.mergePendingKey ? '已选起点 A，再选择目标 B。' : '依次选择两个相邻交点，将前者并入后者。'}</p> : null}
      {snap.editFeedback?.text ? <p className={`selection-feedback${snap.editFeedback.blocked ? ' is-limited' : ''}`}>{snap.editFeedback.text}</p> : null}
    </section>
  );
}

function ReferenceSettings({ controller, snap }) {
  const refFile = useRef(null);
  return (
    <>
      <Button icon="photo" label={snap.hasReference ? '更换参考图' : '选择本地图片'} onClick={() => { refFile.current.value = ''; refFile.current.click(); }} />
      <input ref={refFile} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => controller.loadReference(e.target.files?.[0])} />
      {snap.hasReference ? (
        <>
          {[
            ['opacity', '不透明度', 0, 1, 0.01, snap.refParams.opacity.toFixed(2)],
            ['scale', '缩放', 0.2, 3, 0.01, `${snap.refParams.scale.toFixed(2)}×`],
            ['rotation', '旋转', -180, 180, 1, `${snap.refParams.rotation.toFixed(0)}°`],
          ].map(([key, label, min, max, step, formatted]) => (
            <div className="field" key={key}>
              <div className="field-top"><label htmlFor={`reference-${key}`}>{label}</label><code className="range-value">{formatted}</code></div>
              <input id={`reference-${key}`} className="range" aria-label={`参考图${label}`} type="range" min={min} max={max} step={step} value={snap.refParams[key]} style={{ '--value': `${((snap.refParams[key] - min) / (max - min)) * 100}%` }} onChange={(e) => controller.setRefParam(key, e.target.value)} />
            </div>
          ))}
          <Toggle label="拖动参考图" checked={snap.refDrag} onChange={(v) => controller.setRefDrag(v)} note="开启后拖动画布可移动图片。" />
          <div className="ref-offset-row">
            <Button className="subtle small" label="复位位置" onClick={() => controller.resetRefPosition()} />
            {snap.refParams.x !== 0 || snap.refParams.y !== 0 ? <code className="small-code">x {snap.refParams.x.toFixed(3)} · y {snap.refParams.y.toFixed(3)}</code> : null}
          </div>
        </>
      ) : null}
      <Note>参考图只用于描图与对齐，不改变几何；仅在当前会话保留。</Note>
    </>
  );
}

function GroupCheck({ checked, mixed, label, onChange }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" checked={checked} aria-checked={mixed ? 'mixed' : checked} aria-label={label} onChange={onChange} />;
}

const FacetList = memo(function FacetList({ controller, rows, selectedIds, selectedFaceId, multiSelectMode, region, search }) {
  const [expanded, setExpanded] = useState({});
  const groups = facetGroups(rows, region);
  return <div className="face-list grouped-faces" aria-label="分组切面清单">
    {groups.map((group, index) => {
      const key = `${region}:${group.name}`;
      const count = group.rows.filter(row => selectedIds.includes(row.id)).length;
      const open = !!search || (expanded[key] ?? index < 2);
      return <section className="facet-group" key={key} aria-label={group.name}>
        <div className="facet-group-heading">
          <button className="group-disclosure" type="button" aria-label={`${open ? '折叠' : '展开'} ${group.name}`} aria-expanded={open} onClick={() => setExpanded(previous => ({ ...previous, [key]: !open }))}><Icon name="chevron" size={13} /></button>
          <GroupCheck label={`选择 ${group.name} 组`} checked={count === group.rows.length} mixed={count > 0 && count < group.rows.length} onChange={() => controller.toggleFaceGroup(group.rows.map(row => row.id))} />
          <button type="button" aria-expanded={open} onClick={() => setExpanded(previous => ({ ...previous, [key]: !open }))}>
            <strong>{group.name}</strong><span>· {group.rows.length} 面</span>
          </button>
          <span className="group-count">{count} / {group.rows.length} 已选</span>
        </div>
        {open && <div role="group" aria-label={`${group.name} 切面`}>
          <div className="facet-columns" aria-hidden="true"><span /><span>#</span><span>角度</span><span>表面处理</span></div>
          {group.rows.map(row => <div key={row.id} className={`facet-row${selectedIds.includes(row.id) ? ' active' : ''}${row.id === selectedFaceId ? ' current' : ''}`}>
            <input type="checkbox" aria-label={`选择切面 ${row.id}`} checked={selectedIds.includes(row.id)} onChange={() => controller.toggleSelect(row.id)} />
            <button type="button" title={row.id} aria-label={`切面 ${row.id}`} aria-pressed={selectedIds.includes(row.id)} onClick={e => e.shiftKey || multiSelectMode ? controller.toggleSelect(row.id) : controller.select(row.id)}>
              <span className="name">{row.id.startsWith(group.name + ':') ? row.id.slice(group.name.length + 1) : row.id}</span><span className="value">{row.angle.toFixed(2)}°</span><span className={`tag ${row.finish}`}>{row.finish === 'frosted' ? '磨砂' : '抛光'}</span>
            </button>
          </div>)}
        </div>}
      </section>;
    })}
    {!groups.length && <p className="empty-inline">此部位没有匹配的切面。</p>}
  </div>;
});

export function ParametersPanel({ controller, snap }) {
  const [page, setPage] = useState('facets');
  const [region, setRegion] = useState(snap.planSide);
  useEffect(() => setRegion(snap.planSide), [snap.planSide]);
  const drawerRef = useRef(null);
  useEffect(() => {
    if (snap.drawerOpen !== 'left' || !window.matchMedia('(max-width: 1000px)').matches) return;
    const trigger = document.activeElement;
    drawerRef.current.querySelector('button').focus({ preventScroll: true });
    return () => trigger.focus({ preventScroll: true });
  }, [snap.drawerOpen]);
  return (
    <aside ref={drawerRef} className={`side-panel design-panel${snap.drawerOpen === 'left' ? ' open' : ''}`} aria-label="设计设置">
      <div className="inspector-mobile-heading"><strong>设计设置</strong><IconButton icon="close" label="关闭设计设置" onClick={() => controller.closeDrawers()} /></div>
      <div className="object-browser">
        <div className="segment browser-tabs" role="tablist" aria-label="设计辅助">{[['facets','切面'],['reference','参考图'],['construction','构造']].map(([id,label]) => <button key={id} role="tab" aria-selected={page === id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</div>
        <div className={`browser-page ${page}`} role="tabpanel" aria-label={{facets:'切面',reference:'参考图',construction:'构造'}[page]}>
          {page === 'facets' ? <>
        <div className="segment facet-regions" role="tablist" aria-label="切面部位">{[['crown','冠部'],['girdle','腰部'],['pavilion','亭部']].map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={region === id} className={region === id ? 'active' : ''} onClick={() => setRegion(id)}>{label}</button>)}</div>
        <input className="facet-search" type="search" placeholder="搜索切面名称…" aria-label="搜索切面" value={snap.facetSearch} onChange={(e) => controller.setFacetSearch(e.target.value)} />
        <div className="facet-selection-summary"><span>已选 {snap.selectedIds.length} 个切面</span><button type="button" disabled={!snap.selectedIds.length} onClick={() => controller.clearSelection()}>清空</button></div>
        <FacetList region={region} search={snap.facetSearch} controller={controller} rows={snap.faceRows} selectedIds={snap.selectedIds} selectedFaceId={snap.selectedFaceId} multiSelectMode={snap.multiSelectMode} />
        <p className="field-note">当前部位显示 {snap.faceRows.filter(row => row.region === region).length} 面 · 全部 {snap.compiled.faces.length} 面。编辑组内单面会解除组合，可撤销。</p>
          </> : page === 'reference' ? <ReferenceSettings controller={controller} snap={snap} /> : <>
          <p className="field-note">构造工具会重新求解生成平面。局部微调请使用画布上方的点、线、面工具。</p>
        <Button className={snap.editTool === 'control' ? 'active-control' : ''} label="构造控制点工具" onClick={() => controller.setEditTool('control')} />
        <Toggle label="显示构造控制点" checked={snap.showHandles} onChange={() => controller.toggleHandles()} />
        <p className="field-note">构造控制点只用于冠部生成器切面，与真实交点不同。</p>
        <div className="field-divider" /><p className="subsection-label">共享节点示例</p>
        <Button icon="play" label="运行联合约束示例" onClick={() => controller.runSharedExample()} />
        <p className="field-note">查看求解候选，齿轮一致且求解通过时可替换当前冠部。</p>
          </>}
        </div>
      </div>
    </aside>
  );
}

export function RegionProperties({ controller, snap }) {
  return <section className="region-properties" aria-label="整体属性">
    <h3>整体属性</h3>
    <DeferredNumber label="基准分度盘" value={snap.plan.machine.teeth} min={1} max={360} step={1} list="lab-index-gears" unit="齿" onCommit={value=>controller.setIndexGear(value)} />
    <datalist id="lab-index-gears">{snap.indexGears.map(teeth=><option key={teeth} value={teeth} />)}</datalist>
    <div className="field compact"><div className="field-top"><label htmlFor="lab-direction-mode">方向约束</label><select id="lab-direction-mode" aria-label="方向约束" value={snap.plan.machine.mode} onChange={e=>controller.setDirectionMode(e.target.value)}>
      <option value="integer">优先整齿</option><option value="exact">精确方向 · 允许小数</option>
    </select></div></div>
    <p className="field-note">换盘保留实际几何。全部工序兼容：{snap.compatibility?.all.filter(r=>r.compatible).map(r=>r.teeth).join(' / ')||'暂无常用盘'}；最终有效面兼容：{snap.compatibility?.final.filter(r=>r.compatible).map(r=>r.teeth).join(' / ')||'暂无常用盘'}。</p>
    <div className="physical-size-summary"><span>{snap.physicalDimensions.millimetres ? snap.physicalDimensions.millimetres.map(v => v.toFixed(2)).join(' × ') + ' mm · X / Y / Z' : '实际尺寸未标定'}</span><Button className="subtle small" label={snap.physicalDimensions.millimetres ? '调整标定' : '标定尺寸'} onClick={() => controller.openModal('scale')} /></div>
    {snap.plan.metadata?.recipeDiagnostic?<p className="field-note">{snap.plan.metadata.recipeDiagnostic}</p>:null}

  </section>;
}
