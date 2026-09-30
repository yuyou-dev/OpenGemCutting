import assert from "node:assert/strict";
import test from "node:test";
import { createCenteredCube } from "./geometry.js";
import { getMeshBoundaryEdges, getMeshViewGeometry } from "./meshDisplay.js";
import { projectTechnicalPreview } from "./technicalPreview.js";

function box(minimum,maximum,name) {
  const cube=createCenteredCube(2);
  return {...cube,kind:"mesh",vertices:cube.vertices.map(p=>Object.fromEntries(["x","y","z"].map((axis,i)=>[axis,minimum[i]+(p[axis]+1)/2*(maximum[i]-minimum[i])]))),faces:cube.faces.map((f,i)=>({...f,id:`${name}:${i}`,sourceOperationId:name,facetId:`${name}:${i}`}))};
}
function combine(...solids) {
  const result={kind:"mesh",vertices:[],faces:[]};
  for(const solid of solids) {
    const offset=result.vertices.length;
    result.vertices.push(...solid.vertices);
    result.faces.push(...solid.faces.map(f=>({...f,vertexIndices:f.vertexIndices.map(i=>i+offset)})));
  }
  return result;
}
const area = vertices => Math.abs(vertices.reduce((sum,p,i)=>{ const q=vertices[(i+1)%vertices.length];return sum+p.x*q.y-p.y*q.x; },0))/2;

test("mesh boundary edges suppress coplanar rough diagonals while retaining physical creases and CUT identities",()=> {
  const solid=box([-1,-1,-1],[1,1,1],"rough-mesh");
  solid.faces=solid.faces.flatMap(face=>[1,2].map(i=>({...face,facetId:undefined,id:`${face.id}:${i}`,vertexIndices:[face.vertexIndices[0],face.vertexIndices[i],face.vertexIndices[i+1]]})));
  assert.equal(getMeshBoundaryEdges(solid).length,12);
  const distinct={...solid,faces:solid.faces.map(face=>({...face,facetId:face.id}))};
  assert.equal(getMeshBoundaryEdges(distinct).length,18);
});

test("a narrow foreground component splits hidden line intervals and hides rear facet fill exactly",()=> {
  const solid=combine(box([-1,-1,-2],[1,1,-1],"rear"),box([-0.25,-2,1],[0.25,2,2],"front"));
  const visible=getMeshViewGeometry(solid,{x:0,y:0,z:1});
  const rearTopEdges=visible.segments.filter(([a,b])=>a.z===-1&&b.z===-1&&Math.abs(a.y)===1&&a.y===b.y);
  assert.equal(rearTopEdges.length,4);
  for(const [a,b] of rearTopEdges) assert.ok(Math.max(a.x,b.x)<=-0.25+1e-7||Math.min(a.x,b.x)>=0.25-1e-7);
  const rearArea=visible.faces.filter(f=>f.sourceOperationId==="rear").reduce((sum,f)=>sum+area(f.vertices),0);
  assert.ok(Math.abs(rearArea-3)<1e-7,`rear visible area ${rearArea}`);
  const projection=projectTechnicalPreview(solid,"top");
  assert.equal(projection.faces.length,visible.faces.length);
  assert.equal(getMeshViewGeometry(solid,{x:0,y:0,z:1}),visible,"immutable scene projection is reused");
});

test("occlusion never fills an L-shaped crystal's missing quadrant",()=> {
  const solid=combine(box([-1,-1,-1],[0,1,1],"left"),box([0,-1,-1],[1,0,1],"right"));
  const visible=getMeshViewGeometry(solid,{x:0,y:0,z:1});
  assert.ok(Math.abs(visible.faces.reduce((sum,f)=>sum+area(f.vertices),0)-3)<1e-7);
  for(const face of visible.faces) assert.ok(face.vertices.every(p=>p.x<=1e-8||p.y<=1e-8));
});

test("fan slivers over collinear T-junction points never hide their own face's boundary edges",()=> {
  // Mesh intersections leave ridge points collinear to ~1e-12; the fan's collinear triples then have a cross product made
  // of rounding and a tilted geometric normal, which used to put the ridge "behind" its own face (heart stock, 2026-09).
  const rotate=([x,y,z],azimuth,tilt)=>{ const c=Math.cos(azimuth),s=Math.sin(azimuth),x1=c*x-s*y,y1=s*x+c*y;return [x1,Math.cos(tilt)*y1-Math.sin(tilt)*z,Math.sin(tilt)*y1+Math.cos(tilt)*z]; };
  let seed=7; const noise=()=>((seed=(seed*16807)%2147483647)/2147483647-0.5)*3e-12;
  for(let trial=0;trial<12;trial++) {
    const R=p=>rotate(p,0.1+trial*0.157,0.05+(trial%7)*0.04);
    const xs=[-1,-0.62,-0.31,0.07,0.43,0.81,1];
    const ridge=xs.map((x,i)=>{ const e=i===0||i===xs.length-1 ? 0 : noise();return R([x,e,1-0.5*Math.abs(e)]); });
    const vertices=[...ridge,R([1,1,0.5]),R([-1,1,0.5]),R([1,-1,0.5]),R([-1,-1,0.5])].map(([x,y,z])=>({x,y,z}));
    const normal=p=>{ const [x,y,z]=R(p),length=Math.hypot(x,y,z);return {x:x/length,y:y/length,z:z/length}; };
    const n=xs.length,r=[...Array(n).keys()];
    const solid={kind:"mesh",vertices,faces:[
      {id:"A",facetId:"A",sourceOperationId:"A",normal:normal([0,0.5,1]),vertexIndices:[...r,n,n+1]},
      {id:"B",facetId:"B",sourceOperationId:"B",normal:normal([0,-0.5,1]),vertexIndices:[n+3,n+2,...[...r].reverse()]}]};
    const [p,q]=[ridge[0],ridge[n-1]],d=[q[0]-p[0],q[1]-p[1]],length=Math.hypot(...d);
    const onRidge=v=>Math.abs((v.x-p[0])*d[1]-(v.y-p[1])*d[0])/length<1e-6;
    const drawn=getMeshViewGeometry(solid,{x:0,y:0,z:1}).segments.filter(([a,b])=>onRidge(a)&&onRidge(b)).reduce((sum,[a,b])=>sum+Math.hypot(b.x-a.x,b.y-a.y),0);
    assert.ok(Math.abs(drawn/length-1)<1e-6,`trial ${trial}: ridge drawn ${(drawn/length*100).toFixed(1)} %`);
  }
});
