export const EPS = 1e-9;
export const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
export const add = (a,b) => a.map((x,i)=>x+b[i]);
export const sub = (a,b) => a.map((x,i)=>x-b[i]);
export const mul = (a,s) => a.map(x=>x*s);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length = a=>Math.hypot(...a);
export const unit = a=>{const l=length(a);if(l<1e-14)throw new Error('ZERO_VECTOR');return mul(a,1/l);};
export const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
export const rad = x=>x*Math.PI/180;
export const deg = x=>x*180/Math.PI;
export const finite = (x,name)=>{if(!Number.isFinite(x))throw new TypeError(`${name}: finite number required`);return x;};
export const pointKey = (p,t=1e-8)=>p.map(x=>Math.round(x/t)).join(',');
export function frame(n){const u=unit(cross(Math.abs(n[2])<.9?[0,0,1]:[0,1,0],n));return [u,cross(n,u),n];}
export function signedArea(poly){return poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p[0]*q[1]-p[1]*q[0];},0)/2;}
