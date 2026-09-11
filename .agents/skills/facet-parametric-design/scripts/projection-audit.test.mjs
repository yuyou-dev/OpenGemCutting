import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCenteredCube} from '../../../../src/domain/geometry.js';
import {auditProjection} from './projection-audit.mjs';
test('missing semantic faces cannot be rescued by a nearby projected coordinate',()=>{
 const solid=createCenteredCube();const graph={nodes:{a:{pixel:[0,0]},b:{pixel:[1,0]}},faces:[{id:'absent',nodes:['a','b']}],edges:[['a','b']]};
 const result=auditProjection(solid,graph,{absent:'not-a-real-face'},{scale:100});
 assert.equal(result.missingNodes,2);assert.equal(result.missingEdges,1);assert(result.extraProjectedVertices.length>0);
});

import {fitSimilarity} from './projection-audit.mjs';
test('registration recovers rotation and uniform scale but cannot erase unequal axis stretching',()=>{
 const source=[[-1,-1],[1,-1],[1,1],[-1,1]],target=source.map(([x,y])=>[12-3*y,8+3*x]);
 const fit=fitSimilarity(source,target);assert(Math.abs(fit.scale-3)<1e-12);assert(Math.abs(fit.rotation-Math.PI/2)<1e-12);assert.deepEqual(fit.center,[12,8]);
 const stretched=fitSimilarity(source,source.map(([x,y])=>[2*x,3*y]));assert.equal(stretched.scale,2.5);assert.equal(stretched.rotation,0);
});
