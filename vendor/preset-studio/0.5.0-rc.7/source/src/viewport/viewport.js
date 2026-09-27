import { cameraFromPose, poseFromCamera, dragViewport, zoomViewport, keyViewport, advanceViewportCamera } from './navigation.js';
import { resizeCanvas, cssCanvasContext, watchPixelDensity } from './canvas-resolution.js';
import { rad, sub, dot, cross, unit, polygonNormal, boundingBox, clamp } from '../domain/math.js';
import { projectedTriangles, strokeVisibleLine } from './visible-lines.js';
import { meshEdges } from './mesh-edges.js';
const partColor = { crown: [.79, .82, .88], pavilion: [.64, .71, .8], girdle: [.74, .8, .87] };
const UI_FONT = '"Noto Sans SC Variable","Noto Sans SC",sans-serif', MONO_FONT = '"IBM Plex Mono",ui-monospace,monospace';
function basisFor(yaw, elevation) { const y = rad(yaw), e = rad(elevation), view = [Math.cos(e) * Math.cos(y), Math.cos(e) * Math.sin(y), Math.sin(e)], right = [-Math.sin(y), Math.cos(y), 0]; return { view, right, up: cross(view, right) }; }
function triangleAt(x, y, a, b, c) { const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(d) < 1e-10)
    return null; const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d; return u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001 ? u * a[2] + v * b[2] + (1 - u - v) * c[2] : null; }
