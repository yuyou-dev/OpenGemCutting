import { validatePlan, compilePlan } from './patternPlan.js';
import { indexNormal, envelopeDepth } from '../domain/machine.js';
import { dot, length } from '../domain/math.js';
import { clipSolid, maxXYWidth } from '../domain/polyhedron.js';
import { matchesSourcePlane } from './sourcePlane.js';
import { inspectLabDocument, inspectLabRecipe, normalizeIndexGear, facetOnIndexGear, millimetersPerModelUnit, refreshLabRecipe } from './labContract.js';

const fail = message => { throw new Error(message); };
const near = (a,b) => Number.isFinite(a) && Math.abs(a-b) <= 1e-9;
const clean = n => {const value=Math.round(n*1e12)/1e12;return Object.is(value,-0)?0:value;};

/** The laboratory's file adapter. The immutable public package owns capability,
 * indexing and extension rules; the real host validator also checks every fixture
 * and returned candidate in scripts/verify-labs.mjs. */
export function normalizeEditorDocument(input) {
  const doc = structuredClone(input);
  if (!doc || typeof doc !== 'object') fail('无效的 Facet 文档。');
  doc.stock ??= {kind:'cube',size:2,center:[0,0,0]};
  doc.indexGear ??= normalizeIndexGear();
  if(doc.schemaVersion===3)doc.concaveCuts??=[];
  delete doc.machining;
  const inspection=inspectLabDocument(doc);
  if(!inspection.supported){
    const error=new Error('不支持此文档（网格／凹切必须完整保留）：'+inspection.errors.map(e=>`${e.path}: ${e.message}`).join('; '));
    error.code='LAB_UNSUPPORTED_DOCUMENT';throw error;
  }
  for(const stock of [doc.stock,doc.cuttingReference].filter(Boolean))
    if(!Number.isFinite(stock.size)||stock.size<=0||!Array.isArray(stock.center)||stock.center.length!==3||!stock.center.every(Number.isFinite))fail('毛坯或切割参考系无效。');
  const reference=doc.cuttingReference??doc.stock,errors=[],resolved=[];
  const ids=new Set();
  for(const [i,f] of doc.facets.entries()){
    const path=`$.facets[${i}]`,teeth=f.indexTeeth??96;
    normalizeIndexGear(teeth);
    if(typeof f.id!=='string'||!f.id||ids.has(f.id)||typeof f.patternId!=='string'||!f.patternId)fail(`${path}: 无效或重复的面／工序身份`);
    ids.add(f.id);
    if(!Number.isInteger(f.ordinal)||f.ordinal<0||!Number.isInteger(f.repeat)||f.repeat<1||f.repeat>360
      ||!Number.isFinite(f.mirror)||f.mirror<0||f.mirror>teeth/2
      ||![f.index,f.baseIndex].every(x=>Number.isFinite(x)&&x>=0&&x<teeth)
      ||!Number.isFinite(f.depth)||f.depth<0)fail(`${path}: 无效的工序参数`);
    const normal=indexNormal(f.index,f.industryAngleDeg,f.region,teeth).map(clean);
    if(f.region==='girdle'&&f.industryAngleDeg!==90)fail(`${path}: 腰部角度不一致`);
    const indices=Array.from({length:f.repeat},(_,j)=>(f.baseIndex+j*teeth/f.repeat)%teeth);
    const mirror=indices.map(x=>((2*(f.baseIndex+f.mirror)-x)%teeth+teeth)%teeth);
    if(![...indices,...mirror].some(x=>near(x,f.index)))fail(`${path}: 分度不属于工序轨道`);
    const beta=f.region==='girdle'?0:(f.region==='pavilion'?-1:1)*(90-f.industryAngleDeg);
    const offset=clean(envelopeDepth(normal,0,reference.size,reference.center)-f.depth);
    const n=[f.plane.normal.x,f.plane.normal.y,f.plane.normal.z];
    if(Math.abs(length(n)-1)>1e-9)fail(`${path}: 法向量不是单位向量`);
    for(const [key,expected] of Object.entries({displayIndex:f.index||teeth,azimuthDeg:f.index*360/teeth,betaDeg:beta}))
      if(!near(f[key],expected))errors.push({i,key});
    for(const [axis,k] of ['x','y','z'].entries())if(!near(n[axis],normal[axis]))errors.push({i,key:`plane.normal.${k}`});
    if(!near(f.plane.offset,offset))errors.push({i,key:'plane.offset'});
    resolved.push({...f,betaDeg:clean(beta),plane:{normal:{x:normal[0],y:normal[1],z:normal[2]},offset,keep:'less-than-or-equal'}});
  }
  // Exactly the legacy migration scope declared by the host: other inconsistent
  // parameters must never be treated as an old angle convention.
  if(errors.length){
    if(!errors.every(e=>['betaDeg','plane.normal.z','plane.offset'].includes(e.key)))fail(`参数与平面不一致：${errors.map(e=>`$.facets[${e.i}].${e.key}`).join(', ')}`);
    doc.facets=resolved;
  }
  doc.facets=doc.facets.map(f=>{
    const next=facetOnIndexGear(f,doc.indexGear.teeth);
    return next===f?f:{...next,displayIndex:next.index||doc.indexGear.teeth,azimuthDeg:next.index*360/doc.indexGear.teeth};
  });
  return refreshLabRecipe(doc);
}

