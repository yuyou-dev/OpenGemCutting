import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasMetrics, resizeCanvas, cssCanvasContext, watchPixelDensity } from '../src/viewport/canvas-resolution.js';
for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    test(`overlay backing buffer honors ${dpr}x density without changing CSS coordinates`, () => {
        const m = canvasMetrics(731.5, 404.25, {dpr});
        assert.equal(m.pixelWidth, Math.floor(731.5*dpr));
        assert.equal(m.pixelHeight, Math.floor(404.25*dpr));
        assert.equal(m.width, 731.5); assert.equal(m.height, 404.25);
        assert.ok(Math.abs(m.scaleX*m.width - m.pixelWidth) < 1e-9);
    });
    test(`orthographic supersampling honors ${dpr}x density`, () => {
        const m = canvasMetrics(240, 120, {dpr,minRatio:2});
        assert.equal(m.pixelWidth, 240*Math.max(dpr,2));
    });
}
test('invalid DPR falls back safely; very large surfaces respect pixel budget', () => {
    assert.equal(canvasMetrics(200,100,{dpr:NaN}).pixelWidth,200);
    const m=canvasMetrics(10000,8000,{dpr:4,maxPixels:4000000});
    assert.ok(m.pixelWidth*m.pixelHeight<=4000000);
});
test('hidden canvases do not allocate zero-length buffers', () => {
    const m=canvasMetrics(0,0);assert.equal(m.pixelWidth,1);assert.ok(Number.isFinite(m.scaleX));
});
test('invalid CSS sizes rejected rather than corrupt canvas context',()=>{
    assert.throws(()=>canvasMetrics(-1,100));assert.throws(()=>canvasMetrics(Infinity,100));
});
test('canvas dimensions only assigned when backing size changes', () => {
    let w=200,h=100,writes=0;
    const c={get width(){return w},set width(v){w=v;writes++},get height(){return h},set height(v){h=v;writes++}};
    resizeCanvas(c,{width:200,height:100},{dpr:1});assert.equal(writes,0);
    resizeCanvas(c,{width:200,height:100},{dpr:2});assert.equal(writes,2);
    resizeCanvas(c,{width:200,height:100},{dpr:2});assert.equal(writes,2);
});
test('2D transform is absolute and non-accumulating, including fractional sizes', () => {
    const calls=[],ctx={setTransform(...x){calls.push(x)},clearRect(){}};
    const c={getContext:()=>ctx},m=canvasMetrics(333.33,137.42,{dpr:1.25});
    cssCanvasContext(c,m);cssCanvasContext(c,m);
    assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0][0],m.scaleX);assert.equal(calls[0][3],m.scaleY);
});
test('DPR watcher re-arms media query, refreshes on resize, and fully disposes', () => {
    let redraws=0;const queries=[],listeners=new Map();
    const win={devicePixelRatio:1,addEventListener:(t,fn)=>listeners.set(t,fn),removeEventListener:t=>listeners.delete(t),matchMedia:(text)=>{
        const q={text,fn:null,addEventListener(t,fn){this.fn=fn},removeEventListener(){this.fn=null}};queries.push(q);return q;
    }};
    const dispose=watchPixelDensity(()=>redraws++,win);
    win.devicePixelRatio=2;queries[0].fn();
    assert.equal(redraws,1);assert.ok(queries[1].text.includes('2dppx'));assert.equal(queries[0].fn,null);
    listeners.get('resize')();assert.equal(redraws,2);
    dispose();assert.equal(queries.at(-1).fn,null);assert.equal(listeners.size,0);
});
test('omitted browser DPR events recover via scalar-only watchdog, then stop on dispose',()=>{
    let poll,cleared=false,draws=0;
    const win={devicePixelRatio:1,document:{hidden:false},addEventListener(){},removeEventListener(){},setInterval(fn){poll=fn;return 7},clearInterval(id){assert.equal(id,7);cleared=true}};
    const stop=watchPixelDensity(()=>draws++,win);poll();assert.equal(draws,0);
    win.devicePixelRatio=2;poll();assert.equal(draws,1);poll();assert.equal(draws,1);
    win.document.hidden=true;win.devicePixelRatio=3;poll();assert.equal(draws,1);
    win.document.hidden=false;poll();assert.equal(draws,2);stop();assert.equal(cleared,true);
});

test('world Z axis remains centered in every viewport size after moving controls outside canvas', async () => {
    const {SolidViewport}=await import('../src/viewport/viewport.js');
    for(const width of [280,500,800]) {
        const view={width,height:600,zoom:1,pan:[0,0],basis:()=>({right:[1,0,0],up:[0,0,1],view:[0,1,0]})};
        for(const z of [-2,0,2]) assert.equal(SolidViewport.prototype.project.call(view,[0,0,z])[0],width/2);
    }
});
test('dial redraws preserve separate fine teeth after thick indicator painting', async () => {
    const {drawIndexDial}=await import('../src/viewport/axial-instrument.js');
    const strokes=[];
    const ctx={setTransform(){},clearRect(){},setLineDash(){},beginPath(){},arc(){},moveTo(){},lineTo(){},fillText(){},stroke(){strokes.push({width:this.lineWidth,color:this.strokeStyle});}};
    const canvas={width:146,height:146,getBoundingClientRect:()=>({width:146,height:146}),getContext:()=>ctx};
    for(const index of [0,12,15,95,0]) drawIndexDial(canvas,index,96);
    const ticks=strokes.filter(s=>['#ed225daa','#ed225d50'].includes(s.color));
    assert.equal(ticks.length,96*5);assert.ok(ticks.every(s=>s.width<=1.25));
});

test('profile height grip follows the selected crown or pavilion side', async () => {
    const { drawAxialProfile } = await import('../src/viewport/axial-instrument.js');
    const { cubeSolid } = await import('../src/domain/geometry.js');
    const ctx = { setTransform(){}, clearRect(){}, setLineDash(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, quadraticCurveTo(){}, roundRect(){}, arc(){}, fill(){} };
    const canvas = { width: 234, height: 174, getBoundingClientRect: () => ({ width: 234, height: 174 }), getContext: () => ctx };
    for (const part of ['crown', 'pavilion']) {
        const grips = drawAxialProfile(canvas, cubeSolid(), { translation: [0, 0, 0] }, undefined, part);
        const height = grips.find(g => g.action === 'scaleZ'), waist = grips.find(g => g.action === 'translateZ');
        assert.ok(part === 'crown' ? height.y < waist.y : height.y > waist.y);
        assert.ok(height.y >= 8 && height.y <= 166);
    }
});
