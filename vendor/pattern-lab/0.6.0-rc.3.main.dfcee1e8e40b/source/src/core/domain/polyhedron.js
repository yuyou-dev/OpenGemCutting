import { add, sub, mul, cross, length, frame } from './math.js';
// This kernel only handles 3D vectors; avoid generic array iteration per halfspace.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
// Plane-side precision is separate from vertex welding: short real corners must survive.
const TOL=1e-12;
const VERTEX_TOL=1e-10;
function cleanPolygon(poly){
 const out=[];for(const p of poly)if(!out.length||length(sub(p,out.at(-1)))>VERTEX_TOL)out.push(p);
 if(out.length>1&&length(sub(out[0],out.at(-1)))<=VERTEX_TOL)out.pop();
 let changed=true;while(changed&&out.length>3){changed=false;for(let i=0;i<out.length;i++){
  const a=sub(out[i],out[(i-1+out.length)%out.length]),b=sub(out[(i+1)%out.length],out[i]);
  if(length(cross(a,b))<1e-10*length(a)*length(b)&&dot(a,b)>=0){out.splice(i,1);changed=true;break;}
 }}return out;
}
export function polygonArea(poly,n){if(poly.length<3)return 0;let v=[0,0,0];for(let i=1;i<poly.length-1;i++)v=add(v,cross(sub(poly[i],poly[0]),sub(poly[i+1],poly[0])));return Math.abs(dot(v,n))/2;}
export function cubeFaces(radius=1){
 const out=[];for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
  const n=[0,0,0];n[axis]=sign;const [u,v]=frame(n);const pts=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>add(n,add(mul(u,a),mul(v,b))));
  out.push({id:`stock-${axis}-${sign}`,normal:n,offset:radius,points:pts.map(p=>mul(p,radius)),stock:true});
 }return out;
}
/** Convex study kernel. The production adapter uses the editor kernel, including its mesh path. */
export function clipSolid(planes,initial=cubeFaces()){
 let faces=initial.map(f=>({...f,points:f.points.map(p=>[...p])}));
 for(const plane of planes){
  const n=plane.normal,d=plane.offset,cap=[],next=[];let removed=false;
  for(const face of faces){const poly=face.points,out=[];
   const distances=poly.map(p=>dot(n,p)-d);
   if(distances.every(x=>x<=TOL)){
    next.push(face);for(let i=0;i<poly.length;i++)if(Math.abs(distances[i])<=TOL)cap.push(poly[i]);continue;
   }
   for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=distances[i],db=distances[(i+1)%poly.length];
    const ina=da<=TOL,inb=db<=TOL;if(ina)out.push(a);else removed=true;
    if(ina!==inb){const t=da/(da-db),p=add(a,mul(sub(b,a),t));out.push(p);cap.push(p);}
    if(Math.abs(da)<=TOL)cap.push(a);
   }
   const points=cleanPolygon(out);if(points.length>=3&&polygonArea(points,face.normal)>1e-20)next.push({...face,points});
  }
  if(!next.length)return [];
  if(removed){
   const uniq=[];for(const p of cap)if(!uniq.some(q=>length(sub(p,q))<VERTEX_TOL))uniq.push(p);
   if(uniq.length>=3){const center=mul(uniq.reduce(add,[0,0,0]),1/uniq.length),[u,v]=frame(n);
    uniq.sort((a,b)=>Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
    const points=cleanPolygon(uniq);if(polygonArea(points,n)>1e-20)next.push({...plane,points});
   }
  }faces=next;
 }return faces;
}
export function topology(faces){
 const vertices=[],edges=new Map(),cells=new Map(),faceVertices=new Map(),exact=new Map();
 // Distance welding avoids splitting a shared vertex at an arbitrary rounding-bin boundary.
 const idFor=p=>{
  const coordinate=p.join(',');
  if(exact.has(coordinate))return exact.get(coordinate);
  const cell=p.map(x=>Math.floor(x/VERTEX_TOL));let match=Infinity;
  for(let x=-1;x<=1;x++){
   const column=cells.get(cell[0]+x);if(!column)continue;
   for(let y=-1;y<=1;y++){
    const row=column.get(cell[1]+y);if(!row)continue;
    for(let z=-1;z<=1;z++){
     const ids=row.get(cell[2]+z);
     if(ids)for(const id of ids){const q=vertices[id];if(Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])<VERTEX_TOL)match=Math.min(match,id);}
    }
   }
  }
  if(match!==Infinity){exact.set(coordinate,match);return match;}
  const id=vertices.length;vertices.push(p);
  exact.set(coordinate,id);
  if(!cells.has(cell[0]))cells.set(cell[0],new Map());const column=cells.get(cell[0]);
  if(!column.has(cell[1]))column.set(cell[1],new Map());const row=column.get(cell[1]);
  if(!row.has(cell[2]))row.set(cell[2],[]);row.get(cell[2]).push(id);return id;
 };
 for(const face of faces){const raw=face.points.map(idFor),ids=raw.filter((id,i)=>id!==raw[(i+1)%raw.length]);faceVertices.set(face.id,ids);for(let i=0;i<ids.length;i++){
  const a=ids[i],b=ids[(i+1)%ids.length],key=a<b?`${a}/${b}`:`${b}/${a}`;
  if(!edges.has(key))edges.set(key,{key,a,b,faces:[],length:length(sub(vertices[a],vertices[b]))});edges.get(key).faces.push(face.id);
 }}
 return {vertices,faceVertices,edges:[...edges.values()],euler:vertices.length-edges.size+faces.length};
}
export function maxXYWidth(faces){const p=faces.flatMap(f=>f.points);return Math.max(...[0,1].map(k=>Math.max(...p.map(v=>v[k]))-Math.min(...p.map(v=>v[k]))));}
export function auditSolid(faces,planes,sizeMm=10,mmPerUnit){
 const t=topology(faces),width=maxXYWidth(faces),mm=mmPerUnit===null?null:mmPerUnit??sizeMm/width;let volume=0,maxResidual=0;
 for(const f of faces)for(let i=1;i<f.points.length-1;i++)volume+=dot(f.points[0],cross(f.points[i],f.points[i+1]))/6;
 for(const p of t.vertices)for(const plane of planes)maxResidual=Math.max(maxResidual,dot(plane.normal,p)-plane.offset);
 const minEdge=t.edges.length?Math.min(...t.edges.map(e=>e.length))*mm:0;
 return {valid:faces.length>3&&t.euler===2&&t.edges.every(e=>e.faces.length===2)&&volume>1e-10&&maxResidual<1e-7,
  vertices:t.vertices.length,edges:t.edges.length,faces:faces.length,euler:t.euler,widthUnits:width,mmPerUnit:mm,volume:Math.abs(volume),
  volumeMm3:mm===null?null:Math.abs(volume)*mm**3,minEdgeMm:mm===null?null:minEdge,maxHalfspaceResidual:maxResidual,
  nonManifoldEdges:t.edges.filter(e=>e.faces.length!==2).length,stockFaces:faces.filter(f=>f.stock).length};
}
