import { dot, unit, rad, deg, finite } from './math.js';
import { normalizeIndexTeeth, DEFAULT_INDEX_TEETH, INDEX_TOLERANCE_DEG } from '../../../vendor/labs-contract/1.0.0/index.js';
export function machine(teeth=DEFAULT_INDEX_TEETH){normalizeIndexTeeth(teeth);return {teeth,mode:'integer',degreesPerTooth:360/teeth};}
export function symmetryCompatible(teeth,n){machine(teeth);return Number.isInteger(n)&&n>0&&teeth%n===0;}
export function indexNormal(index,angle,region='crown',teeth=96){
 const m=machine(teeth); if(!Number.isFinite(index)||index<0||index>=teeth)throw new RangeError('INDEX: finite canonical index required');
 finite(angle,'angle'); if(angle<0||angle>90||!['crown','pavilion','girdle'].includes(region))throw new RangeError('ANGLE_OR_REGION');
 const p=rad(index*m.degreesPerTooth),a=rad(region==='girdle'?90:angle);
 return [Math.sin(a)*Math.cos(p),Math.sin(a)*Math.sin(p),(region==='pavilion'?-1:1)*Math.cos(a)];
}
export function planeMachine(p,teeth=96,toleranceDeg=INDEX_TOLERANCE_DEG){
 const m=machine(teeth),n=unit(p.normal); const r=Math.hypot(n[0],n[1]);
 const angle=deg(Math.atan2(r,Math.abs(n[2]))); const azimuth=r<1e-12?0:(deg(Math.atan2(n[1],n[0]))+360)%360;
 const raw=azimuth/m.degreesPerTooth,nearestIndex=Math.round(raw)%teeth;
 const index=Math.abs(raw-Math.round(raw))<1e-10?nearestIndex:raw;
 const errorDeg=r<1e-12?0:Math.abs(((nearestIndex*m.degreesPerTooth-azimuth+540)%360)-180);
 return {index,nearestIndex,displayIndex:index||teeth,angle,azimuth,errorDeg,exact:errorDeg<=toleranceDeg,region:Math.abs(n[2])<1e-9?'girdle':n[2]>0?'crown':'pavilion'};
}
export function exactPlane(p,teeth=96){const c=planeMachine(p,teeth);if(!c.exact)throw Object.assign(new Error(`OFF_GEAR: ${p.id||'plane'} differs by ${c.errorDeg.toFixed(6)} degrees from gear ${teeth}`),{code:'OFF_GEAR',details:c});return c;}
/** Existing editor convention: depth is measured from the rotational envelope, not cube support. */
export function envelopeDepth(normal,offset,size=2,center=[0,0,0]){return dot(normal,center)+size/2*(Math.hypot(normal[0],normal[1])+Math.abs(normal[2]))-offset;}
export function planeThroughTwoNodes(a,b,index,teeth=96,region='crown'){
 const phi=rad(index*360/machine(teeth).teeth),dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
 if(Math.abs(dz)<1e-12)throw new Error('UNDERDETERMINED: equal-height nodes need a third node or a fixed inclination');
 const k=-(Math.cos(phi)*dx+Math.sin(phi)*dy)/dz;
 if((region==='crown'&&k<=0)||(region==='pavilion'&&k>=0))throw new Error('REGION_MISMATCH');
 const normal=unit([Math.cos(phi),Math.sin(phi),k]);return {normal,offset:dot(normal,a)};
}
