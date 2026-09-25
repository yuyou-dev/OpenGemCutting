export const vertexShader=`#version 300 es
precision highp float;
out vec2 vUv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.0-1.0,0,1);}
`;
export const traceShader=`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec2 uJitter;
uniform vec3 uEye,uRight,uUp;
uniform vec2 uPan;
uniform float uSpan,uAspect;
uniform sampler2D uPlanes,uNodes,uTriangles,uLights,uPrevious;
uniform int uPlaneCount,uNodeCount,uLightCount,uMesh,uMaxBounces,uMode,uSpectral;
uniform float uIor,uDispersion,uMmPerUnit,uDiameter;
uniform vec3 uSigma,uBackground,uSpectralWhite;
uniform float uAmbient,uLower,uHeadAngle,uSample;
uniform bool uEdges,uAccumulate;
uniform int uObservation;
uniform float uAperture,uMinAngle,uBacklight;
const float PI=3.141592653589793;
const float EPS=0.00002;
uint randomState;
float randomValue(){randomState^=randomState<<13;randomState^=randomState>>17;randomState^=randomState<<5;return float(randomState)/4294967296.0;}
vec4 fetch1(sampler2D tex,int i){int w=textureSize(tex,0).x;return texelFetch(tex,ivec2(i%w,i/w),0);}
bool planeInterval(vec3 o,vec3 d,out float nearT,out float farT,out vec3 nearN,out vec3 farN){
 nearT=-1e20;farT=1e20;nearN=vec3(0,0,1);farN=vec3(0,0,-1);
 for(int i=0;i<uPlaneCount;i++){vec4 p=fetch1(uPlanes,i);float den=dot(p.xyz,d),dist=p.w-dot(p.xyz,o);if(abs(den)<1e-8){if(dist < -1e-6)return false;continue;}float t=dist/den;if(den<0.0){if(t>nearT){nearT=t;nearN=p.xyz;}}else if(t<farT){farT=t;farN=p.xyz;}if(nearT>farT)return false;}
 return farT>EPS;
}
bool boxHit(vec3 lo,vec3 hi,vec3 o,vec3 d,float maxT){float a=0.0,b=maxT;for(int k=0;k<3;k++){if(abs(d[k])<1e-10){if(o[k]<lo[k]||o[k]>hi[k])return false;}else{float t0=(lo[k]-o[k])/d[k],t1=(hi[k]-o[k])/d[k];a=max(a,min(t0,t1));b=min(b,max(t0,t1));if(b<a)return false;}}return true;}
bool meshHit(vec3 o,vec3 d,out float best,out vec3 normal){
 best=1e20;normal=vec3(0);int i=0;bool found=false;
 for(int visit=0;visit<uNodeCount;visit++){
  if(i>=uNodeCount)break;vec4 lo=fetch1(uNodes,i*3),hi=fetch1(uNodes,i*3+1),meta=fetch1(uNodes,i*3+2);
  if(!boxHit(lo.xyz,hi.xyz,o,d,best)){i=int(lo.w);continue;}
  int start=int(hi.w),count=int(meta.x);
  for(int j=0;j<count;j++){int at=(start+j)*4;vec3 a=fetch1(uTriangles,at).xyz,ab=fetch1(uTriangles,at+1).xyz,ac=fetch1(uTriangles,at+2).xyz,p=cross(d,ac);float det=dot(ab,p);if(abs(det)<1e-9)continue;float inv=1.0/det;vec3 s=o-a;float u=dot(s,p)*inv;if(u < -1e-6||u>1.000001)continue;vec3 q=cross(s,ab);float v=dot(d,q)*inv;if(v < -1e-6||u+v>1.000001)continue;float t=dot(ac,q)*inv;if(t>EPS&&t<best){best=t;normal=fetch1(uTriangles,at+3).xyz;found=true;}}
  i++;
 }
 return found;
}
bool solidHit(vec3 o,vec3 d,out float t,out vec3 n){
 float a,b;vec3 an,bn;if(!planeInterval(o,d,a,b,an,bn))return false;
 if(uMesh==0){if(a>EPS){t=a;n=an;}else{t=b;n=bn;}return true;}
 float after=max(0.0,a)+(a>EPS?EPS*2.0:0.0),mt;vec3 mn;if(!meshHit(o+d*after,d,mt,mn))return false;
 bool insideStock=dot(mn,d)>0.0;if(a>EPS&&insideStock){t=a;n=an;return true;}
 t=mt+after;n=mn;if(insideStock&&b<t){t=b;n=bn;return true;}return t<b+EPS;
}
float fresnel(float c,float n1,float n2){c=clamp(abs(c),0.0,1.0);float eta=n1/n2,s=eta*eta*(1.0-c*c);if(s>=1.0)return 1.0;float ct=sqrt(max(0.0,1.0-s));float rs=(n1*c-n2*ct)/(n1*c+n2*ct),rp=(n2*c-n1*ct)/(n2*c+n1*ct);return (rs*rs+rp*rp)*.5;}
float iorAt(float nm){float b=uDispersion/(1.0/(.4308*.4308)-1.0/(.6867*.6867));return uIor+b*(1.0/pow(nm*.001,2.0)-1.0/(.5893*.5893));}
float sigmaAt(float w){if(w<=460.0)return uSigma.b;if(w<550.0)return mix(uSigma.b,uSigma.g,(w-460.0)/90.0);if(w<610.0)return mix(uSigma.g,uSigma.r,(w-550.0)/60.0);return uSigma.r;}
float planck(float nm,float k){float l=nm*.001;return pow(.55/l,5.0)*(exp(14387.76877/(.55*k))-1.0)/(exp(14387.76877/(l*k))-1.0);}
float filterAt(vec3 rgb,float w){if(w<=460.0)return rgb.b;if(w<550.0)return mix(rgb.b,rgb.g,(w-460.0)/90.0);if(w<610.0)return mix(rgb.g,rgb.r,(w-550.0)/60.0);return rgb.r;}
vec3 observation(vec3 d){
 float z=dot(d,uEye);
 if(uObservation==1){if(z>cos(uMinAngle))return vec3(0);if(z>cos(uAperture))return vec3(1);return vec3(1,.01,.025)*uBacklight;}
 if(z<0.0)return vec3(uBacklight);
 if(uObservation==2){if(z>cos(PI/12.0))return vec3(.02,.05,1);if(z>cos(PI/4.0))return vec3(1,.01,.025);return vec3(.015,.8,.04);}
 if(z>cos(uAperture))return uObservation==1?vec3(1):vec3(0);
 return vec3(1,.01,.025);
}
vec3 environment(vec3 d,float wavelength){
 float base=d.z>=0.0?uAmbient:uLower;vec3 color=vec3(base);if(uSpectral==2)color*=planck(wavelength,6500.0);float block=1.0;
 for(int i=0;i<uLightCount;i++){
  vec4 a=fetch1(uLights,i*6),u=fetch1(uLights,i*6+1),v=fetch1(uLights,i*6+2),c=fetch1(uLights,i*6+3),meta=fetch1(uLights,i*6+4);
  float z=dot(d,a.xyz);if(z<=0.0)continue;vec2 q=vec2(atan(dot(d,u.xyz),z)/u.w,atan(dot(d,v.xyz),z)/v.w);
  float metric=c.w<.5?max(abs(q.x),abs(q.y)):acos(clamp(z,-1.0,1.0))/u.w,s=max(.002,meta.x);float mask=1.0-smoothstep(1.0-s,1.0,metric);if(c.w>1.5)mask*=smoothstep(meta.z,meta.z+s,metric);
  if(a.w<0.0){block*=1.0-mask;continue;}
  if(uSpectral!=1){vec3 tint=fetch1(uLights,i*6+5).xyz;float power=planck(wavelength,meta.y)*filterAt(tint,wavelength);if(uSpectral==0)power/=planck(wavelength,6500.0);color+=vec3(a.w*mask*power);}
  else color+=c.rgb*(a.w*mask);
 }
 return color*block;
}
vec3 heat(float x){x=clamp(x,0.0,1.0);if(x<.5)return mix(vec3(.03,.17,.68),vec3(.08,.82,.64),x*2.0);return mix(vec3(.08,.82,.64),vec3(.96,.10,.25),(x-.5)*2.0);}
vec3 exitRadiance(vec3 d,vec3 lastN,float path,int bounce,float wavelength){
 if(uMode==0&&uObservation>0)return observation(d);
 bool blocked=uHeadAngle>0.0&&dot(d,uEye)>cos(uHeadAngle);
 if(uMode==2){if(blocked)return vec3(1.0,.35,.02);if(lastN.z<-.05)return vec3(.95,.02,.25);return vec3(.55,.72,.78);}
 if(uMode==3)return heat(path/(uDiameter*3.0));
 if(uMode==5)return heat(float(bounce)/float(uMaxBounces));
 if(uMode==6)return vec3(0.04);
 if(blocked)return vec3(0);
 if(uMode==1){if(d.z<0.0)return vec3(.96);float theta=acos(clamp(d.z,-1.0,1.0))*180.0/PI;if(theta<15.0)return vec3(.94,.035,.05);if(theta<30.0)return vec3(.03,.8,.85);if(theta<50.0)return vec3(.92,.72,.025);return vec3(.8,.025,.73);}
 return environment(d,wavelength);
}
vec3 residualColor(){return (uMode==6||uMode==2)?vec3(.50,.035,.95):vec3(0);}
bool nextConvex(vec3 o,vec3 d,out float t,out vec3 n){
 t=1e20;n=vec3(0,0,1);
 for(int i=0;i<uPlaneCount;i++){vec4 plane=fetch1(uPlanes,i);float den=dot(plane.xyz,d);if(den<=1e-8)continue;float hit=(plane.w-dot(plane.xyz,o))/den;if(hit>EPS&&hit<t){t=hit;n=plane.xyz;}}
 return t<1e19;
}
vec3 traceConvex(vec3 o,vec3 d,float ior,float sigma,float wavelength){
 float t;vec3 n;if(!solidHit(o,d,t,n))return uBackground;
 vec3 p=o+d*t;float f=fresnel(-dot(d,n),1.0,ior);vec3 result=f*exitRadiance(reflect(d,n),n,0.0,0,wavelength);float weight=1.0-f,path=0.0;
 d=refract(d,n,1.0/ior);o=p-n*EPS*2.0;
 for(int bounce=1;bounce<64;bounce++){
  if(bounce>=uMaxBounces)break;
  if(!nextConvex(o,d,t,n)){result+=weight*residualColor();weight=0.0;break;}
  float dist=t*uMmPerUnit;path+=dist;weight*=exp(-sigma*dist);p=o+d*t;f=fresnel(dot(d,n),ior,1.0);
  if(f<1.0){vec3 rd=refract(d,-n,ior);if(dot(rd,rd)>.1)result+=weight*(1.0-f)*exitRadiance(rd,n,path,bounce,wavelength);}
  weight*=f;if(weight<1e-7){result+=weight*residualColor();weight=0.0;break;}d=reflect(d,n);o=p-n*EPS*2.0;
 }
 return result+weight*residualColor();
}
vec3 traceMesh(vec3 o,vec3 d,float ior,float sigma,float wavelength){
 float weight=1.0,path=0.0;vec3 lastN=vec3(0,0,1);bool inside=false;
 for(int bounce=0;bounce<=64;bounce++){
  float t;vec3 n;if(!solidHit(o,d,t,n))return inside?weight*residualColor():weight*exitRadiance(d,lastN,path,bounce,wavelength);
  if(bounce>=uMaxBounces)return weight*residualColor();
  if(inside){path+=t*uMmPerUnit;weight*=exp(-sigma*t*uMmPerUnit);}
  bool entering=dot(d,n)<0.0;vec3 normal=entering?n:-n,p=o+d*t;float n1=entering?1.0:ior,n2=entering?ior:1.0,f=fresnel(-dot(d,normal),n1,n2);lastN=n;
  if(randomValue()<f){d=reflect(d,normal);o=p+normal*EPS*2.0;inside=!entering;}
  else{d=refract(d,normal,n1/n2);o=p-normal*EPS*2.0;inside=entering;}
 }
 return weight*residualColor();
}
vec3 traceRay(vec3 o,vec3 d,float ior,float sigma,float wavelength){return uMesh==0?traceConvex(o,d,ior,sigma,wavelength):traceMesh(o,d,ior,sigma,wavelength);}
float gaussian(float w,float c,float a,float b){float t=(w-c)*(w<c?a:b);return exp(-.5*t*t);}
vec3 cie(float w){return vec3(.362*gaussian(w,442.,.0624,.0374)+1.056*gaussian(w,599.8,.0264,.0323)-.065*gaussian(w,501.1,.049,.0382),.821*gaussian(w,568.8,.0213,.0247)+.286*gaussian(w,530.9,.0613,.0322),1.217*gaussian(w,437.,.0845,.0278)+.681*gaussian(w,459.,.0385,.0725));}
vec3 xyzRGB(vec3 c){return vec3(3.2406*c.x-1.5372*c.y-.4986*c.z,-.9689*c.x+1.8758*c.y+.0415*c.z,.0557*c.x-.204*c.y+1.057*c.z);}
void main(){
 ivec2 pix=ivec2(gl_FragCoord.xy);randomState=uint(pix.x*1973+pix.y*9277+int(uSample+1.0)*26699)|1u;
 vec2 q=(vUv+uJitter/uResolution)*2.0-1.0;
 vec3 o=uEye*5.0+uRight*((q.x*uAspect+uPan.x)*uSpan)+uUp*((q.y+uPan.y)*uSpan),d=-uEye,color;float t;vec3 n;bool hit=solidHit(o,d,t,n);
 if(!hit)color=uBackground;
 else if(uMode==4)color=n*.5+.5;
 else if(uMode!=0)color=traceRay(o,d,uIor,0.0,589.3);
 else if(uObservation>0)color=traceRay(o,d,uIor,0.0,589.3);
 else if(uSpectral==0)color=traceRay(o,d,uIor,sigmaAt(589.3),589.3);
 else if(uSpectral==1){vec3 a=traceRay(o,d,iorAt(610.0),uSigma.r,610.0),b=traceRay(o,d,iorAt(550.0),uSigma.g,550.0),c=traceRay(o,d,iorAt(460.0),uSigma.b,460.0);color=vec3(a.r,b.g,c.b);}
 else{vec3 xyz=vec3(0);for(int k=0;k<12;k++){float wavelength=405.0+float(k)*30.0;float l=traceRay(o,d,iorAt(wavelength),sigmaAt(wavelength),wavelength).r;xyz+=cie(wavelength)*l;}color=max(vec3(0),xyzRGB(xyz)/uSpectralWhite);}
 if(hit&&uEdges&&uMesh==0){vec3 p=o+d*t;float edge=1e3;for(int k=0;k<uPlaneCount;k++){vec4 plane=fetch1(uPlanes,k);if(dot(plane.xyz,n)<.9999)edge=min(edge,abs(plane.w-dot(plane.xyz,p)));}float line=1.0-smoothstep(0.0,uSpan*2.0/uResolution.y,edge);color=mix(color,vec3(.025),line*.6);}
 color=max(vec3(0),color);
 if(uAccumulate&&uSample>0.0){vec3 previous=texelFetch(uPrevious,pix,0).rgb;color=mix(previous,color,1.0/(uSample+1.0));}
 outColor=vec4(color,hit?1.0:0.0);
}
`;
export const displayShader=`#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform float uExposure;
uniform int uTone,uMode;
uniform vec3 uBackground;
in vec2 vUv;out vec4 outColor;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0);}
vec3 srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0)),vec3(1.0/2.4))-.055,step(vec3(.0031308),c));}
void main(){vec4 tex=texture(uImage,vUv);vec3 c=tex.rgb;
 if(uMode==0&&tex.a>.01){c*=exp2(uExposure);if(uTone==0)c=aces(c);else if(uTone==1)c=c/(vec3(1)+c);else c=clamp(c,0.0,1.0);}
 outColor=vec4(srgb(max(vec3(0),c)),1.0);
}
`;
