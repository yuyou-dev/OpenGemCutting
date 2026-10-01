import { dot, add, sub, mul, cross, length, unit, rad } from './math.js';
import {planeMachine} from './machine.js';
import {topology,maxXYWidth} from './polyhedron.js';
const cross2=(a,b)=>a[0]*b[1]-a[1]*b[0];
/** Positive combination of supporting planes preserves the original ridge. Then cut inward.
 * No azimuth rounding: search exact gear directions inside the normal cone, otherwise reject.
 */
export function edgeBevel(a,b,shoulderMm,sizeMm,teeth,mmPerUnit=sizeMm/2,mode='integer'){
 const na=a.normal,nb=b.normal;
 if(length(cross(na,nb))<1e-6)return {error:'COPLANAR'};
 const average=unit(add(na,nb)),center=planeMachine({normal:average},teeth).nearestIndex;
 const choices=[];
 for(let k=0;k<(mode==='exact'?1:teeth);k++){
  const index=mode==='exact'?planeMachine({normal:average},teeth).index:(center+k)%teeth,phi=rad(index*360/teeth),u=[Math.cos(phi),Math.sin(phi)];
  const denominator=cross2(sub(nb,na),u),ca=cross2(na,u);
  let w;if(Math.abs(denominator)<1e-12){if(Math.abs(ca)>1e-9)continue;w=.5;}else w=-ca/denominator;
  if(w<.025||w>.975)continue;
  const raw=add(mul(na,1-w),mul(nb,w)),l=length(raw),n=mul(raw,1/l);
  if(dot(n,[...u,0])<=0)continue;
  const s1=length(cross(n,na)),s2=length(cross(n,nb));if(Math.min(s1,s2)<1e-6)continue;
  const inset=shoulderMm/mmPerUnit*Math.min(s1,s2);
  choices.push({normal:n,offset:((1-w)*a.offset+w*b.offset)/l-inset,index,w,
   shoulderAmm:inset/s1*mmPerUnit,shoulderBmm:inset/s2*mmPerUnit,inset,score:Math.abs(w-.5),azimuthDelta:((index-planeMachine({normal:average},teeth).index+teeth*1.5)%teeth)-teeth/2});
 }
 choices.sort((a,b)=>Math.abs(a.score-b.score)>1e-12?a.score-b.score:a.azimuthDelta-b.azimuthDelta);return choices[0]??{error:'NO_EXACT_GEAR_NORMAL_IN_EDGE_CONE'};
}
export function bevelPolicy(plan, side) {
 const policy = side === 'pavilion' ? plan.bevel?.pavilion : plan.bevel;
 return { enabled: false, shoulderMm: .014, alpha: .28, ...policy };
}
export function crownBevels(faces,policy,sizeMm,teeth,mmPerUnit){
 return regionBevels(faces,policy,sizeMm,teeth,mmPerUnit,'crown');
}
export function regionBevels(faces,policy,sizeMm,teeth,mmPerUnit=sizeMm/maxXYWidth(faces),region='crown'){
 if(!policy?.enabled)return {planes:[],skipped:[]};
 if(mmPerUnit===null)throw new Error('PHYSICAL_SCALE_REQUIRED: 缺少毫米尺度，不能生成毫米肩宽细面。');
 const width=policy.shoulderMm??.015;if(!Number.isFinite(width)||width<.001||width>.2)throw new RangeError('BEVEL_SHOULDER: .001..0.2 mm');
 const byId=new Map(faces.map(f=>[f.id,f])),planes=[],skipped=[];
 for(const e of topology(faces).edges){
  if(e.faces.length!==2)continue;const [a,b]=e.faces.map(id=>byId.get(id));
  const direction=region==='pavilion'?-1:1;
  if(a.normal[2]*direction<.1||b.normal[2]*direction<.1||a.stock||b.stock)continue;
  const pair=[a.id,b.id].sort(),id=`bevel:${pair.map(encodeURIComponent).join('|')}`;
  if(policy.edgeIds&&!policy.edgeIds.includes(id))continue;
  const result=edgeBevel(a,b,width,sizeMm,teeth,mmPerUnit,policy.mode);
  if(result.error){skipped.push({id,parents:pair,reason:result.error,requestedShoulderMm:width,generated:false});continue;}
  planes.push({id,region,normal:result.normal,offset:result.offset,bevel:true,
   finish:{state:'frosted',alpha:policy.alpha??.25},parents:pair,
   construction:{type:'support-cone-bevel',weight:result.w,shoulderAmm:result.shoulderAmm,shoulderBmm:result.shoulderBmm}});
 }
 return {planes,skipped};
}
