// Adapted from the external src/core.js delivery accepted on 2026-09-16,
// based on upstream 7ba8898; integration boundary: external docs/INTEGRATION.md.
// Only editing constraints are migrated; clipping and topology remain canonical.
import { dot, sub, mul, length as norm, clamp, rad, pointKey } from '../domain/math.js';
import { planeMachine as machine } from '../domain/machine.js';
import { topology } from '../domain/polyhedron.js';
import { compilePlan } from './patternPlan.js';
import { solveQP } from './analyticSolver.js';

const PI = Math.PI;
const zeros = n => Array(n).fill(0);
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, details });
const mean = points => points.reduce((sum,p) => sum.map((v,i) => v+p[i]),[0,0,0]).map(v=>v/points.length);
const meshCache = new WeakMap();

/** Only topology() welds vertices. The solver consumes canonical base geometry;
 * compilePlan() regenerates and audits derived bevels before accepting a result. */
export function analyticMesh(compiled) {
  if (meshCache.has(compiled)) return meshCache.get(compiled);
  const t = topology(compiled.baseFaces), planes = new Map(compiled.baseFaces.map(p=>[p.id,p]));
  const vertices = t.vertices.map((point,i)=>({point,i,planeIds:[]}));
  const faces = compiled.baseFaces.map(face=>({...face,vertices:t.faceVertices.get(face.id)}));
  for (const face of faces) for (const i of face.vertices) vertices[i].planeIds.push(face.id);
  for (const v of vertices) {
    v.planeIds.sort(); v.id=v.planeIds.join('|'); v.key=pointKey(v.point);
    v.boundary=v.planeIds.some(id=>Math.abs(planes.get(id)?.normal[2])<1e-9);
  }
  const edges = t.edges.map(e=>({...e,planeIds:[...e.faces].sort(),id:[...e.faces].sort().join('|'),
    key:[vertices[e.a].key,vertices[e.b].key].sort().join('|')}));
  const result={faces,vertices,edges,scale:compiled.audit.mmPerUnit};
  meshCache.set(compiled,result);
  return result;
}

