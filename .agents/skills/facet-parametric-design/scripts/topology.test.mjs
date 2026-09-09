import test from 'node:test';
import assert from 'node:assert/strict';
import { createCenteredCube, clipPolyhedronByPlanes } from '../../../../src/domain/geometry.js';
import { inspectTopology } from './topology.mjs';
const cube = createCenteredCube(2);
const at = p => cube.faces.filter(f => f.vertexIndices.some(i => ['x','y','z'].every(k => cube.vertices[i][k] === p[k]))).map(f=>f.id);
const plan = { nodes: [
  { id:'A', reference:'上前右角', facets:at({x:1,y:1,z:1}) },
  { id:'B', reference:'下前右角', facets:at({x:1,y:1,z:-1}) },
], edges:[['A','B']] };
test('checks an intended junction and its connecting edge',()=>assert.equal(inspectTopology(cube,plan).status,'passed'));
test('a small bevel splits one intended junction into several and must fail',()=>{
  const cut=clipPolyhedronByPlanes(cube,[{normal:{x:1/Math.sqrt(3),y:1/Math.sqrt(3),z:1/Math.sqrt(3)},offset:2.9/Math.sqrt(3),faceId:'bevel'}]);
  const result=inspectTopology(cut,plan);
  assert.equal(result.status,'failed');assert.ok(result.issues.some(s=>s.includes('A: 应有唯一共点，实际 0')));
});
test('no reference plan cannot be reported as passed',()=>assert.equal(inspectTopology(cube,null).status,'unassessed'));
test('counting three unrelated faces does not establish a junction',()=>{
  const result=inspectTopology(cube,{nodes:[{id:'wrong',reference:'指定共点',facets:[...plan.nodes[0].facets.slice(0,2),'missing-face']}],edges:[]});
  assert.equal(result.status,'failed');
});
