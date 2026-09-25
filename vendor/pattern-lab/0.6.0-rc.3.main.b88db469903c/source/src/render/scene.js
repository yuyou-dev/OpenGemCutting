// Accepted external source: Facet-Pattern-Lab-Analytic/src/optics.js
// SHA-256: b487416867f84ebacd51fc29d582c756617b2c6b0b29519f16934ebaad9928ba
// Shader transport and display equations are preserved from that delivery.

export function buildFacetBVH(mesh){
 const triangles=[];mesh.faces.forEach((face,slot)=>{for(let i=1;i<face.points.length-1;i++){
  const p=[face.points[0],face.points[i],face.points[i+1]],lo=[0,1,2].map(k=>Math.min(...p.map(q=>q[k]))),hi=[0,1,2].map(k=>Math.max(...p.map(q=>q[k])));
  triangles.push({p,slot,lo,hi,c:lo.map((x,k)=>(x+hi[k])/2)});
 }});
 const nodes=[],ordered=[];
 function build(list){const index=nodes.length;nodes.push(null);
  const lo=[0,1,2].map(k=>Math.min(...list.map(t=>t.lo[k]))-1e-7),hi=[0,1,2].map(k=>Math.max(...list.map(t=>t.hi[k]))+1e-7);
  if(list.length<=4){const start=ordered.length;ordered.push(...list);nodes[index]=[...lo,-start-1,...hi,list.length];}
  else{const spread=lo.map((x,k)=>hi[k]-x),axis=spread.indexOf(Math.max(...spread));list.sort((a,b)=>a.c[axis]-b.c[axis]);const mid=Math.floor(list.length/2),a=build(list.slice(0,mid)),b=build(list.slice(mid));nodes[index]=[...lo,a,...hi,b];}return index;
 }build(triangles);
 return {nodes:new Float32Array(nodes.flat()),triangles:new Float32Array(ordered.flatMap(t=>t.p.flatMap(p=>[...p,t.slot]))),nodeCount:nodes.length,triangleCount:triangles.length};
}

/** Keep one canonical geometry: rendering only packs the compiler's final faces.
 * Plane finishes are authoritative, including temporary all-polished comparisons.
 * Model coordinates stay unchanged; absorption converts traveled distance to mm.
 */
export function opticalMesh(compiled) {
 const planes = new Map(compiled.planes.map(plane => [plane.id, plane]));
 const faces = compiled.faces.map(face => {
  const plane = planes.get(face.id)??face;
  return { ...face, normal: plane.normal, offset: plane.offset, finish: plane.finish };
 });
 const points = faces.flatMap(face => face.points);
 const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
 const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
 return {
  faces, bbox: { min, max }, scale: compiled.audit.mmPerUnit,
  audit: { frosted: faces.filter(face => face.finish.state === 'frosted').length },
 };
}

/** Fit both A/B cameras in their half of the canvas, including square previews.
 * Retain the host span when it already matches the accepted 1.7:1 layout.
 */
export function opticalCameraSpan(mesh, camera, aspect, compare) {
 if (!compare) return camera.span;
 const halfSize = mesh.bbox.max.map((value, axis) => (value - mesh.bbox.min[axis]) / 2);
 const projectedWidth = halfSize.reduce((sum, size, axis) => sum + size * Math.abs(camera.right[axis]), 0);
 const projectedHeight = halfSize.reduce((sum, size, axis) => sum + size * Math.abs(camera.up[axis]), 0);
 return Math.max(camera.span, Math.max(...halfSize) * 1.22, projectedWidth * 1.02 / (aspect / 2), projectedHeight * 1.02);
}
