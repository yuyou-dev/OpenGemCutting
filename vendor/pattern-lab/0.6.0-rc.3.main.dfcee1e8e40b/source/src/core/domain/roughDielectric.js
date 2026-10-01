import {dot,add,mul,cross,unit,clamp} from './math.js';
export function fresnel(c,etaI,etaT){
 c=clamp(Math.abs(c),0,1);const r=etaI/etaT,s=r*r*(1-c*c);if(s>=1)return 1;
 const t=Math.sqrt(Math.max(0,1-s)),rs=(etaI*c-etaT*t)/(etaI*c+etaT*t),rp=(etaT*c-etaI*t)/(etaT*c+etaI*t);return (rs*rs+rp*rp)/2;
}
export function lambdaGGX(v,alpha){const z2=v[2]*v[2];return z2<1e-20?1e10:(Math.sqrt(1+alpha*alpha*(v[0]*v[0]+v[1]*v[1])/z2)-1)/2;}
export function distributionGGX(m,alpha){if(m[2]<=0)return 0;const a2=alpha*alpha,d=m[2]*m[2]*(a2-1)+1;return a2/(Math.PI*d*d);}
/** Isotropic visible-normal disk sampler. Heitz 2018; implementation written for this study. */
export function sampleVNDF(wo,alpha,u1,u2){
 if(wo[2]<=0||alpha<=0||!Number.isFinite(alpha))throw new Error('VNDF_DOMAIN');
 const v=unit([alpha*wo[0],alpha*wo[1],wo[2]]),l=v[0]*v[0]+v[1]*v[1];
 const t1=l>1e-20?[-v[1]/Math.sqrt(l),v[0]/Math.sqrt(l),0]:[1,0,0],t2=cross(v,t1);
 const r=Math.sqrt(clamp(u1,0,1-Number.EPSILON)),phi=2*Math.PI*clamp(u2,0,1-Number.EPSILON),a=r*Math.cos(phi),s=.5*(1+v[2]);
 const b=(1-s)*Math.sqrt(Math.max(0,1-a*a))+s*r*Math.sin(phi);
 const h=add(add(mul(t1,a),mul(t2,b)),mul(v,Math.sqrt(Math.max(0,1-a*a-b*b))));
 return unit([alpha*h[0],alpha*h[1],Math.max(1e-15,h[2])]);
}
function reflect(wo,m){return add(mul(wo,-1),mul(m,2*dot(wo,m)));}
function transmit(wo,m,r){const c=dot(wo,m),k=1-r*r*(1-c*c);if(k<0)return null;return add(mul(wo,-r),mul(m,r*c-Math.sqrt(k)));}
/** Density and f evaluation independent of the sampler; all directions point away from interface.
 * wo.z > 0; etaI and etaT refer to the macro-normal-defined incident/other media.
 */
export function evaluateDielectric(wo,wi,alpha,etaI=1,etaT=1.54){
 if(wo[2]<=0||Math.abs(wi[2])<1e-12||alpha<=0)return {f:0,pdf:0};
 const reflection=wi[2]>0,eta=etaT/etaI,raw=add(wo,mul(wi,reflection?1:eta));if(Math.hypot(...raw)<1e-12)return {f:0,pdf:0};
 let m=unit(raw);if(m[2]<0)m=mul(m,-1);const co=dot(wo,m),ci=dot(wi,m);
 if(co<=0||ci*wi[2]<=0)return {f:0,pdf:0};
 const F=fresnel(co,etaI,etaT),D=distributionGGX(m,alpha),lo=lambdaGGX(wo,alpha),li=lambdaGGX(wi,alpha),G=1/(1+lo+li),pm=D/(1+lo)*co/wo[2];
 if(reflection)return {f:D*G*F/(4*Math.abs(wo[2]*wi[2])),pdf:F*pm/(4*Math.abs(co))};
 const den=(ci+co/eta)**2;if(den<1e-25)return {f:0,pdf:0};
 return {f:D*(1-F)*G*Math.abs(ci*co/(wo[2]*wi[2]*den))/(eta*eta),pdf:(1-F)*pm*Math.abs(ci)/den};
}
export function sampleDielectric(wo,alpha,etaI,etaT,u1,u2,branch){
 if(wo[2]<=0||alpha<0||alpha>1||etaI<=0||etaT<=0)throw new Error('BSDF_DOMAIN');
 const m=alpha<1e-5?[0,0,1]:sampleVNDF(wo,alpha,u1,u2),F=fresnel(dot(wo,m),etaI,etaT),reflection=branch<F;
 const wi=reflection?reflect(wo,m):transmit(wo,m,etaI/etaT);
 if(!wi||reflection&&wi[2]<=0||!reflection&&wi[2]>=0)return {valid:false,weight:0,reflection};
 const mask=alpha<1e-5?1:(1+lambdaGGX(wo,alpha))/(1+lambdaGGX(wo,alpha)+lambdaGGX(wi,alpha));
 const weight=mask*(reflection?1:(etaI/etaT)**2);
 return {valid:true,wi,wm:m,reflection,weight,...(alpha>=1e-5?evaluateDielectric(wo,wi,alpha,etaI,etaT):{delta:true,probability:reflection?F:1-F})};
}
export function seededRandom(seed=1){let s=seed>>>0||1;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};}
