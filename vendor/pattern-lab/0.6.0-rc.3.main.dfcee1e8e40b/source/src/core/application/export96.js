import pkg from '../../../package.json' with { type: 'json' };
import {dot} from '../domain/math.js';
import {planeMachine,envelopeDepth} from '../domain/machine.js';
import {facetOnIndexGear,normalizeIndexGear,indexExportSummary,labGeometryKey,refreshLabRecipe,inspectLabDocument} from './labContract.js';
import {matchesSourcePlane as samePlane} from './sourcePlane.js';
const sourceOf=plan=>plan.metadata?.sourceDocument?.document;

export function facetDefinitions(compiled){
 if(!compiled.audit.passed)throw new Error('GEOMETRY_GATE: resolve audit errors before export');
 const {plan}=compiled,teeth=plan.machine.teeth,source=sourceOf(plan);
 const stock=source?.stock??plan.metadata?.sourceDocument?.stock??{kind:'cube',size:2,center:[0,0,0]};
 const reference=source?.cuttingReference??stock;
 const originals=new Map(source?.facets.map(f=>[f.id,f])??[]);
 const brokenGroups=new Set(compiled.planes.flatMap(p=>{
  const f=originals.get(p.id);return f&&!samePlane(p,f,stock)?[f.patternId]:[];
 }));
 return compiled.planes.map(p=>{
  const original=originals.get(p.id),untouched=samePlane(p,original,stock),m=planeMachine(p,teeth);
  let f;
  if(untouched)f=structuredClone(facetOnIndexGear(original,teeth));
  else{
   const normal={x:p.normal[0],y:p.normal[1],z:p.normal[2]},offset=p.offset*stock.size/2+dot(p.normal,stock.center);
   const depth=envelopeDepth(p.normal,offset,reference.size,reference.center);
   if(depth<0)throw new Error('OUTSIDE_EDITOR_ROTATIONAL_ENVELOPE');
   f={...structuredClone(original),id:p.id,patternId:`pattern-study:${p.id}`,ordinal:0,region:m.region,
    indexTeeth:teeth,baseIndex:m.index,repeat:1,mirror:0,index:m.index,displayIndex:m.displayIndex,
    azimuthDeg:m.azimuth,industryAngleDeg:m.angle,betaDeg:m.region==='girdle'?0:(m.region==='pavilion'?-1:1)*(90-m.angle),depth,
    label:original?.label??(p.table?'T1 台面':p.bevel?`磨砂边 ${p.parents.join(' / ')}`:p.id),
    plane:{normal,offset,keep:'less-than-or-equal'},metadata:{...original?.metadata,patternMode:'symmetric',primaryIndex:m.index,
     patternStudy:{...original?.metadata?.patternStudy,version:1,sourcePlaneId:p.id,...(p.parents?{parents:p.parents,construction:p.construction}:{}),liveConstraint:false}}};
   if(p.table)f.metadata.operationType='table';
  }
  if(original&&brokenGroups.has(original.patternId)){
   f.patternId=`pattern-study:${p.id}`;f.ordinal=0;f.baseIndex=f.index;f.repeat=1;f.mirror=0;
   f.metadata={...f.metadata,patternMode:'symmetric',primaryIndex:f.index,patternStudy:{...f.metadata?.patternStudy,
    originalOperation:original.metadata?.patternStudy?.originalOperation??{patternId:original.patternId,ordinal:original.ordinal,baseIndex:original.baseIndex,repeat:original.repeat,mirror:original.mirror,
     ...(original.metadata?.construction?{construction:original.metadata.construction}:{})},
    diagnostic:'Edited operation split; original construction retained as provenance, not a live constraint.'}};
   delete f.metadata.construction;
  }
  if(f.indexTeeth!==original?.indexTeeth||teeth!==(original?.indexTeeth??96)){
   f.displayIndex=f.index||teeth;f.azimuthDeg=f.index*360/teeth;
  }
  if(!original||plan.surfaceOverrides?.[p.id]||p.finish?.state!==(original.metadata?.surfaceFinish?.state??'polished'))
   f.metadata={...f.metadata,surfaceFinish:p.finish};
  return f;
 });
}

