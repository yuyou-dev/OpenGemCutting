/** Small, allocation-explicit vector library. Geometry uses Float64 on the CPU. */
export const PI = Math.PI;
export const EPS = 2e-5;
export const rad = d => d * Math.PI / 180;
export const deg = r => r * 180 / Math.PI;
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
export const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length = a => Math.hypot(...a);
export const normalize = a => { const l=length(a); return l>1e-14 ? mul(a,1/l) : [0,0,1]; };
export const reflect = (d,n) => sub(d,mul(n,2*dot(d,n)));
export const mix = (a,b,t) => a+(b-a)*t;
export const smoothstep = (lo,hi,x) => { const t=clamp((x-lo)/(hi-lo),0,1);return t*t*(3-2*t); };
export const vector = v => Array.isArray(v) ? v.slice(0,3) : [v?.x,v?.y,v?.z];
export const finiteVector = v => Array.isArray(v) && v.length===3 && v.every(Number.isFinite);
export function boundsOf(vertices) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for (const v of vertices) for(let i=0;i<3;i++){min[i]=Math.min(min[i],v[i]);max[i]=Math.max(max[i],v[i]);}
  return {min,max,center:mul(add(min,max),0.5),size:sub(max,min)};
}
export function spherical(azimuth,elevation) {
  const a=rad(azimuth),e=rad(elevation);return [Math.cos(e)*Math.cos(a),Math.cos(e)*Math.sin(a),Math.sin(e)];
}
export function cameraBasis(view) {
  const theta=rad(view.tilt),phi=rad(view.azimuth);
  const eye=[Math.sin(theta)*Math.cos(phi),Math.sin(theta)*Math.sin(phi),Math.cos(theta)];
  const right=[-Math.sin(phi),Math.cos(phi),0];
  const up=normalize(cross(eye,right));
  return {eye,right,up,forward:mul(eye,-1)};
}
export function cameraRay(view,x,y,aspect=1) {
  const b=cameraBasis(view),span=view.span/view.zoom;
  const origin=add(mul(b.eye,5),add(mul(b.right,(x*aspect+view.panX)*span),mul(b.up,(y+view.panY)*span)));
  return {origin,direction:b.forward};
}
export function srgbToLinear(v){return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
export function linearToSrgb(v){return v<=0.0031308?12.92*v:1.055*Math.pow(Math.max(0,v),1/2.4)-0.055;}
export function hexToLinear(hex){return [1,3,5].map(i=>srgbToLinear(parseInt(hex.slice(i,i+2),16)/255));}
export const luminance = rgb => dot(rgb,[0.2126,0.7152,0.0722]);
export const safeText = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function hashString(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
export function stableStringify(v){if(Array.isArray(v))return '['+v.map(stableStringify).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}';return JSON.stringify(v);}