/** Depth-correct CPU fallback. Not painter sorting: holes and concave stock stay holes. */
function rasterize(canvas, polys, project, { highlight = '', pixelScale = 1 } = {}) {
    const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    if (!ctx)
        return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const image = ctx.createImageData(w, h), zbuf = new Float32Array(w * h);
    zbuf.fill(Infinity);
    for (const f of polys) {
        const ps = f.v.map(project), n = polygonNormal(f.v), light = .57 + .43 * Math.max(0, dot(n, unit([-.3, -.5, 1]))), base = f.id === highlight ? [.98, .64, .79] : partColor[f.part] || [.77, .8, .85], rgb = base.map(v => Math.round(clamp(v * light + .12, 0, 1) * 255));
        for (let k = 1; k < ps.length - 1; k++) {
            const a = ps[0], b = ps[k], c = ps[k + 1], x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0]))), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
            for (let y = y0; y <= y1; y++)
                for (let x = x0; x <= x1; x++) {
                    const z = triangleAt(x + .5, y + .5, a, b, c), i = y * w + x;
                    if (z !== null && z < zbuf[i]) {
                        zbuf[i] = z;
                        const j = i * 4; image.data[j] = rgb[0]; image.data[j+1] = rgb[1]; image.data[j+2] = rgb[2]; image.data[j+3] = 255;
                    }
                }
        }
    }
    ctx.putImageData(image, 0, 0);
    // Preserve the depth test, but stroke continuous visible spans instead of
    // stamping integer 1px squares. CSS-width antialiasing survives every DPR.
    ctx.lineWidth = .85 * pixelScale;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const edge of meshEdges(polys)) {
        const a = project(edge.a), b = project(edge.b), draft = edge.draft;
        const l = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1])));
        ctx.strokeStyle = draft ? '#ed225d' : '#52657d';
        ctx.beginPath(); let running = false;
        for (let j = 0; j <= l; j++) {
            const t = j/l, px = a[0] + t * (b[0] - a[0]), py = a[1] + t * (b[1] - a[1]);
            const x = Math.floor(px), y = Math.floor(py), z = a[2] + t * (b[2] - a[2]);
            const visible = x >= 0 && y >= 0 && x < w && y < h && z <= zbuf[y*w+x] + .015;
            if (visible) { if (running) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
            running = visible;
        }
        ctx.stroke();
    }
}
export class SolidViewport {
    constructor(canvas, overlay, callbacks = {}) {
        this.canvas = canvas;
        this.overlay = overlay;
        this.callbacks = callbacks;
        this.yaw = -55;
        this.elevation = 28;
        this.zoom = 1;
        this.pan = [0, 0];
        this.camera = cameraFromPose(this);
        this.mode = 'axial';
        this.polys = [];
        this.ghost = [];
        this.showGhost = true;
        this.highlight = '';
        this.pending = false;
        this.destroyed = false;
        this.stopDensityWatch = watchPixelDensity(() => this.draw());
        this.resizeObserver = new ResizeObserver(() => this.draw());
        this.resizeObserver.observe(canvas.parentElement);
        this.abort = new AbortController();
        const opt = { signal: this.abort.signal };
        overlay.addEventListener('pointerdown', e => this.down(e), opt);
        overlay.addEventListener('pointermove', e => this.move(e), opt);
        overlay.addEventListener('pointerup', e => this.up(e), opt);
        overlay.addEventListener('pointercancel', e => this.cancelDrag(e), opt);
        overlay.addEventListener('keydown', e => { if (this.callbacks.isLocked?.()) return; if(e.key === 'Escape') this.cancelDrag(e); else if (keyViewport(this.camera, e.key, e.shiftKey)) { e.preventDefault(); this.draw(); } }, opt);
        overlay.addEventListener('wheel', e => { if (this.callbacks.isLocked?.()) return; e.preventDefault(); zoomViewport(this.camera, e.deltaY); this.draw(); }, { ...opt, passive: false });
        overlay.addEventListener('contextmenu', e => e.preventDefault(), opt);
        overlay.addEventListener('dblclick', () => this.setView('iso'), opt);
        try {
            this.gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true });
        }
        catch { }
        if (this.gl)
            this.initGL();
    }
    initGL() { const gl = this.gl; const compile = (type, s) => { const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(sh)); return sh; }; const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, '#version 300 es\nin vec3 a;in vec4 c;out vec4 v;void main(){gl_Position=vec4(a,1.);v=c;}')); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;in vec4 v;out vec4 outColor;void main(){outColor=v;}')); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(p)); this.program = p; this.buffer = gl.createBuffer(); this.attrs = { a: gl.getAttribLocation(p, 'a'), c: gl.getAttribLocation(p, 'c') }; }
    basis() { return basisFor(this.yaw, this.elevation); }
    project(v) { const b = this.basis(), w = this.width, h = this.height, radius = this.frameRadius ?? 1, k = Math.min(w, h) * .38 * this.zoom / radius;
        const relative = sub(v, this.frameCenter ?? [0,0,0]);
        return [w / 2 + this.pan[0] + dot(relative, b.right) * k, h / 2 + this.pan[1] - dot(relative, b.up) * k, -dot(relative, b.view) / radius]; }
    frameStock(polys) {
        const bounds = polys?.length ? boundingBox(polys) : null;
        this.frameCenter = bounds ? bounds.lo.map((v,i)=>(v+bounds.hi[i])/2) : [0,0,0];
        this.frameRadius = bounds ? Math.max(.001, Math.hypot(...bounds.size)/2) : 1;
        this.draw();
    }
    setView(view) { [this.yaw, this.elevation] = view === 'top' ? [0, 90] : view === 'bottom' ? [0, -90] : view === 'side' ? [-90, 0] : [-55, 28]; this.pan = [0, 0]; this.zoom = 1; this.camera = cameraFromPose(this); this.draw(); }
    setData(polys, ghost) { this.polys = polys; this.ghost = ghost; this.draw(); }
    setMode(mode) { this.mode = mode === 'orbit' ? 'orbit' : 'axial'; this.overlay.style.cursor = 'grab'; this.draw(); }
    setPaused(paused) {
        this.paused = paused;
        if (paused) { this.drag = null; cancelAnimationFrame(this.frame); this.pending = false; }
        else this.draw();
    }
    draw() { if (this.pending || this.destroyed || this.paused)
        return; this.pending = true; this.frame = requestAnimationFrame(() => { this.pending = false; if (!this.destroyed) { const moving = advanceViewportCamera(this.camera); Object.assign(this, poseFromCamera(this.camera)); this.render(); if (moving) this.draw(); } }); }
    render() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1)
            return;
        this.width = rect.width;
        this.height = rect.height;
        const solid = resizeCanvas(this.canvas, rect, { minRatio: this.gl ? 1 : 1.5, maxPixels: 12000000 });
        // The overlay has its OWN HiDPI backing buffer, independent of the GL buffer.
        this.overlayMetrics = resizeCanvas(this.overlay, rect);
        if (this.gl) this.renderGL();
        else rasterize(this.canvas, this.polys, v => {
            const p = this.project(v); return [p[0] * solid.scaleX, p[1] * solid.scaleY, p[2]];
        }, { highlight: this.highlight, pixelScale: Math.min(solid.scaleX, solid.scaleY) });
        this.drawOverlay();
    }
    renderGL() {
        const gl = this.gl, w = this.width, h = this.height, verts = [], edges = [], push = (target, p, c, dz = 0) => { const q = this.project(p); target.push(q[0] / w * 2 - 1, 1 - q[1] / h * 2, q[2] * .07 + dz, ...c); };
        for (const f of this.polys) {
            const n = polygonNormal(f.v), l = .57 + .43 * Math.max(0, dot(n, unit([-.3, -.5, 1]))), base = f.id === this.highlight ? [.98, .64, .79] : partColor[f.part] || [.77, .8, .85], c = [...base.map(v => clamp(v * l + .12, 0, 1)), 1];
            for (let k = 1; k < f.v.length - 1; k++)
                for (const v of [f.v[0], f.v[k], f.v[k + 1]])
                    push(verts, v, c);
        }
        for (const { a, b, draft } of meshEdges(this.polys))
            for (const v of [a, b]) push(edges, v, draft ? [.93, .13, .36, 1] : [.30, .37, .45, 1], -.00004);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.enableVertexAttribArray(this.attrs.a);
        gl.enableVertexAttribArray(this.attrs.c);
        gl.vertexAttribPointer(this.attrs.a, 3, gl.FLOAT, false, 28, 0);
        gl.vertexAttribPointer(this.attrs.c, 4, gl.FLOAT, false, 28, 12);
        for (const [data, mode] of [[verts, gl.TRIANGLES], [edges, gl.LINES]]) {
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
            gl.drawArrays(mode, 0, data.length / 7);
        }
    }
    drawOverlay() {
        const ctx = cssCanvasContext(this.overlay, this.overlayMetrics);
        if (!ctx) return;
        const occluders = projectedTriangles(this.polys, v => this.project(v));
        // Fixed world spindle: camera orbit/pan never mutates the manufacturing frame.
        const axis = [[0,0,-2.1],[0,0,2.1]].map(v=>this.project(v));
        ctx.strokeStyle='#69696980';ctx.lineWidth=1;ctx.setLineDash([5,5]);
        strokeVisibleLine(ctx, axis[0], axis[1], occluders); ctx.setLineDash([]);
        if(this.showGhost) {
            ctx.strokeStyle='#ed225d60';ctx.lineWidth=.65;ctx.setLineDash([3,4]);
            const edges = new Set();
            for (const f of this.ghost) for (let i = 0; i < f.v.length; i++) {
                const a = f.v[i], b = f.v[(i + 1) % f.v.length];
                const key = [a, b].map(v => v.map(n => n.toFixed(6)).join(',')).sort().join('|');
                if (edges.has(key)) continue;
                edges.add(key);
                strokeVisibleLine(ctx, this.project(a), this.project(b), occluders);
            }
            ctx.setLineDash([]);
        }
    }

    down(e) {
        if (this.callbacks.isLocked?.()) return;
        e.preventDefault(); this.overlay.focus({ preventScroll: true });
        this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, elevation: this.elevation, pan: [...this.pan], mode: e.shiftKey && e.button !== 2 ? 'pan' : 'orbit' };
        this.overlay.setPointerCapture(e.pointerId);
    }
    move(e) {
        const d = this.drag; if (!d) return;
        if (this.callbacks.isLocked?.()) { this.cancelDrag(); return; }
        const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
        dragViewport(this.camera, dx, dy, d.mode === 'pan');
        this.draw();
    }
    cancelDrag() {
        if (!this.drag) return;
        const d = this.drag; this.drag = null;
        this.yaw = d.yaw; this.elevation = d.elevation; this.pan = d.pan; this.camera = cameraFromPose(this);
        this.draw();
    }
    up() { this.drag = null; }
    destroy() { this.destroyed = true; cancelAnimationFrame(this.frame); this.stopDensityWatch(); this.abort.abort(); this.resizeObserver.disconnect(); if (this.gl) {
        this.gl.deleteBuffer(this.buffer);
        this.gl.deleteProgram(this.program);
    } }
}
export function drawOrthographic(canvas, polys, view = 'top', framePolys = polys) {
    const r = canvas.getBoundingClientRect();
    // At least 2x supersampling even on 1x monitors; Retina uses native density.
    const m = resizeCanvas(canvas, r, { minRatio: 2, maxPixels: 4000000 });
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(1, 0, 0, 1, 0, 0); ctx?.clearRect(0, 0, canvas.width, canvas.height);
    if (!polys.length || r.width < 1 || r.height < 1) return;
    const w = r.width, h = r.height;
    const b = basisFor(view === 'side' ? -90 : view === 'iso' ? -55 : 0, view === 'top' ? 90 : view === 'bottom' ? -90 : view === 'iso' ? 28 : 0), ps = framePolys.flatMap(f => f.v);
    const xs = ps.map(v => dot(v, b.right)), ys = ps.map(v => dot(v, b.up));
    const loX = Math.min(...xs), hiX = Math.max(...xs), loY = Math.min(...ys), hiY = Math.max(...ys);
    const k = .86 * Math.min(w / Math.max(.1, hiX - loX), h / Math.max(.1, hiY - loY));
    rasterize(canvas, polys, v => [(w / 2 + (dot(v, b.right) - (loX + hiX) / 2) * k) * m.scaleX,
        (h / 2 - (dot(v, b.up) - (loY + hiY) / 2) * k) * m.scaleY, -dot(v, b.view)],
        { pixelScale: Math.min(m.scaleX, m.scaleY) });
}
export function thumbnailSVG(polys, part = 'crown') {
    const b = boundingBox(polys), size = Math.max(...b.size.slice(0, 2), .1), k = 74 / size, paths = polys.filter(f => polygonNormal(f.v)[2] * (part === 'crown' ? 1 : -1) > .001).map(f => `<path d="${f.v.map((v, i) => `${i ? 'L' : 'M'}${(48 + (v[0] - b.center[0]) * k).toFixed(2)},${(44 - (v[1] - b.center[1]) * k).toFixed(2)}`).join('')}Z"/>`).join('');
    return `<svg viewBox="0 0 96 88" aria-hidden="true"><g fill="#f5f5f2" stroke="#8c8c8c" stroke-width=".65" stroke-linejoin="round">${paths}</g></svg>`;
}

