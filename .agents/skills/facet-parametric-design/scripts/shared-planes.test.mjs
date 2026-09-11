import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCenteredCube } from '../../../../src/domain/geometry.js';
import { planeThroughNodes, inspectPlane, patternFromPlane, findPrefixTarget,indexCandidates } from './shared-planes.mjs';
test('shared plane preserves three nodes and rejects an unreachable protected point',()=>{
 const plane=planeThroughNodes(0,[.5,0,.5],[1,0,0]);
 assert(inspectPlane(plane,[[.5,0,.5],[1,1,0]]).passed);
 assert(!inspectPlane(plane,[[.5,0,.5]],[[1,0,1]]).passed);
 assert.throws(()=>planeThroughNodes(0,[0,0,0],[1,0,0]),/Equal-height/);
 assert.throws(()=>planeThroughNodes(.5,[0,0,0],[1,0,1]),/integer/);
 assert.equal(patternFromPlane(plane,{id:'shared',region:'crown',baseIndex:0,repeat:4}).length,4);
 assert.throws(()=>patternFromPlane(plane,{id:'wrong',region:'crown',baseIndex:1}),/azimuth/);
});
test('prefix provenance is real; an interior point cannot acquire fake Meet identity',()=>{
 const cube=createCenteredCube();
 assert(findPrefixTarget(cube,[1,1,1]));
 assert.equal(findPrefixTarget(cube,[1,.25,1]).kind,'edge-point');
 assert.equal(findPrefixTarget(cube,[0,0,0]),null);
});
test('candidate search exposes approximation and keeps integers',()=>{
 const candidates=indexCandidates(7,1);assert.equal(candidates[0].index,2);assert.equal(candidates[0].errorDegrees,.5);assert.equal(indexCandidates(727,1)[0].errorDegrees,.5);
 assert(candidates.every(x=>Number.isInteger(x.index)&&x.index>=0&&x.index<96));
});