function topologySame(a,b){return a.vertices.length===b.vertices.length&&a.faces.length===b.faces.length&&a.edges.length===b.edges.length&&a.vertices.every(v=>b.vertices.some(w=>w.id===v.id));}
function selectionVertices(mesh,selection){
  if(selection.kind==='vertex'){const v=mesh.vertices.find(v=>v.id===selection.id);return v?[v]:[];}
  if(selection.kind==='edge'){const e=mesh.edges.find(e=>e.id===selection.id);return e?[mesh.vertices[e.a],mesh.vertices[e.b]]:[];}
  if(selection.kind==='face'){const f=mesh.faces.find(f=>f.id===selection.id);return f?f.vertices.map(i=>mesh.vertices[i]):[];}
  return [];
}
function solveEdit(plan,before,selection,delta,options={}){
  const start=performance.now(),old=selectionVertices(before,selection);
  if(!old.length)throw fail('SELECTION','所选对象已发生拓扑变化，请重新选择。');
  if(!Array.isArray(delta)||delta.length!==2||!delta.every(Number.isFinite))throw fail('TARGET','位移必须是有限的 X/Y 数值。');
  const settings={relax:true,angleLimit:8,topology:true,lockOutline:true,symmetry:false,side:'crown',...options};
  const isMerge=!!options.mergeTo;
  let targets;
  if(isMerge){
    if(selection.kind!=='vertex')throw fail('MERGE','请先选择起点，再选择目标点。');
    const b=before.vertices.find(v=>v.id===options.mergeTo);if(!b||b.id===old[0].id)throw fail('MERGE','请选择不同的目标点。');
    targets=[{point:b.point.slice(),planeIds:[...new Set([...old[0].planeIds,...b.planeIds])],sources:[old[0].id,b.id]}];
    if(!settings.topology)throw fail('TOPOLOGY','真实合并会改变拓扑；请启用“允许拓扑变化”。');
  }else targets=old.map(v=>({point:[v.point[0]+delta[0],v.point[1]+delta[1],v.point[2]],planeIds:v.planeIds.slice(),sources:[v.id]}));
  // Symmetry is constrained by explicit rotated targets, never nearest-index rounding.
  if(settings.symmetry){const count=plan.metadata?.symmetry;if(!Number.isInteger(count)||count<2||plan.machine.teeth%count)throw fail('SYMMETRY','模型缺少可执行的整数对称元数据。');
    const original=targets.slice();for(let k=1;k<count;k++){const a=2*PI*k/count,c=Math.cos(a),s=Math.sin(a),rot=p=>[c*p[0]-s*p[1],s*p[0]+c*p[1],p[2]];
      for(const t of original){const source=before.vertices.find(v=>v.id===t.sources[0]),rp=rot(source.point),v=before.vertices.find(v=>norm(sub(v.point,rp))<1e-7);
        if(!v)throw fail('SYMMETRY','当前形状已不对称；请关闭对称联动。');
        let ids=v.planeIds.slice(),sources=[v.id];
        if(isMerge){const rb=rot(before.vertices.find(v=>v.id===t.sources[1]).point),b=before.vertices.find(v=>norm(sub(v.point,rb))<1e-7);if(!b)throw fail('SYMMETRY','找不到对称的合并目标。');ids=[...new Set([...ids,...b.planeIds])];sources.push(b.id);}
        if(!targets.some(q=>norm(sub(q.point,rot(t.point)))<1e-8))targets.push({point:rot(t.point),planeIds:ids,sources});
      }}
  }
  const side=settings.side==='pavilion'?-1:1;
  const stockPlanes=before.faces.filter(p=>p.stock);
  // A target on a vertical stock boundary cannot translate across that fixed
  // support. Report the actual conflicting equation before attempting the QP.
  for(const t of targets)for(const p of stockPlanes)if(p.normal[2]===0){
    const excess=dot(p.normal,t.point)-p.offset;
    if(excess>1e-9||(t.planeIds.includes(p.id)&&Math.abs(excess)>1e-9))
      throw fail('STOCK_BOUNDARY',`目标与不可变毛坯边界 ${p.id} 不相容；请选择沿边界的目标，原设计未改变。`,
        {stockPlaneId:p.id,normal:p.normal,offset:p.offset,target:t.point,excess,incident:t.planeIds.includes(p.id)});
  }
  const eligible=p=>!p.stock&&!p.locked && (Math.abs(p.normal[2])<1e-9?!settings.lockOutline:p.normal[2]*side>0);
  const touched=new Set(targets.flatMap(t=>t.planeIds));
  // Enlarge only to interfering planes. Remote planes are not silently optimized.
  for(const p of plan.planes)if(eligible(p)&&targets.some(t=>dot(p.normal,t.point)>p.offset-1e-8))touched.add(p.id);
  const vars=[],params=new Map();
  for(const p of [...plan.planes,...stockPlanes]){
    const m=machine(p,plan.machine.teeth),z=Math.abs(p.normal[2]),vertical=z<1e-9,
      item={p,m,vertical,sign:p.normal[2]>=0?1:-1,u:Math.cos(rad(m.azimuth)),v:Math.sin(rad(m.azimuth)),s:vertical?0:Math.tan(rad(m.angle)),h:vertical?p.offset:p.offset/z};
    if(touched.has(p.id)&&eligible(p)){
      if(plan.machine.mode!=='exact'&&!m.exact)throw fail('OFF_GEAR_EDIT',`相关面 ${p.id} 在 ${plan.machine.teeth} 齿上为小数方向；请选择精确方向模式，原面未移动。`,{facetId:p.id,index:m.index});
      if(settings.relax&&!vertical&&m.angle>1e-6&&m.angle<88){item.si=vars.length;vars.push({type:'slope',id:p.id});}
      item.hi=vars.length;vars.push({type:'height',id:p.id});
    }params.set(p.id,item);
  }
  for(const t of targets){t.zi=vars.length;vars.push({type:'z'});}
  const n=vars.length,H=Array.from({length:n},()=>zeros(n)),g=zeros(n),eq=[],ineq=[];
  function soft(a,b,w){for(let i=0;i<n;i++)if(a[i]){g[i]+=w*a[i]*b;for(let j=0;j<n;j++)if(a[j])H[i][j]+=w*a[i]*a[j];}}
  for(let i=0;i<n;i++)H[i][i]=vars[i].type==='slope'?5:vars[i].type==='z'?12:1;
  const targetSources=new Set(targets.flatMap(t=>t.sources));
  for(const item of params.values())if(item.hi!==undefined){
    for(const v of before.vertices)if(v.planeIds.includes(item.p.id)&&!targetSources.has(v.id)){
      const a=zeros(n);a[item.hi]=-1;if(item.si!==undefined)a[item.si]=item.u*v.point[0]+item.v*v.point[1];soft(a,0,18/Math.max(1,before.faces.find(f=>f.id===item.p.id)?.vertices.length??1));
    }
    if(item.si!==undefined){const angleLimit=clamp(Number(settings.angleLimit),.01,45),lo=Math.tan(rad(Math.max(.01,item.m.angle-angleLimit))),hi=Math.tan(rad(Math.min(88,item.m.angle+angleLimit))),a=zeros(n);a[item.si]=1;
      ineq.push({a,b:hi-item.s,name:'已达到允许的最大切角变化。'},{a:mul(a,-1),b:item.s-lo,name:'已达到允许的最小切角。'});}
  }
  for(const t of targets){
    for(const item of params.values()){
      const {p}=item,a=zeros(n);let base;
      if(item.vertical){base=dot(p.normal,t.point)-p.offset;if(item.hi!==undefined)a[item.hi]=-1;}
      else{const r=item.u*t.point[0]+item.v*t.point[1];base=item.s*r+item.sign*t.point[2]-item.h;
        a[t.zi]=item.sign;if(item.si!==undefined)a[item.si]=r;if(item.hi!==undefined)a[item.hi]=-1;}
      if(t.planeIds.includes(p.id))eq.push({a,b:-base,name:`目标与锁定平面 ${p.id} 不相容。`});
      else ineq.push({a,b:-base,name:`目标超出锁定平面 ${p.id}。`});
    }
    const a=zeros(n);a[t.zi]=1;
    // A disclosed, model-scale safeguard, not the old request-dependent tiny budget.
    ineq.push({a,b:.5,name:'目标高度变化超过 0.5 模型单位。'},{a:mul(a,-1),b:.5,name:'目标高度变化超过 0.5 模型单位。'});
    if(settings.lockHeight||(isMerge&&settings.lockMergeHeight!==false))eq.push({a,b:0});
  }
  const qp=solveQP(H,g,eq,ineq),next={...plan},changes=[];
  next.planes=plan.planes.map(p=>{const k=params.get(p.id);if(k.hi===undefined)return p;
    const dh=qp.x[k.hi],ds=k.si===undefined?0:qp.x[k.si];if(Math.abs(dh)+Math.abs(ds)<1e-13)return p;
    const s=k.s+ds,h=k.h+dh,n0=k.vertical?p.normal:[s*k.u,s*k.v,k.sign],l=norm(n0);
    const q={...p,normal:mul(n0,1/l),offset:h/l};delete q.generator;delete q.control;
    changes.push({id:p.id,fromAngle:k.m.angle,toAngle:machine(q,plan.machine.teeth).angle,offsetDelta:q.offset-p.offset});return q;});
  next.mmPerUnit=before.scale;
  const changedGroups=new Set(changes.map(c=>plan.planes.find(p=>p.id===c.id)?.group).filter(Boolean));
  next.planes=next.planes.map(p=>{if(!changedGroups.has(p.group))return p;const q={...p};delete q.group;return q;});
  const compiled=compilePlan(next);
  if(!compiled.audit.passed)throw fail('GEOMETRY_AUDIT','基础面和派生细边复核未通过，编辑未应用。', {errors:compiled.audit.errors});
  const after=analyticMesh(compiled),matchPoints=targets.map(t=>[t.point[0],t.point[1],t.point[2]+qp.x[t.zi]]);
  const residual=Math.max(...matchPoints.map(p=>Math.min(...after.vertices.map(v=>norm(sub(p,v.point))))));
  if(residual>2e-7)throw fail('TARGET_NOT_VERTEX','目标满足平面方程，但未保留为真实交点；未应用编辑。',{residual});
  if(!settings.topology&&!topologySame(before,after))throw fail('TOPOLOGY','目标需要越过拓扑事件。启用“允许拓扑变化”后可再次尝试；没有缩小你的目标位移。');
  const oldIds=new Set(before.faces.map(f=>f.id)),newIds=new Set(after.faces.map(f=>f.id));
  const lost=[...oldIds].filter(id=>!newIds.has(id)),gained=[...newIds].filter(id=>!oldIds.has(id));
  const remap=after.vertices.reduce((best,v)=>norm(sub(v.point,matchPoints[0]))<norm(sub(best.point,matchPoints[0]))?v:best,after.vertices[0]);
  return {plan:compiled.plan,mesh:after,previewCompiled:compiled,selection:isMerge?{kind:'vertex',id:remap.id}:selection.kind==='vertex'?{kind:'vertex',id:remap.id}:selection,
    result:{ok:true,kind:isMerge?'merge':'move',residualMm:residual*before.scale,changedPlanes:changes,maxAngleDelta:Math.max(0,...changes.map(c=>Math.abs(c.toAngle-c.fromAngle))),
    lost,gained,deltaV:after.vertices.length-before.vertices.length,deltaE:after.edges.length-before.edges.length,
    topologyChanged:!topologySame(before,after),solveMs:performance.now()-start,qpSweeps:qp.sweeps,actualTargets:matchPoints,variables:n,
    requestedMm:isMerge?norm(sub(old[0].point,targets[0].point))*before.scale:norm(delta)*before.scale}};
}

