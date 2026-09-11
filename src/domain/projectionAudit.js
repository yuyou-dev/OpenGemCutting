import { projectTechnicalPreview } from './technicalPreview.js';
/** The graph is transcribed before construction. faceMap only resolves its semantic face names. */
export function auditProjection(solid, graph, faceMap, { view='top', scale, center=[0,0], rotation=0 }={}) {
 if(solid.kind==='mesh')throw new Error('This projection auditor supports convex cube CUT solids; use mesh visibility and topology checks for imported stock.');
 const incidence=solid.vertices.map(()=>new Set());
 const edges=new Set();
 solid.faces.forEach(f=>{for(const i of f.vertexIndices)incidence[i].add(f.facetId??f.id);f.vertexIndices.forEach((a,i)=>{const b=f.vertexIndices[(i+1)%f.vertexIndices.length];edges.add([a,b].sort((a,b)=>a-b).join(':'));});});
 const project=p=>{
  const [x,y]=view==='top'||view==='bottom'?[p.x,-p.y]:view==='side'?[p.y,-p.z]:[p.x,-p.z];
  return [center[0]+scale*(x*Math.cos(rotation)-y*Math.sin(rotation)),center[1]+scale*(x*Math.sin(rotation)+y*Math.cos(rotation))];
 };
 const nodes=Object.entries(graph.nodes).map(([id,node])=>{
  const semantic=graph.faces.filter(f=>f.nodes.includes(id)).map(f=>f.id);
  const faces=semantic.map(id=>faceMap[id]);
  const candidates=solid.vertices.flatMap((p,i)=>faces.every(f=>f&&incidence[i].has(f))?[i]:[]);
  const vertex=candidates.length===1?candidates[0]:null;
  const actual=vertex===null?null:project(solid.vertices[vertex]);
  return {id,reference:node.pixel,faces:semantic,vertex,actual,errorPixels:actual?Math.hypot(...actual.map((x,i)=>x-node.pixel[i])):null,status:actual?'matched':'missing-or-split'};
 });
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const connections=graph.edges.map(([from,to])=>{
  const a=byId.get(from),b=byId.get(to);
  const present=a.vertex!==null&&b.vertex!==null&&edges.has([a.vertex,b.vertex].sort((a,b)=>a-b).join(':'));
  return {from,to,present,maxEndpointDeviationPixels:present?Math.max(a.errorPixels,b.errorPixels):null};
 });
 const p=projectTechnicalPreview(solid,view,{width:1000,height:1000,padding:0});
 const mapped=new Set(nodes.filter(n=>n.vertex!==null).map(n=>n.vertex));
 const extraProjectedVertices=[...new Set(p.edges.flat())].filter(i=>!mapped.has(i)).map(i=>({vertex:i,point:project(solid.vertices[i]),faces:[...incidence[i]]}));
 return {view,alignment:{scale,center,rotation,anisotropic:false},nodes,connections,extraProjectedVertices,missingNodes:nodes.filter(n=>n.vertex===null).length,missingEdges:connections.filter(e=>!e.present).length,scope:'Independent graph only. Extra visible vertices are listed, including silhouette subdivisions; classify them without deleting evidence.'};
}

/** Least-squares similarity only: translation, one rotation and one positive scale. */
export function fitSimilarity(source, target) {
  if(source.length!==target.length || source.length<2)throw new Error('Need corresponding point pairs');
  const mean=points=>[0,1].map(k=>points.reduce((sum,p)=>sum+p[k],0)/points.length);
  const a=mean(source),b=mean(target);let dot=0,cross=0,energy=0;
  for(let i=0;i<source.length;i++){
    const x=source[i][0]-a[0],y=source[i][1]-a[1],u=target[i][0]-b[0],v=target[i][1]-b[1];
    dot+=x*u+y*v;cross+=x*v-y*u;energy+=x*x+y*y;
  }
  if(energy<1e-12 || Math.hypot(dot,cross)<1e-12)throw new Error('Degenerate registration');
  const rotation=Math.atan2(cross,dot),scale=Math.hypot(dot,cross)/energy,c=Math.cos(rotation),s=Math.sin(rotation);
  return {scale,rotation,center:[b[0]-scale*(c*a[0]-s*a[1]),b[1]-scale*(s*a[0]+c*a[1])]};
}
