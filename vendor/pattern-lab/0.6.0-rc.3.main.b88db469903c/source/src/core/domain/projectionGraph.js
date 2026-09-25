import { dot, rad, signedArea } from './math.js';
import {machine} from './machine.js';
const T=1e-8;
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const norm2=a=>dot(a,a);
function row(n,entries,b=0,label=''){const a=new Float64Array(n);for(const [i,v]of entries)a[i]+=v;return {a,b,label};}
function inSegment(p,a,b){return Math.abs(orient(a,b,p))<T&&p[0]>=Math.min(a[0],b[0])-T&&p[0]<=Math.max(a[0],b[0])+T&&p[1]>=Math.min(a[1],b[1])-T&&p[1]<=Math.max(a[1],b[1])+T;}
function crossing(a,b,c,d){const o=[orient(a,b,c),orient(a,b,d),orient(c,d,a),orient(c,d,b)];return o[0]*o[1]<-T*T&&o[2]*o[3]<-T*T||inSegment(a,c,d)||inSegment(b,c,d)||inSegment(c,a,b)||inSegment(d,a,b);}
/** Reject drawings that do not describe one convex, non-overlapping crown disk. */
export function inspectProjectionGraph(graph){
 const v=graph.vertices;if(!Array.isArray(v)||v.length<3||v.length>256)throw new Error('GRAPH_VERTICES: 3..256');
 if(!Array.isArray(graph.faces)||!graph.faces.length||graph.faces.length>128)throw new Error('GRAPH_FACES: 1..128');
 const byId=new Map();for(const p of v){if(typeof p.id!=='string'||byId.has(p.id)||![p.x,p.y,p.targetZ??0].every(Number.isFinite))throw new Error('GRAPH_VERTEX');byId.set(p.id,p);}
 for(let i=0;i<v.length;i++)for(let j=0;j<i;j++)if(Math.hypot(v[i].x-v[j].x,v[i].y-v[j].y)<T)throw new Error('DUPLICATE_XY_NODE');
 const edges=new Map(),faceIds=new Set();let area=0;
 const faces=graph.faces.map(f=>{
  if(typeof f.id!=='string'||faceIds.has(f.id))throw new Error('DUPLICATE_FACE_ID');faceIds.add(f.id);
  if(!Array.isArray(f.vertices)||f.vertices.length<3||new Set(f.vertices).size!==f.vertices.length)throw new Error('FACE_VERTICES');
  let ids=[...f.vertices],poly=ids.map(id=>{const p=byId.get(id);if(!p)throw new Error('MISSING_NODE');return [p.x,p.y];});
  if(signedArea(poly)<0){ids.reverse();poly.reverse();}
  if(signedArea(poly)<T)throw new Error('ZERO_FACE_AREA');
  for(let i=0;i<poly.length;i++)if(orient(poly[i],poly[(i+1)%poly.length],poly[(i+2)%poly.length])<-T)throw new Error('NONCONVEX_PROJECTED_FACET');
  area+=signedArea(poly);
  for(let i=0;i<ids.length;i++){const a=ids[i],b=ids[(i+1)%ids.length],key=JSON.stringify([a,b].sort());if(!edges.has(key))edges.set(key,{a,b,faces:[]});const e=edges.get(key);if(e.faces.length&&e.a===a)throw new Error('OVERLAPPING_OR_INCONSISTENT_FACE_WINDING');e.faces.push(f.id);if(e.faces.length>2)throw new Error('NON_MANIFOLD_GRAPH');}
  return {...f,vertices:ids};
 });
 const es=[...edges.values()];for(let i=0;i<es.length;i++)for(let j=0;j<i;j++){
  const a=es[i],b=es[j];if([a.a,a.b].some(x=>x===b.a||x===b.b))continue;
  const ps=[a.a,a.b,b.a,b.b].map(id=>[byId.get(id).x,byId.get(id).y]);if(crossing(...ps))throw new Error('CROSSED_EDGES_OR_UNSPLIT_T_JUNCTION');
 }
 if(v.length-edges.size+faces.length!==1)throw new Error('GRAPH_NOT_A_DISK');
 const boundary=es.filter(e=>e.faces.length===1);if(!boundary.length)throw new Error('MISSING_BOUNDARY');
 const loop=[boundary[0].a],next=new Map(boundary.map(e=>[e.a,e.b]));
 if(next.size!==boundary.length)throw new Error('NON_MANIFOLD_BOUNDARY');
 for(let i=0;i<boundary.length;i++){const to=next.get(loop.at(-1));if(!to)throw new Error('OPEN_BOUNDARY');if(to===loop[0])break;loop.push(to);}
 if(loop.length!==boundary.length||next.get(loop.at(-1))!==loop[0])throw new Error('MULTIPLE_BOUNDARIES');
 const polygon=loop.map(id=>[byId.get(id).x,byId.get(id).y]);
 for(let i=0;i<polygon.length;i++)if(orient(polygon[i],polygon[(i+1)%polygon.length],polygon[(i+2)%polygon.length])<-T)throw new Error('NONCONVEX_DOMAIN');
 if(Math.abs(area-signedArea(polygon))>1e-6)throw new Error('COVERAGE_MISMATCH');
 return {faces,vertices:v,edges:es,boundary:polygon};
}
function equalityBasis(rows,n){
 const q=[],bs=[],labels=[];
 for(const r of rows){const a=Float64Array.from(r.a);let b=r.b;
  for(let pass=0;pass<2;pass++)for(let j=0;j<q.length;j++){const f=dot(a,q[j]);for(let k=0;k<n;k++)a[k]-=f*q[j][k];b-=f*bs[j];}
  const len=Math.sqrt(norm2(a));if(len<1e-10){if(Math.abs(b)>1e-7)throw Object.assign(new Error('INCONSISTENT_SHARED_NODE_CONSTRAINTS'),{constraint:r.label,residual:b});continue;}
  for(let k=0;k<n;k++)a[k]/=len;q.push(a);bs.push(b/len);labels.push(r.label);
 }return {q,bs,labels};
}
function clip2(poly,a,b){const out=[];for(let i=0;i<poly.length;i++){
 const p=poly[i],q=poly[(i+1)%poly.length],dp=dot(a,p)-b,dq=dot(a,q)-b,ip=dp<=1e-9,iq=dq<=1e-9;
 if(ip)out.push(p);if(ip!==iq){const t=dp/(dp-dq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
 }return out;}
function distanceToPolygon(p,poly){let best=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));}return best;}
/**
 * Shared-node inverse construction. Fixed XY and exact per-face index; unknown node heights,
 * face slopes and offsets. Targets initialize the equality projection; feasibility, not global optimality, is certified.
 * Equalities are solved by two-pass orthogonalization; halfspaces by dual coordinate descent
 * in their nullspace. Iteration limits return NOT_CONVERGED, never a fabricated feasible cut.
 * This is a bounded engineering solver, not an exact-arithmetic production QP engine.
 */