/** Kept as an API alias for older callers; output now follows the public v1/v3
 * contract on the chosen wheel, including exact fractional directions. */
export function exportEditor96(compiled,{acknowledgeWarnings=false}={}){
 if(compiled.audit.warnings.length&&!acknowledgeWarnings)throw new Error('WARNINGS_REQUIRE_ACKNOWLEDGEMENT: geometry validation is not manufacturing approval');
 const {plan}=compiled,source=sourceOf(plan),facets=facetDefinitions(compiled),teeth=plan.machine.teeth;
 const stock=source?.stock??plan.metadata?.sourceDocument?.stock??{kind:'cube',size:2,center:[0,0,0]};
 const doc=source?structuredClone(source):{$schema:'https://yuyou-dev.github.io/OpenGemCutting/schemas/document-v1.schema.json',schemaVersion:1,kind:'facet-96-document',stock};
 doc.name=plan.name;doc.indexGear=normalizeIndexGear(teeth);doc.facets=facets;
 const extended=doc.schemaVersion===3||doc.cuttingReference||doc.concaveCuts||teeth!==96||facets.some(f=>!Number.isInteger(f.index)||!Number.isInteger(f.baseIndex)||!Number.isInteger(f.mirror)||96%f.repeat);
 if(extended){doc.schemaVersion=3;doc.$schema=doc.$schema.replace('v1','v3');doc.concaveCuts??=[];}
 if(source&&compiled.audit.mmPerUnit!==null&&compiled.audit.mmPerUnit!==(source.metadata?.physicalScale?.millimetersPerModelUnit??source.stock?.source?.millimetersPerModelUnit??null)*(stock.size/2))doc.metadata={...doc.metadata,physicalScale:{millimetersPerModelUnit:compiled.audit.mmPerUnit/(stock.size/2)}};
 const geometryChanged=!source||labGeometryKey(doc)!==labGeometryKey(source);
 if(!source||geometryChanged){
  const blueprint=structuredClone(plan);
  delete blueprint.metadata.sourceDocument;
  const previousRecipe=source?.metadata?.labRecipe;
  doc.metadata={...doc.metadata,patternStudy:{...doc.metadata?.patternStudy,version:1,origin:'facet-pattern-lab',
   warnings:compiled.audit.warnings,manufacturingApproved:false,finishRendererRequired:true,liveConstraints:false},
   ...(compiled.audit.mmPerUnit===null?{}:{physicalScale:{millimetersPerModelUnit:compiled.audit.mmPerUnit/(stock.size/2)}})};
  doc.metadata.labRecipe={version:1,labId:'facet-pattern-lab',moduleVersion:pkg.version,status:'current',geometryKey:labGeometryKey(doc),
   data:{plan:blueprint,diagnostics:{skippedBevels:compiled.audit.skippedBevels},...(previousRecipe?{previousRecipe}:{})}};
 }
 const result=refreshLabRecipe(doc),inspection=inspectLabDocument(result);
 if(!inspection.supported)throw new Error(inspection.errors.map(e=>`${e.path}: ${e.message}`).join('; '));
 return {...result,machining:indexExportSummary(result)};
}
export const exportLabDocument=exportEditor96;
const csvCell=s=>`"${String(s).replaceAll('"','""').replace(/^[=+@-]/,"'")}"`;
export function cutCSV(compiled){
 if(!compiled.audit.passed)throw new Error('GEOMETRY_GATE');
 const source=sourceOf(compiled.plan),stock=source?.stock??{size:2,center:[0,0,0]},reference=source?.cuttingReference??stock;
 return ['facet_id,region,gear,index,angle_deg,normal_offset,rotational_depth,surface,ggx_alpha',...compiled.faces.filter(f=>!f.stock).map(f=>{
  const c=planeMachine(f,compiled.plan.machine.teeth),offset=f.offset*stock.size/2+dot(f.normal,stock.center);
  return [csvCell(f.id),c.region,compiled.plan.machine.teeth,c.displayIndex,c.angle.toFixed(8),offset.toFixed(12),envelopeDepth(f.normal,offset,reference.size,reference.center).toFixed(12),f.finish.state,f.finish.alpha].join(',');})].join('\n');
}