function operation(mesh, op) {
  const vertex = key => mesh.vertices.find(v => v.key === key || `vertex:${v.id}` === key || v.id === key);
  const validXY = a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite);
  if (op?.kind === 'vertex.move' || op?.kind === 'vertex.merge') {
    const a = vertex(op.vertexKey ?? op.vertexKeyA);
    if (!a) throw fail('UNKNOWN_VERTEX', '该交点不在可编辑网格上。');
    if (op.kind === 'vertex.merge') {
      const b = vertex(op.vertexKeyB);
      if (!b || a === b) throw fail('MERGE', '请选择不同的目标交点。');
      return { selection: { kind: 'vertex', id: a.id }, delta: [0, 0], mergeTo: b.id };
    }
    if (!validXY(op.target)) throw fail('BAD_TARGET', '目标位置无效。');
    return { selection: { kind: 'vertex', id: a.id }, delta: sub(op.target, a.point.slice(0, 2)) };
  }
  if (op?.kind === 'edge.move') {
    const edge = mesh.edges.find(e => e.key === op.edgeKey || `edge:${e.id}` === op.edgeKey || e.id === op.edgeKey);
    if (!edge) throw fail('UNKNOWN_EDGE', '该棱不在可编辑网格上。');
    if (!validXY(op.delta)) throw fail('BAD_DELTA', '位移无效。');
    return { selection: { kind: 'edge', id: edge.id }, delta: op.delta };
  }
  if (op?.kind === 'face.move') {
    const face = mesh.faces.find(f => f.id === op.faceId && Math.abs(f.normal[2]) > 1e-9 && !f.bevel && !f.stock);
    if (!face) throw fail('UNKNOWN_FACE', '请选择当前平面图中的切面。');
    if (!validXY(op.delta)) throw fail('BAD_DELTA', '位移无效。');
    return { selection: { kind: 'face', id: face.id }, delta: op.delta };
  }
  throw fail('UNKNOWN_OP', `未知编辑操作：${op?.kind ?? '（无）'}`);
}

