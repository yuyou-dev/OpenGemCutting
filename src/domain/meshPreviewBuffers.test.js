import test from "node:test";
import assert from "node:assert/strict";
import { createCenteredCube } from "./geometry.js";
import { getMeshPreviewBuffers, fillMeshPreviewColors } from "./meshPreviewBuffers.js";
import { getTechnicalViewBasis } from "./technicalPreview.js";

function triangulatedCube() {
  const cube=createCenteredCube(2);
  return {...cube,kind:"mesh",faces:cube.faces.flatMap((face,index)=>[1,2].map(i=>({...face,id:`${index}:${i}`,facetId:`facet-${index}`,sourceOperationId:`cut-${index}`,vertexIndices:[face.vertexIndices[0],face.vertexIndices[i],face.vertexIndices[i+1]]})))};
}
test("GPU preview keeps every triangle and real boundary, and shares preparation across views",()=> {
  const solid=triangulatedCube();
  const buffers=getMeshPreviewBuffers(solid);
  assert.equal(buffers.positions.length,12*3*3);
  assert.equal(buffers.edgeCount,12,"coplanar patch diagonals never become lines");
  assert.equal(buffers.lines.length,12*6*8);
  assert.equal(getMeshPreviewBuffers(solid),buffers);
  assert.equal(buffers.faceRanges.reduce((count,range)=>count+range.count,0),36);
});
test("every patch of one CUT receives the same selection color with existing priority",()=> {
  const buffers=getMeshPreviewBuffers(triangulatedCube());
  const colors=fillMeshPreviewColors(buffers,{activeOperationId:"cut-0",previewOperationId:"cut-0",highlightOperationId:"cut-1"});
  for(const range of buffers.faceRanges) {
    const expected=range.operationId==="cut-0" ? [248,181,206] : range.operationId==="cut-1" ? [238,141,172] : [243,244,242];
    for(let index=range.start;index<range.start+range.count;index++) assert.deepEqual([...colors.slice(index*3,index*3+3)].map(value=>Math.round(value*255)),expected);
  }
});
test("GPU preview basis retains top/bottom and front/side handedness",()=> {
  assert.deepEqual(getTechnicalViewBasis("bottom"),{horizontal:{x:1,y:0,z:0},vertical:{x:0,y:1,z:0},view:{x:0,y:0,z:-1}});
  assert.deepEqual(getTechnicalViewBasis("side"),{horizontal:{x:0,y:1,z:0},vertical:{x:0,y:0,z:1},view:{x:1,y:0,z:0}});
});

test("frosted mesh patches share a cue without coloring other facets in their CUT layer",()=> {
  const solid=triangulatedCube();solid.faces.forEach(face=>{face.sourceOperationId='one-layer';});
  const buffers=getMeshPreviewBuffers(solid), frostedFaceIds=new Set(['facet-0']);
  const plain=fillMeshPreviewColors(buffers), marked=fillMeshPreviewColors(buffers,{frostedFaceIds});
  for(const range of buffers.faceRanges) {
    const a=[...plain.slice(range.start*3,(range.start+range.count)*3)];
    const b=[...marked.slice(range.start*3,(range.start+range.count)*3)];
    if(range.facetId==='facet-0')assert.notDeepEqual(a,b);else assert.deepEqual(a,b);
  }
  assert.deepEqual(fillMeshPreviewColors(buffers,{activeOperationId:'one-layer',frostedFaceIds}),fillMeshPreviewColors(buffers,{activeOperationId:'one-layer'}));
  assert.deepEqual(fillMeshPreviewColors(buffers,{frostedFaceIds:new Set()}),plain,'removing surface labels restores the ordinary appearance');
});
