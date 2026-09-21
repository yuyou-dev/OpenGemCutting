// WGSL port of opticsWebglRenderer.js. Keep optical constants and branch semantics aligned.
struct Params {
 res:vec4f, position:vec4f, forward:vec4f, right:vec4f, up:vec4f,
 body:vec4f, optics:vec4f, view:vec4f, observer:vec4f, background:vec4f, framing:vec4f,
}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> nodes:array<vec4f>;
@group(0) @binding(2) var<storage,read> triangles:array<vec4f>;
@group(0) @binding(3) var<storage,read> planes:array<vec4f>;
struct Hit { t:f32, normal:vec3f, point:vec3f }
fn dielectricFresnel(cosineIncident:f32,n1:f32,n2:f32)->f32 {
 let cosI=clamp(abs(cosineIncident),0.0,1.0);
 let ratio=n1/n2;
 let sinTSquared=ratio*ratio*max(0.0,1.0-cosI*cosI);
 if(sinTSquared>=1.0){return 1.0;}
 let cosT=sqrt(max(0.0,1.0-sinTSquared));
 let parallel=((n2*cosI)-(n1*cosT))/max(1e-6,(n2*cosI)+(n1*cosT));
 let perpendicular=((n1*cosI)-(n2*cosT))/max(1e-6,(n1*cosI)+(n2*cosT));
 return 0.5*(parallel*parallel+perpendicular*perpendicular);
}
fn environmentRadiance(rawDirection:vec3f)->vec3f {
 let worldDirection=normalize(rawDirection);
 let angle=radians(p.view.z);let cosine=cos(angle);let sine=sin(angle);
 let direction=vec3f(cosine*worldDirection.x-sine*worldDirection.y,sine*worldDirection.x+cosine*worldDirection.y,worldDirection.z);
 let horizon=smoothstep(-0.6,0.85,direction.z);
 var base=mix(vec3f(0.12,0.14,0.16),vec3f(0.92,0.91,0.88),horizon);
 if(p.view.w==1.0){base=mix(vec3f(0.035,0.045,0.06),vec3f(0.82,0.76,0.66),horizon);}
 if(p.view.w==2.0){base=mix(vec3f(0.012,0.016,0.022),vec3f(0.42,0.50,0.60),horizon);}
 let leftPanel=pow(max(0.0,dot(direction,normalize(vec3f(-0.72,-0.36,0.58)))),42.0);
 let rightPanel=pow(max(0.0,dot(direction,normalize(vec3f(0.78,0.18,0.52)))),70.0);
 let crownPanel=pow(max(0.0,dot(direction,normalize(vec3f(0.08,0.18,0.98)))),110.0);
 let warmStrip=pow(max(0.0,dot(direction,normalize(vec3f(-0.15,0.96,0.22)))),95.0);
 let darkCard=pow(max(0.0,dot(direction,normalize(vec3f(0.18,-0.92,0.34)))),4.0);
 let darkCardTwo=pow(max(0.0,dot(direction,normalize(vec3f(-0.64,0.68,0.35)))),5.0);
 let panels=leftPanel*vec3f(5.6,6.0,6.6)+rightPanel*vec3f(7.2,6.4,5.8)+crownPanel*vec3f(4.0,4.4,5.2)+warmStrip*vec3f(3.3,1.9,0.8);
 let darkStrength=select(0.88,1.2,p.view.w==2.0);
 var observerCard=smoothstep(0.91,0.985,dot(worldDirection,normalize(p.observer.xyz)));
 var radiance=max(vec3f(0.006),base+panels-vec3f((darkCard+darkCardTwo)*darkStrength));
 if(p.view.w==3.0){
  let azimuth=atan2(worldDirection.y,worldDirection.x);let eightFold=0.5+0.5*cos(8.0*azimuth);let polar=dot(worldDirection,normalize(p.observer.xyz));
  let scopeRing=smoothstep(0.22,0.72,polar)*(1.0-smoothstep(0.88,0.97,polar));
  let scopeSegments=mix(0.12,1.0,smoothstep(0.35,0.78,eightFold));
  let scopeWhite=vec3f(1.55,1.48,1.38)*mix(0.34,1.0,scopeSegments*scopeRing);
  let scopeRed=vec3f(1.2,0.055,0.11)*(1.0-scopeSegments)*scopeRing;
  radiance=vec3f(0.035)+scopeWhite+scopeRed;observerCard=smoothstep(0.84,0.975,polar);
 }
 return max(vec3f(0.004),radiance*mix(1.0,select(0.16,0.035,p.view.w==3.0),observerCard));
}
fn meshBounds(origin:vec3f,direction:vec3f,minimum:vec3f,maximum:vec3f,limit:f32)->bool {
 var nearT=0.0;var farT=limit;
 for(var axis=0;axis<3;axis++){
  if(abs(direction[axis])<1e-12){if(origin[axis]<minimum[axis]||origin[axis]>maximum[axis]){return false;}}
  else{let a=(minimum[axis]-origin[axis])/direction[axis];let b=(maximum[axis]-origin[axis])/direction[axis];nearT=max(nearT,min(a,b));farT=min(farT,max(a,b));if(nearT>farT){return false;}}
 }
 return true;
}
fn intersectMesh(origin:vec3f,direction:vec3f)->Hit {
 var hit=Hit(1e20,vec3f(0),vec3f(0));var node=0;
 while(node<i32(p.res.z)){
  let minimum=nodes[node*3];let maximum=nodes[node*3+1];
  if(!meshBounds(origin,direction,minimum.xyz,maximum.xyz,hit.t)){node=i32(minimum.w);continue;}
  let start=i32(maximum.w);let count=i32(nodes[node*3+2].x);
  for(var index=start;index<start+count;index++){
   let a=triangles[index*4].xyz;let ab=triangles[index*4+1].xyz;let ac=triangles[index*4+2].xyz;
   let crossP=cross(direction,ac);let determinant=dot(ab,crossP);if(abs(determinant)<1e-12){continue;}
   let relative=origin-a;let u=dot(relative,crossP)/determinant;if(u < -1e-6 || u>1.000001){continue;}
   let q=cross(relative,ab);let v=dot(direction,q)/determinant;if(v < -1e-6 || u+v>1.000001){continue;}
   let distance=dot(ac,q)/determinant;
   if(distance>1e-7&&distance<hit.t){hit.t=distance;hit.point=a+(u*ab+v*ac);hit.normal=triangles[index*4+3].xyz;}
  }
  node++;
 }
 return hit;
}
fn traceMeshGem(origin:vec3f,direction:vec3f,ior:f32,absorptionColor:vec3f)->vec3f {
 if(intersectMesh(origin,direction).t>=1e19){return vec3f(-1);}
 var origins:array<vec3f,9>;var directions:array<vec3f,9>;var weights:array<vec3f,9>;var depths:array<i32,9>;var interiors:array<bool,9>;
 origins[0]=origin;directions[0]=direction;weights[0]=vec3f(1);depths[0]=0;interiors[0]=false;
 var pending=1;var radiance=vec3f(0);let epsilon=0.000002;
 for(var path=0;path<511;path++){
  if(pending==0){break;}pending--;
  let rayOrigin=origins[pending];let rayDirection=directions[pending];var weight=weights[pending];let depth=depths[pending];let inside=interiors[pending];
  let hit=intersectMesh(rayOrigin,rayDirection);
  if(hit.t>=1e19){radiance+=weight*environmentRadiance(rayDirection);continue;}
  if(depth>=i32(p.observer.w)){continue;}
  if(inside){weight*=exp(-absorptionColor*hit.t);}
  let entering=dot(rayDirection,hit.normal)<0.0;let incidentNormal=select(-hit.normal,hit.normal,entering);
  let n1=select(ior,1.0,entering);let n2=select(1.0,ior,entering);
  let fresnel=dielectricFresnel(dot(-rayDirection,incidentNormal),n1,n2);let reflectionWeight=weight*fresnel;
  if(max(reflectionWeight.r,max(reflectionWeight.g,reflectionWeight.b))>=0.002){
   origins[pending]=hit.point+incidentNormal*epsilon;directions[pending]=reflect(rayDirection,incidentNormal);weights[pending]=reflectionWeight;depths[pending]=depth+1;interiors[pending]=!entering;pending++;
  }
  let transmission=refract(rayDirection,incidentNormal,n1/n2);let transmissionWeight=weight*(1.0-fresnel);
  if(dot(transmission,transmission)>1e-7&&max(transmissionWeight.r,max(transmissionWeight.g,transmissionWeight.b))>=0.002){
   origins[pending]=hit.point-incidentNormal*epsilon;directions[pending]=transmission;weights[pending]=transmissionWeight;depths[pending]=depth+1;interiors[pending]=entering;pending++;
  }
 }
 return radiance;
}
// Convex mode retains the original half-space solver and internal-reflection loop.
struct ConvexHit { nearT:f32, farT:f32, normal:vec3f, valid:bool }
fn intersectConvex(origin:vec3f,direction:vec3f)->ConvexHit {
 var hit=ConvexHit(-1e5,1e5,vec3f(0,0,1),false);
 for(var i=0;i<i32(p.framing.w);i++){
  let plane=planes[i];let denominator=dot(plane.xyz,direction);
  let signedDistance=plane.w-dot(plane.xyz,origin);
  if(abs(denominator)<1e-6){if(signedDistance<0.0){return hit;}continue;}
  let distance=signedDistance/denominator;
  if(denominator<0.0&&distance>hit.nearT){hit.nearT=distance;hit.normal=plane.xyz;}
  else if(denominator>0.0){hit.farT=min(hit.farT,distance);}
  if(hit.nearT>hit.farT){return hit;}
 }
 hit.valid=hit.farT>max(hit.nearT,0.0);return hit;
}
fn nextBoundary(origin:vec3f,direction:vec3f)->Hit {
 var hit=Hit(1e5,vec3f(0,0,1),vec3f(0));
 for(var i=0;i<i32(p.framing.w);i++){
  let plane=planes[i];let denominator=dot(plane.xyz,direction);
  if(denominator<=1e-6){continue;}
  let distance=(plane.w-dot(plane.xyz,origin))/denominator;
  if(distance>0.0012&&distance<hit.t){hit.t=distance;hit.normal=plane.xyz;}
 }
 return hit;
}
fn traceConvexGem(origin:vec3f,direction:vec3f,ior:f32,absorptionColor:vec3f)->vec3f {
 let entry=intersectConvex(origin,direction);
 if(!entry.valid||entry.nearT<0.0){return vec3f(-1);}
 let entryPoint=origin+direction*entry.nearT;
 let entryFresnel=dielectricFresnel(dot(-direction,entry.normal),1.0,ior);
 var radiance=environmentRadiance(reflect(direction,entry.normal))*entryFresnel;
 var insideDirection=refract(direction,entry.normal,1.0/ior);
 if(dot(insideDirection,insideDirection)<1e-7){return radiance;}
 var throughput=vec3f(1.0-entryFresnel);
 var insideOrigin=entryPoint+insideDirection*0.0012;
 for(var bounce=0;bounce<8;bounce++){
  if(bounce>=i32(p.observer.w)){break;}
  let hit=nextBoundary(insideOrigin,insideDirection);
  if(hit.t>=1e4){break;}
  let point=insideOrigin+insideDirection*hit.t;
  throughput*=exp(-absorptionColor*hit.t);
  let fresnel=dielectricFresnel(dot(insideDirection,hit.normal),ior,1.0);
  let exitDirection=refract(insideDirection,-hit.normal,ior);
  if(dot(exitDirection,exitDirection)>1e-7){radiance+=throughput*(1.0-fresnel)*environmentRadiance(exitDirection);}
  throughput*=fresnel;
  if(max(throughput.r,max(throughput.g,throughput.b))<0.002){break;}
  insideDirection=reflect(insideDirection,hit.normal);insideOrigin=point+insideDirection*0.0012;
 }
 return radiance;
}
fn traceGem(origin:vec3f,direction:vec3f,ior:f32,absorptionColor:vec3f)->vec3f {
 if(p.res.w==1.0){return traceMeshGem(origin,direction,ior,absorptionColor);}
 return traceConvexGem(origin,direction,ior,absorptionColor);
}

