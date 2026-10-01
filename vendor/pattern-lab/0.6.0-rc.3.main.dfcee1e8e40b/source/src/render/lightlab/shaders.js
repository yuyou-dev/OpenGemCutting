import { traceShader as lightLabTrace } from './upstreamShaders.js';
import { traceShader as acceptedTrace } from '../shaders.js';

// upstreamShaders.js is the unmodified LightLab 883b139 delivery. Keep its
// polished transport, emitter radiance, observation and spectral equations.
// Read the accepted GGX equations directly so future fixes cannot diverge here.
export const acceptedGGX = acceptedTrace.slice(acceptedTrace.indexOf('float fresnel('), acceptedTrace.indexOf('vec3 capAxis('));
const sampling = acceptedTrace.slice(acceptedTrace.indexOf('float powerHeuristic('), acceptedTrace.indexOf('vec3 rotateZ('));
const intersection = acceptedTrace.slice(acceptedTrace.indexOf('float boxNear('), acceptedTrace.indexOf('float fresnel(')).replaceAll('EPS', 'ROUGH_EPS').replace('bool hit(', 'bool facetHit(');

const roughTransport = `
const float ROUGH_EPS=.000002;
uniform sampler2D uMaterials;
uniform int uRough,uNEE,uCount,uTraversal;
uint raySeed;
float rnd(){return randomValue();}
vec4 get1(sampler2D t,int i){return fetch1(t,i);}
${sampling}
${intersection}
${acceptedGGX}
float environmentPdf(vec3 d){
 if(uLightCount==0||uObservation>0||uMode!=0)return 1./(4.*PI);
 float pdf=.25/(4.*PI);
 for(int i=0;i<uLightCount;i++){
  vec3 axis=fetch1(uLights,i*6).xyz;float c=fetch1(uLights,i*6+4).w;
  if(dot(d,axis)>=c)pdf+=.75/(float(uLightCount)*2.*PI*(1.-c));
 }return pdf;
}
vec3 sampleEnvironment(){
 bool uniformSphere=uLightCount==0||uObservation>0||uMode!=0||rnd()<.25;
 float phi=2.*PI*rnd(),z;vec3 axis=vec3(0,0,1);
 if(uniformSphere)z=1.-2.*rnd();
 else{int i=min(uLightCount-1,int(rnd()*float(uLightCount)));axis=fetch1(uLights,i*6).xyz;z=mix(fetch1(uLights,i*6+4).w,1.,rnd());}
 return basis(axis)*vec3(sqrt(max(0.,1.-z*z))*cos(phi),sqrt(max(0.,1.-z*z))*sin(phi),z);
}
vec3 traceRough(vec3 ro,vec3 rd,float ior,float sigma,float wavelength){
 randomState=raySeed;
 vec3 throughput=vec3(1),result=vec3(0),lastN=vec3(0,0,1);
 bool inside=false,lastDelta=true;float lastPdf=0.,path=0.;
 for(int bounce=0;bounce<96;bounce++){
  float t;vec3 n;int slot;
  if(!facetHit(ro,rd,t,n,slot)){
   if(bounce==0)return uBackground;
   float w=lastDelta||uNEE==0?1.:powerHeuristic(lastPdf,environmentPdf(rd));
   return result+throughput*exitRadiance(rd,lastN,path,bounce,wavelength)*w;
  }
  if(bounce>=uMaxBounces)return result+throughput*residualColor();
  if(inside){path+=t*uMmPerUnit;throughput*=exp(-sigma*t*uMmPerUnit);}
  bool enter=dot(rd,n)<0.;vec3 N=enter?n:-n,p=ro+rd*t;
  float eta=enter?ior:1./ior;vec4 material=get1(uMaterials,slot);
  float alpha=material.x,scatter=material.y;lastN=n;
  mat3 B=basis(N);vec3 wo=transpose(B)*(-rd);
  if(wo.z<=0.)return result;
  if(alpha<.0001){
   float F=fresnel(wo.z,eta);vec3 tr=refract(rd,N,1./eta);
   bool reflected=rnd()<F;
   if(reflected)rd=reflect(rd,N);else{if(dot(tr,tr)<.1)return result;rd=normalize(tr);throughput/=eta*eta;}
   inside=dot(rd,n)<0.;lastDelta=true;lastPdf=0.;
  }else{
   if(uNEE==1){vec3 light=sampleEnvironment();if(dot(light,n)>0.){
    vec3 wi=transpose(B)*light;vec2 e=evalBSDF(wo,wi,alpha,eta,scatter);float lp=environmentPdf(light);
    if(lp>0.&&e.y>0.)result+=throughput*exitRadiance(light,n,path,bounce,wavelength)*(e.x*abs(wi.z)/lp)*powerHeuristic(lp,e.y);
   }}
   vec3 wi;
   if(rnd()<scatter){float r=sqrt(rnd()),a=2.*PI*rnd();wi=vec3(r*cos(a),r*sin(a),sqrt(max(0.,1.-r*r)));}
   else{vec3 m=visibleNormal(wo,alpha);float F=fresnel(dot(wo,m),eta);bool reflected=rnd()<F;
    wi=reflected?reflect(-wo,m):refract(-wo,m,1./eta);
    if(dot(wi,wi)<.1||(reflected&&wi.z<=0.)||(!reflected&&wi.z>=0.))return result;
   }
   vec2 e=evalBSDF(wo,wi,alpha,eta,scatter);if(e.y<1e-20)return result;
   throughput*=e.x*abs(wi.z)/e.y;lastPdf=e.y;lastDelta=false;rd=normalize(B*wi);inside=dot(rd,n)<0.;
  }
  ro=p+(inside?-n:n)*ROUGH_EPS*5.;
  if(bounce>6){float etaComp=inside?ior*ior:1.;float pContinue=clamp(max(throughput.r,max(throughput.g,throughput.b))*etaComp,.08,.95);
   if(rnd()>pContinue)return result;throughput/=pContinue;}
  if(max(throughput.r,max(throughput.g,throughput.b))<1e-10)return result;
 }
 return result;
}
`;

