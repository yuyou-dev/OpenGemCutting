import test from 'node:test';
import assert from 'node:assert/strict';
import { projectedTriangles, visibleLineIntervals, strokeVisibleLine } from '../src/viewport/visible-lines.js';

const square = (z = 0, lo = -1, hi = 1) => ({ v: [[lo,-1,z],[hi,-1,z],[hi,1,z],[lo,1,z]] });
const project = p => p;
const occluders = projectedTriangles([square()], project);
const almost = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((span, i) => span.forEach((v,j) => assert.ok(Math.abs(v-expected[i][j]) < 1e-8, `${actual} != ${expected}`)));
};

test('solid hides the middle of a ghost edge while retaining both outside portions', () => {
    almost(visibleLineIntervals([-2,0,1],[2,0,1],occluders), [[0,.25],[.75,1]]);
});
test('near and coplanar ghost edges stay visible, rear edges are hidden', () => {
    for (const z of [-1,0]) almost(visibleLineIntervals([-.5,0,z],[.5,0,z],occluders), [[0,1]]);
    assert.deepEqual(visibleLineIntervals([-.5,0,1],[.5,0,1],occluders), []);
});
test('an edge crossing a face is clipped at its depth intersection, not by a 2D silhouette', () => {
    almost(visibleLineIntervals([-.5,0,-1],[.5,0,1],occluders,0), [[0,.5]]);
});
test('separate occluders preserve the visible gap instead of filling a concave silhouette', () => {
    const triangles = projectedTriangles([square(0,-3,-1),square(0,1,3)],project);
    almost(visibleLineIntervals([-4,0,1],[4,0,1],triangles), [[0,.125],[.375,.625],[.875,1]]);
});
test('winding, overlapping triangles and face order do not change visibility', () => {
    const front = square(), back = square(2); front.v.reverse();
    const triangles = projectedTriangles([back,front,front],project);
    almost(visibleLineIntervals([-2,0,1],[2,0,1],triangles), [[0,.25],[.75,1]]);
});
test('sloped faces use interpolated surface depth', () => {
    const ramp = {v:[[-1,-1,-1],[1,-1,1],[1,1,1],[-1,1,-1]]};
    almost(visibleLineIntervals([-.5,0,0],[.5,0,0],projectedTriangles([ramp],project),0), [[.5,1]]);
});
test('edge-on faces and lines outside the solid do not create false occlusion', () => {
    const edgeOn = projectedTriangles([{v:[[0,0,-1],[0,0,1],[0,1,1]]}],project);
    assert.equal(edgeOn.length,0);
    almost(visibleLineIntervals([-2,2,1],[2,2,1],occluders),[[0,1]]);
});
test('drawing preserves dash phase across hidden portions and resets it afterwards', () => {
    const spans=[]; let start;
    const ctx={beginPath(){},moveTo(...p){start=p},lineTo(...p){spans.push({start,end:p,phase:this.lineDashOffset})},stroke(){}};
    strokeVisibleLine(ctx,[-2,0,1],[2,0,1],occluders);
    assert.deepEqual(spans.map(s=>[s.start,s.end]),[[[-2,0],[-1,0]],[[1,0],[2,0]]]);
    assert.equal(spans[1].phase,-3); assert.equal(ctx.lineDashOffset,0);
});