/** Exact requested XY movement with optional angle and topology changes. Failure
 * leaves the input untouched; success includes the final canonical audit and
 * diagnostics. Group dissolution happens before compile so a Worker result can
 * be committed directly without rebuilding on the UI thread. */
export function applyAnalyticEdit(plan, compiled, op, options = {}) {
  try {
    const before = analyticMesh(compiled), request = operation(before, op);
    const { selection, delta, mergeTo } = request;
    if (!mergeTo && norm(delta) < 1e-10) return {
      plan, planes: plan.planes, affectedIds: [], warnings: [], fallbacks: [], unchanged: true,
      edit: { requestedDelta: delta, actualDelta: [0, 0], limited: false, reason: '', maxDisplacementMm: 0, maxHeightMm: 0 },
    };
    const selected = selectionVertices(before, selection);
    const direction = selected.flatMap(v => v.planeIds).reduce((sum, id) => sum + (plan.planes.find(p => p.id === id)?.normal[2] ?? 0), 0);
    const settings = { side: direction < 0 ? 'pavilion' : 'crown', ...options, ...(mergeTo ? { mergeTo } : {}) };
    if (settings.angleLimit !== undefined && (!Number.isFinite(settings.angleLimit) || settings.angleLimit <= 0)) throw fail('BAD_ANGLE_LIMIT', '切角变化上限必须为正数。');
    const result = solveEdit(plan, before, selection, delta, settings);
    const afterById = new Map(result.mesh.vertices.map(v => [v.id, v]));
    let maxDisplacement = 0, maxHeight = 0;
    for (const v of before.vertices) {
      const next = afterById.get(v.id) ?? result.mesh.vertices.reduce((best, w) => norm(sub(w.point, v.point)) < norm(sub(best.point, v.point)) ? w : best);
      const displacement = sub(next.point, v.point);
      maxDisplacement = Math.max(maxDisplacement, norm(displacement));
      maxHeight = Math.max(maxHeight, Math.abs(displacement[2]));
    }
    const actualDelta = mergeTo ? sub(result.result.actualTargets[0], selected[0].point).slice(0, 2)
      : mean(result.result.actualTargets.slice(0, selected.length).map((p, i) => sub(p, selected[i].point))).slice(0, 2);
    const identity = `${result.selection.kind}:${result.selection.id}`;
    const warnings = result.result.lost.length ? [`${result.result.lost.length} 个基础切面将消失，请确认拓扑变化。`] : [];
    return {
      plan: result.plan, planes: result.plan.planes, previewCompiled: result.previewCompiled,
      affectedIds: result.result.changedPlanes.map(c => c.id), warnings, fallbacks: [],
      selectionRemap: { ...result.selection, identity }, diagnostics: result.result,
      edit: { ...result.result, requestedDelta: mergeTo ? actualDelta : delta, actualDelta,
        limited: false, reason: '', maxDisplacementMm: maxDisplacement * before.scale, maxHeightMm: maxHeight * before.scale },
    };
  } catch (error) {
    return { error: error.code ?? 'ANALYTIC_EDIT_FAILED', message: error.message, details: error.details };
  }
}
