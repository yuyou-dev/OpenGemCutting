import { getMeshBvh } from "./meshRaycast.js";

const xyz = p => Array.isArray(p) ? p : [p.x, p.y, p.z];
const point = p => ({ x: p[0], y: p[1], z: p[2] });
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a, b) => a.map((v, i) => v-b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => { const length = Math.hypot(...a); return a.map(v => v/length); };
const mix = (a,b,t) => a.map((v,i) => v+(b[i]-v)*t);
const edgeCache = new WeakMap();
const viewCache = new WeakMap();
const EPS = 1e-8;

/** Real material/facet edges only. Imported coplanar triangles are one surface;
 * different CUT identities keep their boundary even when planes coincide. */
export function getMeshBoundaryEdges(solid) {
  if (edgeCache.has(solid)) return edgeCache.get(solid);
  const adjacency = new Map();
  for (const face of solid.faces) for (let i=0;i<face.vertexIndices.length;i++) {
    const a=face.vertexIndices[i], b=face.vertexIndices[(i+1)%face.vertexIndices.length];
    const key=a<b ? `${a}:${b}` : `${b}:${a}`;
    if (!adjacency.has(key)) adjacency.set(key,{edge:[a,b],faces:[]});
    adjacency.get(key).faces.push(face);
  }
  const edges=[];
  for (const {edge,faces} of adjacency.values()) {
    const [a,b]=faces;
    const sameFacet = faces.length===2 && a.facetId===b.facetId && a.sourceOperationId===b.sourceOperationId;
    if (sameFacet && dot(unit(xyz(a.normal)),unit(xyz(b.normal))) > 1-1e-10) continue;
    edges.push(edge);
  }
  edgeCache.set(solid,edges);
  return edges;
}

function splitPolygon(polygon, plane) {
  const inside=[],outside=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    const da=dot(plane.normal,a)-plane.offset,db=dot(plane.normal,b)-plane.offset;
    (da<=0 ? inside : outside).push(a);
    if ((da<0&&db>0)||(da>0&&db<0)) {
      const intersection=mix(a,b,da/(da-db));
      inside.push(intersection); outside.push(intersection);
    }
  }
  return {inside,outside};
}

function subtractPrism(polygon, planes) {
  let overlap=polygon;
  for (const plane of planes) {
    overlap=splitPolygon(overlap,plane).inside;
    if (overlap.length<3) return [polygon];
  }
  const visible=[];
  let remaining=polygon;
  for(const plane of planes) {
    const {inside,outside}=splitPolygon(remaining,plane);
    if(outside.length>=3) visible.push(outside);
    remaining=inside;
    if(remaining.length<3) break;
  }
  return visible;
}

/** Exact orthographic hidden-line/face removal. BVH bounds reject unrelated
 * triangles; occluding prisms split line intervals and polygon fragments, so a
 * narrow foreground feature cannot disappear between visibility samples. */
export function getMeshViewGeometry(solid, viewDirection) {
  const view=unit(xyz(viewDirection));
  const key=view.join(',');
  let cached=viewCache.get(solid);
  if(cached?.has(key)) return cached.get(key);
  const horizontal=unit(cross(Math.abs(view[2])<0.9 ? [0,0,1] : [0,1,0],view));
  const vertical=cross(view,horizontal);
  const bvh=getMeshBvh(solid);
  const project=p=>[dot(p,horizontal),dot(p,vertical),dot(p,view)];
  const projectedBounds=(minimum,maximum)=> {
    const center=minimum.map((v,i)=>(v+maximum[i])/2),extent=minimum.map((v,i)=>(maximum[i]-v)/2);
    const mid=project(center),half=[horizontal,vertical,view].map(axis=>axis.reduce((sum,v,i)=>sum+Math.abs(v)*extent[i],0));
    return {min:mid.map((v,i)=>v-half[i]),max:mid.map((v,i)=>v+half[i])};
  };
  const nodeBounds=bvh.nodes.map(node=>projectedBounds(node.minimum,node.maximum));
  const triangles=bvh.triangles.map(triangle=> {
    const vertices=[triangle.a,triangle.a.map((v,i)=>v+triangle.ab[i]),triangle.a.map((v,i)=>v+triangle.ac[i])];
    if(dot(triangle.normal,view)<=EPS) return null;
    const planes=vertices.map((a,i)=> {
      const b=vertices[(i+1)%3],c=vertices[(i+2)%3];
      let normal=unit(cross(sub(b,a),view));
      if(dot(normal,sub(c,a))>0) normal=normal.map(v=>-v);
      return {normal,offset:dot(normal,a)};
    });
    planes.push({normal:triangle.normal,offset:dot(triangle.normal,triangle.a)-EPS});
    return {...triangle,vertices,planes};
  });
  const boundsOf=vertices=> {
    const ps=vertices.map(project);
    return {min:[0,1,2].map(i=>Math.min(...ps.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...ps.map(p=>p[i])))};
  };
  const candidates=(bounds,visit)=> {
    for(let i=0;i<bvh.nodes.length;) {
      const node=bvh.nodes[i],box=nodeBounds[i];
      if(box.max[2]<=bounds.min[2]+EPS || box.max[0]<bounds.min[0]-EPS || box.min[0]>bounds.max[0]+EPS || box.max[1]<bounds.min[1]-EPS || box.min[1]>bounds.max[1]+EPS) {i=node.escape;continue;}
      for(let j=node.start;j<node.start+node.count;j++) if(triangles[j]) visit(triangles[j]);
      i++;
    }
  };
  const segments=[];
  for(const [aIndex,bIndex] of getMeshBoundaryEdges(solid)) {
    const a=xyz(solid.vertices[aIndex]),b=xyz(solid.vertices[bIndex]);
    let intervals=[[0,1]];
    candidates(boundsOf([a,b]),triangle=> {
      let lo=0,hi=1;
      for(const plane of triangle.planes) {
        const da=dot(plane.normal,a)-plane.offset,db=dot(plane.normal,b)-plane.offset;
        if(da>0&&db>0) return;
        if(da>0) lo=Math.max(lo,da/(da-db));
        if(db>0) hi=Math.min(hi,da/(da-db));
      }
      if(hi<=lo) return;
      intervals=intervals.flatMap(([start,end])=>hi<=start||lo>=end ? [[start,end]] : [[start,Math.min(end,lo)],[Math.max(start,hi),end]].filter(([x,y])=>y-x>EPS));
    });
    for(const [start,end] of intervals) segments.push([point(mix(a,b,start)),point(mix(a,b,end))]);
  }
  const faces=[];
  for(const triangle of triangles) {
    if(!triangle) continue;
    let fragments=[triangle.vertices];
    candidates(boundsOf(triangle.vertices),occluder=> {
      if(occluder.face===triangle.face || !fragments.length) return;
      fragments=fragments.flatMap(fragment=>subtractPrism(fragment,occluder.planes));
    });
    for(const vertices of fragments) faces.push({...triangle.face,vertices:vertices.map(point)});
  }
  const result={segments,faces};
  if(!cached) { cached=new Map();viewCache.set(solid,cached); }
  cached.set(key,result);
  return result;
}