/** Independent live parametric wireframe. Geometry is projected in 3D, not a thumbnail. */
export class ParameterViewport {
    constructor(canvas) {
        this.canvas=canvas;this.yaw=-55;this.elevation=28;this.zoom=1;this.polys=[];this.reference=[];this.highlight='';this.label='';this.pending=false;this.destroyed=false;
        this.stopDensityWatch=watchPixelDensity(()=>this.draw());
        this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(canvas.parentElement);
        this.abort=new AbortController();const o={signal:this.abort.signal};
        canvas.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,yaw:this.yaw,elevation:this.elevation};canvas.setPointerCapture(e.pointerId);},o);
        canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.yaw=this.drag.yaw+(e.clientX-this.drag.x)*.65;this.elevation=clamp(this.drag.elevation+(e.clientY-this.drag.y)*.6,-89.9,89.9);this.draw();},o);
        for(const k of ['pointerup','pointercancel'])canvas.addEventListener(k,()=>this.drag=null,o);
        canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=clamp(this.zoom*Math.exp(-e.deltaY*.001),.5,3);this.draw();},{...o,passive:false});
        canvas.addEventListener('dblclick',()=>this.setView('iso'),o);
    }
    setView(view){[this.yaw,this.elevation]=view==='top'?[0,90]:view==='side'?[-90,0]:[-55,28];this.zoom=1;this.draw();}
    setData(polys,reference=[],highlight='',label='') {this.polys=polys;this.reference=reference;this.highlight=highlight;this.label=label;this.draw();}
    draw(){if(this.pending||this.destroyed)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;if(!this.destroyed)this.render();});}
    render(){
        const c=this.canvas,rect=c.getBoundingClientRect(),w=rect.width,h=rect.height;if(w<2||h<2)return;
        const m=resizeCanvas(c,rect,{minRatio:2,maxPixels:4000000});const ctx=cssCanvasContext(c,m);if(!ctx)return;
        if(!this.polys.length){ctx.fillStyle='#696969';ctx.font=`11px ${UI_FONT}`;ctx.fillText('当前组件没有闭合预览',16,30);return;}
        const b=basisFor(this.yaw,this.elevation),box=boundingBox([...this.polys,...this.reference]),center=box.center;
        const ps=[...this.polys,...this.reference].flatMap(f=>f.v),xs=ps.map(v=>dot(sub(v,center),b.right)),ys=ps.map(v=>dot(sub(v,center),b.up));
        const k=Math.min((w-55)/Math.max(.15,Math.max(...xs)-Math.min(...xs)),(h-45)/Math.max(.15,Math.max(...ys)-Math.min(...ys)))*this.zoom;
        const project=v=>[w/2+dot(sub(v,center),b.right)*k,h/2-dot(sub(v,center),b.up)*k];
        const line=(points,stroke,width=1,dash=[])=>{ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();points.map(project).forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();ctx.setLineDash([]);};
        line([[0,0,box.lo[2]-.12],[0,0,box.hi[2]+.12]],'#8c8c8c80',.7,[3,4]);
        if(this.reference.length)for(const f of this.reference)line([...f.v,f.v[0]],'#8c8c8ca0',.8,[3,3]);
        const roles={angle:['main','step','keel','stagger','scissor'],table:['table','star'],star:['star','upper'],lower:['lower'],culet:['culet'],height:['rose','checker'],layers:['step','stagger','rose','keel','scissor']};
        const sorted=[...this.polys].sort((a,c)=>dot(polygonNormal(a.v),b.view)-dot(polygonNormal(c.v),b.view));
        for(const f of sorted){
            if(f.role==='interface'){line([...f.v,f.v[0]],'#a8a8a8',.7,[2,3]);continue;}
            const front=dot(polygonNormal(f.v),b.view)>0,active=(roles[this.highlight]||[]).includes(f.role)||f.id===this.highlight||f.tier===this.highlight;
            if(active&&front){ctx.beginPath();f.v.map(project).forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle='#ffd6e455';ctx.fill();}
            line([...f.v,f.v[0]],active?'#ed225d':front?'#5c82b8':'#c3ccd6',active?1.35:front?.95:.65,front?[]:[2,3]);
        }
        ctx.font=`10px ${MONO_FONT}`;ctx.fillStyle='#696969';
        if(this.highlight==='aspect'||this.highlight==='scaleX'||this.highlight==='scaleY')ctx.fillText('X/Y = '+(box.size[0]/Math.max(1e-9,box.size[1])).toFixed(3),12,h-12);
        else if(this.highlight==='height'||this.highlight==='scaleZ')ctx.fillText('H = '+box.size[2].toFixed(3)+' R',12,h-12);
        else ctx.fillText(this.label||'LOCAL Z · 组件本体',12,h-12);
    }
    destroy(){this.destroyed=true;this.stopDensityWatch();this.abort.abort();this.observer.disconnect();}
}
