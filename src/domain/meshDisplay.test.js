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