/** Normalize coordinates only inside the editor; retain the entire canonical
 * source for lossless untouched export, including covered operations. */
export function importEditor96(input) {
  const document=normalizeEditorDocument(input),{size,center}=document.stock,unit=size/2;
  let recipe=inspectLabRecipe(document);
  if(recipe?.status==='current'&&document.metadata.labRecipe.labId==='facet-pattern-lab'&&document.metadata.labRecipe.data?.plan){
    const saved=structuredClone(document.metadata.labRecipe.data.plan);
    saved.name=document.name;saved.machine={...saved.machine,teeth:document.indexGear.teeth};
    saved.metadata={...saved.metadata,sourceDocument:{stock:document.stock,metadata:document.metadata,document}};
    // Surface changes do not stale a recipe: use the latest actual surface data.
    saved.surfaceOverrides=Object.fromEntries(document.facets.filter(f=>f.metadata?.surfaceFinish).map(f=>[f.id,f.metadata.surfaceFinish]));
    try {
      const restored=compilePlan(saved),actual=restored.planes;
      const matches=actual.length===document.facets.length&&actual.every((p,i)=>{
        const f=document.facets[i];return p.id===f.id&&matchesSourcePlane(p,f,document.stock);
      });
      if(matches&&restored.audit.passed)return restored.plan;
    } catch { /* A stale recipe never displaces valid actual CUTs. */ }
    recipe={status:'stale'};
    document.metadata.labRecipe={...document.metadata.labRecipe,status:'stale',reason:'recipe-data-mismatch'};
  }
  const planes=document.facets.map(f=>{
    const normal=[f.plane.normal.x,f.plane.normal.y,f.plane.normal.z];
    return {id:f.id,normal,offset:(f.plane.offset-dot(normal,center))/unit,region:f.region,
      ...(f.metadata?.operationType==='table'?{table:true}:{group:f.patternId}),
      ...(f.metadata?.surfaceFinish?{finish:f.metadata.surfaceFinish}:{}),sourceFacet:structuredClone(f)};
  });
  let mm=millimetersPerModelUnit(document);
  if(mm===null&&Number.isFinite(document.metadata?.patternStudy?.finalWidthMm))
    mm=document.metadata.patternStudy.finalWidthMm/(maxXYWidth(clipSolid(planes))*unit);
  const width=maxXYWidth(clipSolid(planes));
  return validatePlan({kind:'facet-pattern-plan',version:1,name:document.name,
    machine:{teeth:document.indexGear.teeth,mode:'integer'},sizeMm:mm===null?null:width*unit*mm,mmPerUnit:mm===null?null:mm*unit,
    planes,bevel:{enabled:false,shoulderMm:.014,alpha:.28},surfaceOverrides:{},
    metadata:{sourceDocument:{stock:document.stock,metadata:document.metadata,document},...(recipe?.status==='stale'?{recipeDiagnostic:'配方已失效；保留实际细面，不自动重放。'}:{})},
  });
}
