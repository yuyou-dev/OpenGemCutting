import { observationRGB } from './observation.js';
import { rad, dot, cross, normalize, spherical, mul, add, smoothstep, hexToLinear, clamp } from './math.js';
export function lightBasis(light,rotation=0){const axis=spherical(light.azimuth+rotation,light.elevation);let u=normalize(cross([0,0,1],axis));if(Math.abs(axis[2])>.999)u=[1,0,0];const v=cross(axis,u),r=rad(light.roll);return {axis,u:add(mul(u,Math.cos(r)),mul(v,Math.sin(r))),v:add(mul(u,-Math.sin(r)),mul(v,Math.cos(r)))};}
export function lightCoverage(light,direction,rotation=0){
 const b=lightBasis(light,rotation),z=dot(direction,b.axis);if(z<=0)return 0;
 const x=Math.atan2(dot(direction,b.u),z)/(rad(light.width)/2),y=Math.atan2(dot(direction,b.v),z)/(rad(light.shape==='rect'?light.height:light.width)/2);
 const metric=light.shape==='rect'?Math.max(Math.abs(x),Math.abs(y)):Math.acos(clamp(z,-1,1))/(rad(light.width)/2),s=Math.max(.002,light.softness);
 let mask=1-smoothstep(1-s,1,metric);if(light.shape==='ring')mask*=smoothstep(light.innerRatio??.64,(light.innerRatio??.64)+s,metric);return mask;
}
/** Planck spectral power relative to 550 nm. CCT is an illustrative blackbody approximation. */
export function planckRelative(wavelengthNm,kelvin){const l=wavelengthNm/1000,t=clamp(kelvin,1200,20000);return Math.pow(.55/l,5)*Math.expm1(14387.76877/(.55*t))/Math.expm1(14387.76877/(l*t));}
export function temperatureRGB(kelvin){return [610,550,460].map(l=>planckRelative(l,kelvin)/planckRelative(l,6500));}
export function environmentRGB(env,direction,observer=null,headAngle=0){
 if(env.observation?.kind&&env.observation.kind!=='none')return observationRGB(env.observation,direction,observer??[0,0,1]);
 if(observer&&headAngle>0&&dot(direction,observer)>Math.cos(rad(headAngle)))return [0,0,0];
 let rgb=[1,1,1].map(()=>direction[2]>=0?env.ambient:env.lower),occlusion=1;
 for(const l of env.lights){if(!l.enabled||(env.solo&&env.solo!==l.id))continue;const w=lightCoverage(l,direction,env.rotation);if(!w)continue;if(l.blocker){occlusion*=1-w;continue;}const c=hexToLinear(l.tint),t=temperatureRGB(l.temperature),power=Math.pow(2,l.ev)*w;rgb=rgb.map((v,i)=>v+c[i]*t[i]*power);}
 return rgb.map(v=>v*occlusion);
}
export function packLights(environment){
 const active=environment.lights.filter(l=>l.enabled&&(!environment.solo||environment.solo===l.id));
 const data=[];
 for(const l of active){const b=lightBasis(l,environment.rotation),color=hexToLinear(l.tint),temp=temperatureRGB(l.temperature);data.push([...b.axis,l.blocker?-1:Math.pow(2,l.ev)],[...b.u,rad(l.width)/2],[...b.v,rad(l.shape==='rect'?l.height:l.width)/2],[...color.map((v,i)=>v*temp[i]),l.shape==='rect'?0:l.shape==='disc'?1:2],[l.softness,l.temperature,l.innerRatio??.64,0],[...color,0]);}
 return {data,count:active.length};
}
