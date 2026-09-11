import { resolveFacetPattern, rotationalStockSupportOffset } from './faceting.js';
import { enumerateTopologyVertices, enumerateTopologyEdges, createEdgeMeetTarget } from './meetJump.js';

const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
/** Enumerate executable azimuths without silently rounding a requested direction. */
export function indexCandidates(angleDegrees, radius = 2) {
  const center = Math.round(angleDegrees / 3.75);
  return Array.from({length:2*radius+1},(_,i)=>((center+i-radius)%96+96)%96)
    .map(index=>({index,errorDegrees:Math.abs(((index*3.75-angleDegrees+180)%360+360)%360-180)}))
    .sort((a,b)=>a.errorDegrees-b.errorDegrees || a.index-b.index);
}
/** One shared plane through two 3D nodes at a chosen, exact machine index. */
export function planeThroughNodes(index, a, b, region = 'crown') {
  if (!Number.isInteger(index) || index<0 || index>95) throw new RangeError('Expected integer index 0..95');
  const u=[Math.cos(index*Math.PI/48),Math.sin(index*Math.PI/48)];
  const dz=b[2]-a[2];
  if(Math.abs(dz)<1e-10) throw new Error('Equal-height nodes constrain azimuth but do not determine inclination; supply a third node at another height.');
  const k=-(u[0]*(b[0]-a[0])+u[1]*(b[1]-a[1]))/dz;
  if((region==='crown' && k<=0)||(region==='pavilion' && k>=0)) throw new Error('Plane points outside the requested region');
  const length=Math.hypot(1,k),normal=[u[0]/length,u[1]/length,k/length];
  return {normal,offset:dot(normal,a)};
}
/** All assigned shared nodes and every protected node must pass, before a CUT is emitted. */
export function inspectPlane(plane, nodes, protectedNodes = [], tolerance = 1e-7) {
  const residuals=nodes.map(point=>Math.abs(dot(plane.normal,point)-plane.offset));
  const removed=protectedNodes.map((point,i)=>({i,distance:dot(plane.normal,point)-plane.offset})).filter(v=>v.distance>tolerance);
  return {passed:residuals.every(v=>v<=tolerance)&&!removed.length,residuals,removed};
}
export function patternFromPlane({normal,offset}, {id,label=id,region,baseIndex,repeat=1,mirror=0,stock}) {
  const length=Math.hypot(...normal);normal=normal.map(v=>v/length);offset/=length;
  const industryAngleDeg=Math.atan2(Math.hypot(normal[0],normal[1]),Math.abs(normal[2]))*180/Math.PI;
  const n={x:normal[0],y:normal[1],z:normal[2]};
  const depth=rotationalStockSupportOffset(n,stock)-offset;
  const facets=resolveFacetPattern({patternId:id,label,region,baseIndex,repeat,mirror,industryAngleDeg,depth},{stock});
  const actual=facets.find(f=>f.index===baseIndex).plane;
  if(Math.max(...['x','y','z'].map((key,i)=>Math.abs(actual.normal[key]-normal[i])))>1e-7) throw new Error(`${id}: plane azimuth does not match exact index ${baseIndex}`);
  return facets;
}
/** Bind only an actual prefix vertex or an actual prefix edge point. Never synthesize provenance. */
export function findPrefixTarget(solid, point, tolerance=1e-7) {
  const vertices=enumerateTopologyVertices(solid);
  const match=vertices.find(t=>Math.hypot(...point.map((v,i)=>v-t.fallbackWorldPoint[i]))<=tolerance);
  if(match)return match;
  for(const edge of enumerateTopologyEdges(solid,{targets:vertices})) {
    const [a,b]=edge.endpoints.map(t=>t.fallbackWorldPoint),v=b.map((x,i)=>x-a[i]);
    const ratio=dot(point.map((x,i)=>x-a[i]),v)/dot(v,v);
    if(ratio<=0||ratio>=1)continue;
    if(Math.hypot(...point.map((x,i)=>x-a[i]-ratio*v[i]))<=tolerance)return createEdgeMeetTarget(edge,ratio);
  }
  return null;
}