export const traceShader = lightLabTrace
  .replaceAll('vUv', 'uv')
  .replace('out vec4 outColor;', 'layout(location=0) out vec4 outColor;\nlayout(location=1) out vec4 outGuide;')
  .replace('uniform vec3 uEye,uRight,uUp;', 'uniform vec3 uEye,uRight,uUp,uCenter,uCameraOffset;\nuniform float uDistance;')
  .replace('vec3 traceRay(', `${roughTransport}\nvec3 traceRay(`)
  .replace('return uMesh==0?traceConvex(o,d,ior,sigma,wavelength):traceMesh(o,d,ior,sigma,wavelength);', 'return uRough==1?traceRough(o,d,ior,sigma,wavelength):traceConvex(o,d,ior,sigma,wavelength);')
  .replace('vec2 q=(uv+uJitter/uResolution)*2.0-1.0;', 'raySeed=randomState;\n vec2 q=(uv+uJitter/uResolution)*2.0-1.0;')
  .replace('vec3 o=uEye*5.0+', 'vec3 o=uCenter+uCameraOffset+uEye*uDistance+')
  .replace('if(uAccumulate&&uSample>0.0){vec3 previous=texelFetch(uPrevious,pix,0).rgb;color=mix(previous,color,1.0/(uSample+1.0));}\n outColor=vec4(color,hit?1.0:0.0);', `float luminance=dot(color,vec3(.2126,.7152,.0722));
 vec4 value=vec4(color,luminance*luminance);
 outColor=uSample>0.?mix(texelFetch(uPrevious,pix,0),value,1./(uSample+1.)):value;
 vec2 film=uv*2.-1.;
 vec3 guideOrigin=uCenter+uCameraOffset+uEye*uDistance+uRight*(film.x*uAspect*uSpan)+uUp*(film.y*uSpan);
 float guideT;vec3 guideN;int guideSlot;
 outGuide=facetHit(guideOrigin,-uEye,guideT,guideN,guideSlot)?vec4(guideN,float(guideSlot+1)):vec4(0);`);

// LightLab's display equations with the accepted optional same-facet filter.
// The filter only changes display pixels; linear accumulation is never altered.
export const displayShader = `#version 300 es
precision highp float;
uniform sampler2D uImage,uGuide;
uniform float uExposure,uSamples;
uniform int uTone,uMode,uDenoise,uRough;
in vec2 uv;out vec4 outColor;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
void main(){
 ivec2 size=textureSize(uImage,0),pixel=clamp(ivec2(uv*vec2(size)),ivec2(0),size-1);
 vec4 central=texelFetch(uImage,pixel,0),guide=texelFetch(uGuide,pixel,0);vec3 c=central.rgb;
 if(uDenoise==1&&uRough==1&&uMode==0&&guide.w>.5){
  float l=dot(c,vec3(.2126,.7152,.0722)),variance=max(0.,central.a-l*l),sigma=sqrt(variance/max(uSamples,1.))+.025;
  vec3 sum=vec3(0);float weights=0.;
  for(int y=-3;y<=3;y++)for(int x=-3;x<=3;x++){
   ivec2 p=clamp(pixel+ivec2(x,y),ivec2(0),size-1);vec4 g=texelFetch(uGuide,p,0);
   if(abs(g.w-guide.w)>.1||dot(g.xyz,guide.xyz)<.995)continue;
   vec3 v=texelFetch(uImage,p,0).rgb;float nl=dot(v,vec3(.2126,.7152,.0722));
   float weight=exp(-float(x*x+y*y)/7.)*exp(-abs(nl-l)/(sigma*4.));sum+=v*weight;weights+=weight;
  }c=sum/max(weights,1e-8);
 }
 if(uMode==0&&guide.w>.5){c*=exp2(uExposure);if(uTone==0)c=aces(c);else if(uTone==1)c=c/(vec3(1)+c);else c=clamp(c,0.0,1.0);}
 outColor=vec4(srgb(max(vec3(0),c)),1.0);
}`;