fn sceneBackground(rayOrigin:vec3f,rayDirection:vec3f,uv:vec2f)->vec3f {
 let vertical=smoothstep(0.0,1.0,uv.y);var color=p.background.xyz*mix(0.94,1.035,vertical);
 if(rayDirection.z < -0.0001){let floorT=(-1.08-rayOrigin.z)/rayDirection.z;if(floorT>0.0){let floorPoint=rayOrigin+rayDirection*floorT;let shadow=exp(-2.0*dot(floorPoint.xy,floorPoint.xy));color*=1.0-shadow*0.105;}}
 let centered=uv-vec2f(0.5);color*=1.0-0.055*dot(centered,centered);return color;
}
fn shadeAt(pixel:vec2f,baseUV:vec2f)->vec4f {
 var centered=(pixel/p.res.xy-vec2f(0.5))*2.0;centered.x*=p.res.x/max(p.res.y,1.0);
 centered.x+=p.framing.x;centered-=p.framing.yz;
 let rayOrigin=p.position.xyz;let rayDirection=normalize(p.forward.xyz+p.right.xyz*centered.x*p.view.x+p.up.xyz*centered.y*p.view.x);
 let redIor=max(1.001,p.optics.x-p.optics.y*0.48);let blueIor=p.optics.x+p.optics.y*0.52;
 let absorptionColor=vec3f(p.optics.z)-log(max(p.body.xyz,vec3f(0.02)))*0.9;
 let colorR=traceGem(rayOrigin,rayDirection,redIor,absorptionColor);
 if(colorR.r<0.0){return vec4f(sceneBackground(rayOrigin,rayDirection,baseUV),1);}
 let colorG=traceGem(rayOrigin,rayDirection,p.optics.x,absorptionColor);let colorB=traceGem(rayOrigin,rayDirection,blueIor,absorptionColor);
 var color=vec3f(colorR.r,colorG.g,colorB.b)*exp2(p.view.y);
 color=clamp((color*(2.51*color+vec3f(0.03)))/(color*(2.43*color+vec3f(0.59))+vec3f(0.14)),vec3f(0),vec3f(1));
 color=pow(max(color,vec3f(0)),vec3f(1.0/2.2));return vec4f(color,1);
}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(positions[i],0,1);
}
@fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {
 // WebGPU fragment Y is top-down; original GLSL is bottom-up.
 let pixel=vec2f(pos.x,p.res.y-pos.y);let uv=pixel/p.res.xy;
 return shadeAt(pixel,uv);
}
