// Accepted external source: Facet-Pattern-Lab-Analytic/src/optics.js
// SHA-256: b487416867f84ebacd51fc29d582c756617b2c6b0b29519f16934ebaad9928ba
// Shader transport and display equations are preserved from that delivery.
/* WebGL2 convex-gem tracer. Median BVH, exact dielectric Fresnel,
 * GGX visible normals, light/BSDF MIS, deterministic splitting of delta paths,
 * linear accumulation. The display filter is optional and explicitly biased.
 * Reference: PBRT v4 rough dielectric / better path tracer; Heitz 2018.
 */
export const vertexShader=`#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
export const traceShader=`#version 300 es
precision highp float;
precision highp int;
in vec2 uv;
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outGuide;
uniform sampler2D uNodes,uTriangles,uPlanes,uMaterials,uPrevious;
uniform vec2 uResolution;
uniform vec3 uEye,uRight,uUp,uCenter,uCameraOffset,uSigma;
uniform int uSample,uBudget,uCompare,uMode,uEnv,uIntegrator,uSpectral,uNEE,uCount,uTraversal;
uniform float uAspect,uSpan,uIor,uDispersion,uScale,uRotation,uDistance,uStageZ,uPatternScale;
const float PI=3.141592653589793, EPS=0.000002;
uint seed;int dimension;
vec4 get1(sampler2D t,int i){return texelFetch(t,ivec2(i%1024,i/1024),0);}
uint mixbits(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}
float rnd(){ // Hashed pseudorandom dimensions, shared across RGB bands and A/B views.
 uint s=mixbits(seed+uint(dimension++)*0x9e3779b9u);
 uint v=mixbits(uint(uSample+1)^s);return (float(v>>8)+.5)/16777216.;
}
float powerHeuristic(float a,float b){a*=a;b*=b;return a/max(a+b,1e-30);}
mat3 basis(vec3 n){vec3 t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n));return mat3(t,cross(n,t),n);}
vec3 rotateZ(vec3 d,float a){float c=cos(a),s=sin(a);return vec3(c*d.x-s*d.y,s*d.x+c*d.y,d.z);}
float boxNear(vec3 ro,vec3 rd,vec3 lo,vec3 hi,float limit){
 float a=EPS,b=limit;
 for(int j=0;j<3;j++){
  if(abs(rd[j])<1e-10){if(ro[j]<lo[j]||ro[j]>hi[j])return 1e30;}
  else {float x=(lo[j]-ro[j])/rd[j],y=(hi[j]-ro[j])/rd[j];a=max(a,min(x,y));b=min(b,max(x,y));if(a>b)return 1e30;}
 }return a;
}
bool hitBVH(vec3 ro,vec3 rd,out float distance,out vec3 normal,out int slot){
 int stack[64];int sp=0;stack[0]=0;distance=1e25;slot=-1;
 for(int iter=0;iter<4096;iter++){
  if(sp<0)break;int id=stack[sp--];vec4 lo=get1(uNodes,id*2),hi=get1(uNodes,id*2+1);
  if(boxNear(ro,rd,lo.xyz,hi.xyz,distance)>distance)continue;
  if(lo.w<0.){int start=int(-lo.w)-1,count=int(hi.w);
   for(int j=0;j<4;j++){if(j>=count)break;int ti=(start+j)*3;
    vec4 a=get1(uTriangles,ti);vec3 e1=get1(uTriangles,ti+1).xyz-a.xyz,e2=get1(uTriangles,ti+2).xyz-a.xyz;
    vec3 p=cross(rd,e2);float det=dot(e1,p);if(abs(det)<1e-11)continue;
    vec3 t=ro-a.xyz;float u=dot(t,p)/det;if(u<-.000001||u>1.000001)continue;
    vec3 q=cross(t,e1);float v=dot(rd,q)/det;if(v<-.000001||u+v>1.000001)continue;
    float z=dot(e2,q)/det;if(z>EPS&&z<distance){distance=z;slot=int(a.w);}
   }
  }else{if(sp<61){stack[++sp]=int(hi.w);stack[++sp]=int(lo.w);}}
 }
 if(slot<0)return false;normal=get1(uPlanes,slot).xyz;return true;
}
bool hit(vec3 ro,vec3 rd,out float distance,out vec3 normal,out int slot){
 if(uTraversal==1)return hitBVH(ro,rd,distance,normal,slot);
 float lo=-1e25,hi=1e25;int lowId=-1,highId=-1;
 for(int i=0;i<768;i++){if(i>=uCount)break;vec4 p=get1(uPlanes,i);float den=dot(p.xyz,rd),off=p.w-dot(p.xyz,ro);
  if(abs(den)<1e-10){if(off<0.)return false;continue;}
  float t=off/den;if(den<0.){if(t>lo){lo=t;lowId=i;}}else{if(t<hi){hi=t;highId=i;}}
  if(lo>hi)return false;
 }
 if(hi<EPS)return false;if(lo>EPS){distance=lo;slot=lowId;}else{distance=hi;slot=highId;}
 if(slot<0)return false;normal=get1(uPlanes,slot).xyz;return true;
}
float fresnel(float c,float eta){
 c=clamp(abs(c),0.,1.);float ss=(1.-c*c)/(eta*eta);if(ss>=1.)return 1.;
 float t=sqrt(max(0.,1.-ss));float a=(c-eta*t)/(c+eta*t),b=(eta*c-t)/(eta*c+t);return .5*(a*a+b*b);
}
float lambda(vec3 v,float a){return .5*(sqrt(1.+a*a*dot(v.xy,v.xy)/max(v.z*v.z,1e-20))-1.);}
float Dggx(vec3 m,float a){float t=(a*a-1.)*m.z*m.z+1.;return a*a/(PI*t*t);}
vec3 visibleNormal(vec3 wo,float a){
 vec3 v=normalize(vec3(a*wo.xy,wo.z));float l=dot(v.xy,v.xy);
 vec3 t1=l>1e-20?vec3(-v.y,v.x,0.)/sqrt(l):vec3(1,0,0),t2=cross(v,t1);
 float r=sqrt(rnd()),phi=2.*PI*rnd(),x=r*cos(phi),s=.5*(1.+v.z),y=(1.-s)*sqrt(max(0.,1.-x*x))+s*r*sin(phi);
 vec3 h=x*t1+y*t2+sqrt(max(0.,1.-x*x-y*y))*v;
 return normalize(vec3(a*h.xy,max(1e-10,h.z)));
}
// Return f and the matching mixture sampling PDF. eta = transmitted / incident.
vec2 evalBSDF(vec3 wo,vec3 wi,float alpha,float eta,float scatter){
 if(wo.z<=0.||abs(wi.z)<1e-8)return vec2(0);
 bool refl=wi.z>0.;vec3 hh=wo+(refl?wi:wi*eta);if(dot(hh,hh)<1e-18)return vec2(0);
 vec3 m=normalize(hh);if(m.z<0.)m=-m;
 float om=dot(wo,m),im=dot(wi,m);float f=0.,pdf=0.;
 if(om>0.&&im*wi.z>0.){
  float F=fresnel(om,eta),D=Dggx(m,alpha),G1=1./(1.+lambda(wo,alpha)),G=1./(1.+lambda(wo,alpha)+lambda(wi,alpha));
  float pm=D*G1*om/wo.z;
  if(refl){f=F*D*G/(4.*wo.z*wi.z);pdf=F*pm/(4.*om);}
  else{float den=im+om/eta;den*=den;
   f=(1.-F)*D*G*abs(im*om/(wo.z*wi.z*den))/(eta*eta);
   pdf=(1.-F)*pm*abs(im)/den;
  }
 }
 f*=1.-scatter;pdf*=1.-scatter;
 if(refl){f+=scatter*.9/PI;pdf+=scatter*wi.z/PI;}
 return vec2(f,pdf);
}
vec3 capAxis(int i){return i==0?normalize(vec3(-.45,.3,1.)):i==1?normalize(vec3(.8,.5,.55)):normalize(vec3(.15,-.9,.2));}
float capCos(int i){return uEnv==2?(i==2?.997:.985):(i==0?.73:i==1?.84:.92);}
float envPdf(vec3 direction){
 if(uEnv==1||uEnv==3)return 1./(4.*PI);
 vec3 d=rotateZ(direction,-uRotation);float p=.25/(4.*PI);
 for(int i=0;i<3;i++)if(dot(d,capAxis(i))>=capCos(i))p+=.25/(2.*PI*(1.-capCos(i)));
 return p;
}
vec3 environment(vec3 direction){
 vec3 d=rotateZ(direction,-uRotation);
 if(uEnv==3)return vec3(1.);
 if(uEnv==1){float pattern=step(0.,sin(atan(d.x,-d.z)*18.));return vec3(mix(.035,1.7,pattern));}
 vec3 c=vec3(d.z>0.?.15:.07);
 for(int i=0;i<3;i++){float k=dot(d,capAxis(i)),edge=capCos(i),s=smoothstep(edge,min(1.,edge+.018),k);
  c+=s*(i==0?vec3(2.8,2.9,3.1):i==1?vec3(1.65,1.75,1.9):vec3(2.1,1.85,1.65))*(uEnv==2?6.:1.);
 }
 return c;
}
// A spatial emissive calibration target, not an angular-only map: an
// orthographic ray through a smooth parallel slab must preserve the stripes.
vec3 environmentAt(vec3 origin,vec3 direction){
 if(uEnv!=1)return environment(direction);
 if(direction.z<-.000001){float t=(uStageZ-origin.z)/direction.z;
  if(t>0.){vec3 p=rotateZ(origin+t*direction,-uRotation);float stripe=step(0.,sin(p.x*uPatternScale));return vec3(mix(.035,1.7,stripe));}}
 return vec3(.3);
}
vec3 sampleEnvironment(){
 float pick=rnd(),z,phi=2.*PI*rnd();vec3 d;
 if(uEnv==1||uEnv==3||pick<.25){z=1.-2.*rnd();d=vec3(sqrt(max(0.,1.-z*z))*cos(phi),sqrt(max(0.,1.-z*z))*sin(phi),z);}
 else {int k=min(2,int((pick-.25)*4.));z=mix(capCos(k),1.,rnd());d=basis(capAxis(k))*vec3(sqrt(max(0.,1.-z*z))*cos(phi),sqrt(max(0.,1.-z*z))*sin(phi),z);}
 return rotateZ(d,uRotation);
}
float iorAt(float nm){float b=uDispersion/(1./(.4308*.4308)-1./(.6867*.6867));return uIor+b*(1./pow(nm*.001,2.)-1./(.5893*.5893));}
vec3 trace(vec3 ro,vec3 rd,float ior,bool polished){
 vec3 throughput=vec3(1),result=vec3(0);bool inside=false;float lastPdf=0.;bool lastDelta=true;
 for(int bounce=0;bounce<96;bounce++){
  float t;vec3 n;int slot;
  if(!hit(ro,rd,t,n,slot)){
   if(bounce==0)return vec3(.94,.95,.955);
   float w=lastDelta||uNEE==0?1.:powerHeuristic(lastPdf,envPdf(rd));return result+throughput*environmentAt(ro,rd)*w;
  }
  if(bounce>=uBudget)return result;
  if(inside)throughput*=exp(-uSigma*t*uScale);
  bool enter=dot(rd,n)<0.;vec3 N=enter?n:-n,p=ro+rd*t;
  float eta=enter?ior:1./ior;vec4 material=get1(uMaterials,slot);
  float alpha=polished?0.:material.x,scatter=polished?0.:material.y;
  if(bounce==0&&uMode==1)return alpha>0.?vec3(.88,.32,.47):vec3(.45,.64,.70);
  if(bounce==0&&uMode==2)return n*.5+.5;
  mat3 B=basis(N);vec3 wo=transpose(B)*(-rd);
  if(wo.z<=0.)return result;
  if(alpha<.0001){
   float F=fresnel(wo.z,eta);vec3 tr=refract(rd,N,1./eta);
   if(uIntegrator==0){ // Exact branch splitting at smooth boundaries of a convex object.
    if(enter){result+=throughput*F*environmentAt(p,reflect(rd,N));throughput*=(1.-F)/(eta*eta);
     if(dot(tr,tr)<.1)return result;rd=normalize(tr);inside=true;
    }else{if(F<1.&&dot(tr,tr)>.1)result+=throughput*(1.-F)/(eta*eta)*environmentAt(p,normalize(tr));
     throughput*=F;rd=reflect(rd,N);inside=true;}
   }else{
    bool reflected=rnd()<F;
    if(reflected)rd=reflect(rd,N);else{if(dot(tr,tr)<.1)return result;rd=normalize(tr);throughput/=eta*eta;}
    inside=dot(rd,n)<0.;
   }
   lastDelta=true;lastPdf=0.;
  }else{
   if(uNEE==1){vec3 light=sampleEnvironment();if(dot(light,n)>0.){
     vec3 wi=transpose(B)*light;vec2 e=evalBSDF(wo,wi,alpha,eta,scatter);float lp=envPdf(light);
     if(lp>0.&&e.y>0.)result+=throughput*environmentAt(p,light)*(e.x*abs(wi.z)/lp)*powerHeuristic(lp,e.y);
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
  ro=p+(inside?-n:n)*EPS*5.;
  // The finite depth is disclosed. Roulette is reserved for reference integration.
  if(uIntegrator==1&&bounce>6){float etaComp=inside?ior*ior:1.;float pContinue=clamp(max(throughput.r,max(throughput.g,throughput.b))*etaComp,.08,.95);
   if(rnd()>pContinue)return result;throughput/=pContinue;}
  if(max(throughput.r,max(throughput.g,throughput.b))<1e-10)return result;
 }
 return result;
}
void main(){
 bool left=uCompare==1&&uv.x<.5;vec2 q=uv;
 if(uCompare==1)q.x=fract(q.x*2.);
 vec2 film=(q*2.-1.);float aspect=uAspect/(uCompare==1?2.:1.);
 ivec2 pix=ivec2(gl_FragCoord.xy);uint base=mixbits(uint((uCompare==1?pix.x%int(uResolution.x*.5):pix.x)*1973+pix.y*9277));
 seed=base;dimension=0;vec2 jitter=vec2(rnd(),rnd())-.5;
 vec2 jitterScale=2./uResolution*vec2(uCompare==1?2.:1.,1.);
 vec3 ro=uCenter+uCameraOffset+uEye*uDistance+uRight*(film.x+jitter.x*jitterScale.x)*aspect*uSpan+uUp*(film.y+jitter.y*jitterScale.y)*uSpan;
 vec3 color;
 if(uSpectral==1&&uDispersion>0.&&uMode==0){vec3 acc=vec3(0);
  for(int band=0;band<3;band++){seed=base;dimension=3;float nm=band==0?610.:band==1?550.:460.;vec3 c=trace(ro,-uEye,iorAt(nm),left);acc[band]=c[band];}color=acc;
 }else{dimension=3;color=trace(ro,-uEye,uIor,left);}
 if(any(isnan(color))||any(isinf(color)))color=vec3(1,0,1);
 float lum=dot(color,vec3(.2126,.7152,.0722));vec4 val=vec4(color,lum*lum);
 outColor=uSample==0?val:mix(texelFetch(uPrevious,pix,0),val,1./float(uSample+1));
 vec3 guideRo=uCenter+uCameraOffset+uEye*uDistance+uRight*film.x*aspect*uSpan+uUp*film.y*uSpan;
 float t;vec3 n;int slot;outGuide=hit(guideRo,-uEye,t,n,slot)?vec4(n,float(slot+1)):vec4(0);
}`;
export const displayShader=`#version 300 es
precision highp float;
in vec2 uv;out vec4 outColor;
uniform sampler2D uImage,uGuide,uMaterials;
uniform float uExposure,uSamples;
uniform int uDenoise,uCompare,uAnyFrost,uMode;
vec3 tonemap(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
vec3 srgb(vec3 v){return mix(12.92*v,1.055*pow(max(v,vec3(0)),vec3(1./2.4))-.055,step(vec3(.0031308),v));}
void main(){
 ivec2 size=textureSize(uImage,0),pixel=clamp(ivec2(uv*vec2(size)),ivec2(0),size-1);
 vec4 central=texelFetch(uImage,pixel,0),guide=texelFetch(uGuide,pixel,0);vec3 c=central.rgb;
 if(uDenoise==1&&uAnyFrost==1&&uMode==0&&guide.w>.5&&!(uCompare==1&&uv.x<.5)){
  float l=dot(c,vec3(.2126,.7152,.0722)),variance=max(0.,central.a-l*l),sigma=sqrt(variance/max(uSamples,1.))+.025;
  vec3 sum=vec3(0);float weights=0.;
  for(int y=-3;y<=3;y++)for(int x=-3;x<=3;x++){
   ivec2 p=clamp(pixel+ivec2(x,y),ivec2(0),size-1);vec4 g=texelFetch(uGuide,p,0);
   if(abs(g.w-guide.w)>.1||dot(g.xyz,guide.xyz)<.995)continue;
   vec3 v=texelFetch(uImage,p,0).rgb;float nl=dot(v,vec3(.2126,.7152,.0722));
   float weight=exp(-float(x*x+y*y)/7.)*exp(-abs(nl-l)/(sigma*4.));sum+=v*weight;weights+=weight;
  }c=sum/max(weights,1e-8);
 }
 if(uMode==0)c=srgb(tonemap(c*exp2(uExposure)));else c=srgb(c);
 outColor=vec4(c,1.);
}`;
