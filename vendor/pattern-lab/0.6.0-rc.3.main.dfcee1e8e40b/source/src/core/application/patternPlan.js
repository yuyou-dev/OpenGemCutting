import { finite, rad, mul, length } from '../domain/math.js';
import {machine,symmetryCompatible,indexNormal} from '../domain/machine.js';
import {clipSolid,auditSolid,cubeFaces,maxXYWidth} from '../domain/polyhedron.js';
import {regionBevels,bevelPolicy} from '../domain/bevel.js';
import {resolveFinish,finish} from '../domain/finish.js';
export function createPattern({teeth=96,symmetry=8,sizeMm=10,density=3,curvature=.26,height=.36,frosted=true}={}){
 machine(teeth);if(!symmetryCompatible(teeth,symmetry))throw new Error(`SYMMETRY: ${symmetry} does not divide ${teeth}`);
 if(![1,2,3,4].includes(density))throw new Error('DENSITY');
 const planes=[{id:'T1',normal:[0,0,1],offset:height,region:'crown',table:true}];
 const ringCount=preferred=>symmetry*[...Array(preferred)].map((_,i)=>preferred-i).find(m=>teeth%(symmetry*m)===0);
 const sides=ringCount(4);
 for(let j=0;j<sides;j++)planes.push({id:`G1:${j}`,normal:indexNormal(j*teeth/sides,90,'girdle',teeth),offset:.90,region:'girdle',group:'G1'});
 const pavilion=ringCount(2);
 for(let j=0;j<pavilion;j++)planes.push({id:`P1:${j}`,normal:indexNormal(j*teeth/pavilion,41,'pavilion',teeth),offset:.57,region:'pavilion',group:'P1'});
 const ringRadii=density===1?[.56,.98]:density===2?[.35,.66,1.06]:density===3?[.27,.50,.76,1.1]:[.2,.39,.58,.79,1.11];
 for(let r=0;r<ringRadii.length;r++){
  const count=r===0?symmetry:r===ringRadii.length-1?sides:ringCount(2);
  const step=teeth/count,phase=(r%2 && r<ringRadii.length-1)?Math.floor(step/2):0;
  for(let j=0;j<count;j++){
   const index=j*step+phase,phi=rad(index*360/teeth),radius=ringRadii[r],slope=2*curvature*radius;
   const raw=[slope*Math.cos(phi),slope*Math.sin(phi),1],l=length(raw);
   planes.push({id:`C${r+1}:${j}`,normal:mul(raw,1/l),offset:(height+curvature*radius*radius)/l,region:'crown',group:`C${r+1}`,
    control:[radius*Math.cos(phi),radius*Math.sin(phi)],generator:{curvature,height}});
  }
 }
 return {kind:'facet-pattern-plan',version:1,name:symmetry===5?'五向冠部 · 原创结构研究':symmetry===8?'八向冠部 · 原创结构研究':`${symmetry} 向冠部 · 原创结构研究`,machine:{teeth,mode:'integer'},sizeMm,
  planes,bevel:{enabled:frosted,shoulderMm:.014,alpha:.28},surfaceOverrides:{},
  metadata:{generator:'tangent-envelope-v1',symmetry,density,ringCount:sides,pavilionCount:pavilion,notVideoReconstruction:true}};
}
export function validatePlan(input){
 if(!input||input.kind!=='facet-pattern-plan'||input.version!==1)throw new Error('PLAN_VERSION');
 machine(input.machine?.teeth);if(!['integer','exact'].includes(input.machine.mode))throw new Error('DIRECTION_MODE');
 if(input.sizeMm!==null&&(!Number.isFinite(input.sizeMm)||input.sizeMm<=0||(input.sizeMm>200&&!input.metadata?.sourceDocument)))throw new Error('SIZE_MM');
 if(input.mmPerUnit!==undefined&&input.mmPerUnit!==null&&(!Number.isFinite(input.mmPerUnit)||input.mmPerUnit<=0))throw new Error('MM_PER_UNIT');
 if(!Array.isArray(input.planes)||(input.planes.length<4&&!input.metadata?.sourceDocument)||input.planes.length>600)throw new Error('PLANE_COUNT: 4..600 (source documents may retain uncut stock)');
 const ids=new Set();const planes=input.planes.map(p=>{
  if(typeof p.id!=='string'||!p.id||p.id.length>180||ids.has(p.id))throw new Error('DUPLICATE_OR_INVALID_PLANE_ID');ids.add(p.id);
  if(!Array.isArray(p.normal)||p.normal.length!==3||!p.normal.every(Number.isFinite))throw new Error('NORMAL');
  const l=length(p.normal);if(l<1e-12)throw new Error('NORMAL');
  // Revalidating an already unit plane must not slowly alter untouched geometry.
  const divisor=p.sourceFacet||Math.abs(l-1)<=Number.EPSILON*4?1:l;
  const q={...p,normal:p.normal.map(x=>x/divisor),offset:finite(p.offset,'offset')/divisor};
  if(p.finish)q.finish=finish(p.finish);return q;
 });
 return {...structuredClone(input),planes};
}
export function compilePlan(input){
 const plan=validatePlan(input);
 // Imported analytic plans describe complete halfspaces rather than a cube stock.
 // The larger envelope is numerical only: any surviving stock face still fails audit.
 const envelope=plan.metadata?.geometryEnvelope==='analytic-halfspaces-v1'
  ? cubeFaces(Math.max(4,Math.min(1e4,4*Math.max(...plan.planes.map(p=>Math.abs(p.offset)))))) : undefined;
 const baseFaces=clipSolid(plan.planes,envelope);
 if(!baseFaces.length)throw new Error('EMPTY_SOLID');
 if(plan.mmPerUnit===undefined)plan.mmPerUnit=plan.sizeMm/maxXYWidth(baseFaces);
 // Persist actual cuts. Wheel changes and serialization are never generation events.
 const basis=JSON.stringify({planes:plan.planes.map(p=>({id:p.id,normal:p.normal,offset:p.offset})),bevel:plan.bevel,mmPerUnit:plan.mmPerUnit??null,sizeMm:plan.mmPerUnit===undefined?plan.sizeMm:null});
 let bevel=plan.bevelResult;
 if(!bevel||bevel.basis!==basis){
  const regions=['crown','pavilion'].map(side=>regionBevels(baseFaces,{...bevelPolicy(plan,side),mode:plan.machine.mode},plan.sizeMm,plan.machine.teeth,plan.mmPerUnit,side));
  let generated=regions.flatMap(r=>r.planes),skipped=regions.flatMap(r=>r.skipped);
  if(bevel?.basis){
   const previous=JSON.parse(bevel.basis),before=new Map(previous.planes.map(p=>[p.id,p]));
   const changed=new Set(plan.planes.filter(p=>{const old=before.get(p.id);return !old||old.offset!==p.offset||old.normal.some((n,i)=>n!==p.normal[i]);}).map(p=>p.id));
   const policiesChanged=side=>JSON.stringify(bevelPolicy({bevel:previous.bevel},side))!==JSON.stringify(bevelPolicy(plan,side));
   const previousMm=bevel.mmPerUnit??previous.mmPerUnit??(previous.sizeMm===null?null:previous.sizeMm/maxXYWidth(clipSolid(previous.planes,envelope)));
   const scaleChanged=previousMm!==plan.mmPerUnit;
   const keep=p=>!scaleChanged&&!policiesChanged(p.region??'crown')&&p.parents?.every(id=>!changed.has(id));
   const retained=new Map(bevel.planes.filter(keep).map(p=>[p.id,p]));
   // A new wheel may fail on an unrelated ridge: keep its existing actual cut.
   const existing=new Set([...generated,...skipped].map(p=>p.id));
   generated=generated.map(p=>retained.get(p.id)??p);
   for(const p of retained.values())if(existing.has(p.id)&&!generated.some(q=>q.id===p.id))generated.push(p);
   skipped=skipped.filter(p=>!retained.has(p.id));
  }
  bevel={basis,planes:generated,skipped,mmPerUnit:plan.mmPerUnit,teeth:plan.machine.teeth,mode:plan.machine.mode};
 }
 plan.bevelResult=bevel;
 if(plan.planes.length+bevel.planes.length>768)throw new Error('STUDY_PLANE_BUDGET: 768');
 const planes=[...plan.planes,...bevel.planes].map(p=>({...p,finish:resolveFinish(plan,p)}));
 const finishById=new Map(planes.map(p=>[p.id,p.finish]));
 // Continue clipping the already solved base instead of rebuilding it from stock.
 const finishedBase=baseFaces.map(f=>({...f,finish:finishById.get(f.id)??resolveFinish(plan,f)}));
 const faces=bevel.planes.length?clipSolid(planes.slice(plan.planes.length),finishedBase):finishedBase,audit=auditSolid(faces,planes,plan.sizeMm,plan.mmPerUnit);
 if(plan.mmPerUnit!==undefined)plan.sizeMm=plan.mmPerUnit===null?null:audit.widthUnits*plan.mmPerUnit;
 const effective=new Set(faces.map(f=>f.id)),baseEffective=new Set(baseFaces.map(f=>f.id));
 const lostBase=[...baseEffective].filter(id=>!effective.has(id));
 const inactive=planes.filter(p=>!effective.has(p.id)).map(p=>p.id);
 const danglingFinishes=Object.keys(plan.surfaceOverrides||{}).filter(id=>!planes.some(p=>p.id===id));
 const errors=[];if(!audit.valid)errors.push('SOLID_AUDIT_FAILED');if(audit.stockFaces&&!plan.metadata?.sourceDocument)errors.push('UNCUT_STOCK_SURFACES');if(lostBase.length)errors.push('BEVEL_ERASED_BASE_FACETS');
 if(!plan.metadata?.sourceDocument&&!plan.planes.some(p=>p.table&&effective.has(p.id)))errors.push('TABLE_NOT_EFFECTIVE');
 const warnings=[];if(bevel.skipped.length)warnings.push(`${bevel.skipped.length} 条棱无法生成精确分度倒角，已跳过并列入诊断。`);
 if(audit.minEdgeMm!==null&&audit.minEdgeMm<.02)warnings.push(`最短棱 ${audit.minEdgeMm.toFixed(4)} mm：须由切磨者核对最小工艺特征。`);
 if(danglingFinishes.length)warnings.push('存在失效面身份的表面覆盖项，未重新绑定到其他面。');
 if(inactive.length)warnings.push(`${inactive.length} 条平面指令在最终几何中不形成有效面。`);
 if(audit.mmPerUnit===null)warnings.push('来源未指定毫米尺度；尺寸以模型单位保留，毫米编辑和细面生成需要先标定。');
 const protectedIds=new Set(baseFaces.filter(f=>f.normal[2]<0).map(f=>f.id));
 let pavilionChanged=0;for(const bf of baseFaces.filter(f=>protectedIds.has(f.id))){const f=faces.find(x=>x.id===bf.id);
  if(!f||f.points.length!==bf.points.length||bf.points.some(p=>!f.points.some(q=>length(p.map((x,i)=>x-q[i]))<1e-7)))pavilionChanged++;
 }
 if(pavilionChanged&&!bevelPolicy(plan,'pavilion').enabled)errors.push('PAVILION_CHANGED');
 const generatedBevels=bevel.planes.map(p=>({id:p.id,parents:p.parents,region:p.region,
  requestedShoulderMm:bevelPolicy(plan,p.region).shoulderMm,shoulderAmm:p.construction.shoulderAmm,shoulderBmm:p.construction.shoulderBmm}));
 return {plan,planes,faces,baseFaces,audit:{...audit,passed:errors.length===0,errors,warnings,skippedBevels:bevel.skipped,generatedBevels,lostBase,inactive,danglingFinishes,pavilionChanged,
  commandCount:planes.length,effectiveFacets:faces.length,frostedFacets:faces.filter(f=>f.finish?.state==='frosted').length}};
}
/** Dragging a control changes a supporting plane; topology is derived again, never painted over. */
export function moveControl(plan,id,x,y){
 const p=plan.planes.find(p=>p.id===id);if(!p?.generator)throw new Error('NOT_A_GENERATOR_CONTROL');
 const teeth=plan.machine.teeth,phi=Math.atan2(y,x),index=(((plan.machine.mode==='exact'?phi/(2*Math.PI)*teeth:Math.round(phi/(2*Math.PI)*teeth))%teeth)+teeth)%teeth;
 const angle=index*2*Math.PI/teeth,radius=Math.max(.02,Math.min(1.5,Math.hypot(x,y))),{curvature,height}=p.generator;
 const raw=[2*curvature*radius*Math.cos(angle),2*curvature*radius*Math.sin(angle),1],l=length(raw);
 const replacement={...p,normal:mul(raw,1/l),offset:(height+curvature*radius**2)/l,control:[radius*Math.cos(angle),radius*Math.sin(angle)]};
 return {...plan,planes:plan.planes.map(q=>q.id===id?replacement:q)};
}