export function solveProjectionGraph(graph,{maxSweeps=500,tolerance=1e-7}={}){
 const {teeth}=machine(graph.machine?.teeth??96),g=inspectProjectionGraph(graph),V=g.vertices.length,F=g.faces.length,N=V+2*F;
 const vi=new Map(g.vertices.map((v,i)=>[v.id,i])),x=new Float64Array(N),rows=[],ineq=[];
 g.vertices.forEach((v,i)=>{x[i]=v.targetZ??.2;if(v.lockZ!==undefined){if(!Number.isFinite(v.lockZ))throw new Error('LOCK_Z');rows.push(row(N,[[i,1]],v.lockZ,`lock:${v.id}`));}});
 const dirs=g.faces.map((f,i)=>{
  if(!Number.isInteger(f.index)||f.index<0||f.index>=teeth)throw new Error('GRAPH_INDEX_OFF_GEAR');
  const phi=rad(f.index*360/teeth),u=[Math.cos(phi),Math.sin(phi)],si=V+2*i,ci=si+1;
  x[si]=f.flat?0:(f.targetSlope??.3);
  x[ci]=f.vertices.reduce((s,id)=>{const v=g.vertices[vi.get(id)];return s+(v.targetZ??.2)+x[si]*(u[0]*v.x+u[1]*v.y);},0)/f.vertices.length;
  for(const id of f.vertices){const j=vi.get(id),v=g.vertices[j],s=u[0]*v.x+u[1]*v.y;rows.push(row(N,[[j,1],[si,s],[ci,-1]],0,`${f.id}@${id}`));}
  if(f.flat)rows.push(row(N,[[si,1]],0,`${f.id}:flat`));
  else{ineq.push(row(N,[[si,-1]],-(graph.minSlope??.005),`${f.id}:minSlope`));ineq.push(row(N,[[si,1]],graph.maxSlope??2,`${f.id}:maxSlope`));}
  for(let j=0;j<V;j++){if(f.vertices.includes(g.vertices[j].id))continue;const v=g.vertices[j];ineq.push(row(N,[[j,1],[si,u[0]*v.x+u[1]*v.y],[ci,-1]],0,`${f.id}:protect:${v.id}`));}
  return u;
 });
 let basis;try{basis=equalityBasis(rows,N);}catch(e){return {ok:false,status:'INCONSISTENT_EQUALITIES',error:e.message,constraint:e.constraint,residual:e.residual};}
 const {q,bs}=basis;
 for(let j=0;j<q.length;j++){const c=dot(x,q[j])-bs[j];for(let k=0;k<N;k++)x[k]-=c*q[j][k];}
 const active=[],known=new Set();let maxViolation=Infinity,sweeps=0;
 for(;sweeps<maxSweeps;sweeps++){
  for(const item of active){const violation=dot(item.a,x)-item.b,newLambda=Math.max(0,item.lambda+violation/item.p2),delta=newLambda-item.lambda;item.lambda=newLambda;for(let k=0;k<N;k++)x[k]-=delta*item.p[k];}
  maxViolation=0;let worst=-1;
  for(let i=0;i<ineq.length;i++){const e=dot(ineq[i].a,x)-ineq[i].b;if(e>maxViolation){maxViolation=e;worst=i;}}
  if(maxViolation<tolerance)break;
  if(!known.has(worst)){
   const p=Float64Array.from(ineq[worst].a);for(const z of q){const c=dot(p,z);for(let k=0;k<N;k++)p[k]-=c*z[k];}
   const p2=norm2(p);if(p2<1e-18)return {ok:false,status:'INFEASIBLE_FIXED_GEOMETRY',constraint:ineq[worst].label,maxViolation,rank:q.length};
   known.add(worst);active.push({...ineq[worst],p,p2,lambda:0});
  }
 }
 const maxEqualityResidual=Math.max(0,...rows.map(r=>Math.abs(dot(r.a,x)-r.b)));
 const planes=g.faces.map((f,i)=>{const s=x[V+2*i],c=x[V+2*i+1],raw=[s*dirs[i][0],s*dirs[i][1],1],l=Math.hypot(...raw);return {id:f.id,normal:raw.map(v=>v/l),offset:c/l,slope:s,intercept:c,index:f.index,region:'crown',table:Boolean(f.flat)};});
 const cells=planes.map((p,i)=>{
  let poly=g.boundary.map(v=>[...v]);for(let j=0;j<F&&poly.length;j++){if(i===j)continue;const a=[planes[j].slope*dirs[j][0]-p.slope*dirs[i][0],planes[j].slope*dirs[j][1]-p.slope*dirs[i][1]];poly=clip2(poly,a,planes[j].intercept-p.intercept);}
  const desired=g.faces[i].vertices.map(id=>{const v=g.vertices[vi.get(id)];return [v.x,v.y];});
  const error=poly.length?Math.max(...poly.map(v=>distanceToPolygon(v,desired)),...desired.map(v=>distanceToPolygon(v,poly))):Infinity;
  return {id:p.id,polygon:poly,error,areaError:Math.abs(Math.abs(signedArea(poly))-Math.abs(signedArea(desired)))};
 });
 const topologyMatched=cells.every(c=>c.error<1e-5&&c.areaError<1e-6);
 const constraintsConverged=maxViolation<tolerance&&maxEqualityResidual<tolerance;
 return {ok:constraintsConverged&&topologyMatched,status:!constraintsConverged?'NOT_CONVERGED':!topologyMatched?'TOPOLOGY_COLLAPSED_OR_CHANGED':'SOLVED',
  vertices:g.vertices.map((v,i)=>({...v,z:x[i]})),planes,cells,rank:q.length,degreesOfFreedom:N-q.length,sweeps,
  maxEqualityResidual,maxViolation,topologyMatched,objective:'target-seeded feasible candidate; optimality not certified',
  boundary:g.boundary};
}
