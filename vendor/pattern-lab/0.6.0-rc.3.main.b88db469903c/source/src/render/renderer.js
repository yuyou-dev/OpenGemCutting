import { vertexShader, traceShader, displayShader } from './shaders.js';
import { opticalMesh, buildFacetBVH, opticalCameraSpan } from './scene.js';

const DISPLAY_OPTIONS = new Set(['exposure', 'denoise']);

/** Host-owned canvas and animation lifetime; all optical transport is in shaders.js.
 * The accepted analytic renderer supplies BSDF/PDF/MIS, accumulation and display.
 * This adapter keeps the lab's camera/material API and owns GPU resource recovery.
 */
export class RoughRenderer {
  constructor(canvas, onProgress = () => {}) {
    this.canvas = canvas;
    this.onProgress = onProgress;
    this.gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL 2 unavailable');
    this.disposed = false;
    this.contextLost = false;
    this.running = false;
    this.active = false;
    this.sample = 0;
    this.target = 64;
    this.engine = 'path';
    this.mode = 0;
    this.interactive = false;
    this.fence = null;
    this.raf = null;
    this.camera = { eye: [0, -.48, .877], right: [1, 0, 0], up: [0, .877, .48], span: 1.12 };
    this.material = { ior: 1.54, sigma: [.13, .68, .065], mm: 5, dispersion: .013, spectral: false };
    this.options = { nee: true, denoise: true, compare: false, env: 0, rotation: 0, exposure: 0, budget: 32, traversal: 0 };
    this.onLost = event => {
      event.preventDefault();
      const resume = this.active;
      this.contextLost = true;
      this.stop();
      this.resumeAfterRestore = resume;
      this.onProgress({ error: 'WebGL 上下文暂时丢失，恢复后将自动重新累计。' });
    };
    this.onRestored = () => {
      if (this.disposed) return;
      this.contextLost = false;
      try {
        this.initializeResources();
        if (this.mesh) this.uploadScene();
        this.allocate();
        if (this.resumeAfterRestore) this.start(this.target);
      } catch (error) {
        this.releaseResources();
        this.contextLost = true;
        this.onProgress({ error: `光学资源恢复失败：${error.message}` });
      }
    };
    try {
      this.initializeResources();
      this.allocate();
    } catch (error) {
      this.releaseResources();
      throw error;
    }
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  get exposure() { return this.options.exposure; }
  set exposure(value) { this.setOptions({ exposure: value }); }

  initializeResources() {
    const gl = this.gl;
    this.programs = [];
    this.textures = new Set();
    this.fbos = [];
    this.geometryTextures = [];
    this.targets = [];
    this.uniformCache = new Map();
    this.fence = null;
    this.vao = null;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.trace = this.program(traceShader);
    this.displayProgram = this.program(displayShader);
  }

  program(fragmentSource) {
    const gl = this.gl, program = gl.createProgram(), shaders = [];
    this.programs.push(program);
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexShader], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      return program;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }

  texture(data = null, width = 1024, height = Math.max(1, Math.ceil((data?.length ?? 0) / 4 / width))) {
    const gl = this.gl, texture = gl.createTexture();
    this.textures.add(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    let pixels = null;
    if (data) { pixels = new Float32Array(width * height * 4); pixels.set(data); }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  dropTexture(texture) {
    this.gl.deleteTexture(texture);
    this.textures.delete(texture);
  }

  allocate() {
    const gl = this.gl;
    for (const fbo of this.fbos) gl.deleteFramebuffer(fbo);
    for (const target of this.targets) { this.dropTexture(target.image); this.dropTexture(target.guide); }
    this.fbos = [];
    this.targets = [];
    for (let i = 0; i < 2; i++) {
      const image = this.texture(null, this.canvas.width, this.canvas.height);
      const guide = this.texture(null, this.canvas.width, this.canvas.height);
      const fbo = gl.createFramebuffer();
      this.fbos.push(fbo);
      this.targets.push({ image, guide, fbo });
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, guide, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FLOAT_FRAMEBUFFER_INCOMPLETE');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.reset();
  }

  setSize(width = 220, height = 220) {
    width = Math.max(32, Math.round(width / 2) * 2);
    height = Math.max(32, Math.round(height));
    // Fit the pixel and device budgets uniformly so changing quality keeps framing.
    const scale = Math.min(1, 1024 / Math.sqrt(width * height), this.maxTextureSize / width, this.maxTextureSize / height);
    // Even widths give A/B matching pixel coordinates and common random samples.
    width = Math.max(2, Math.floor(width * scale / 2) * 2);
    height = Math.max(1, Math.floor(height * scale));
    if (this.canvas.width === width && this.canvas.height === height && this.targets.length) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (!this.contextLost && !this.disposed) this.allocate();
  }

  setScene(compiled) {
    if (compiled === this.compiled) return;
    this.compiled = compiled;
    this.mesh = opticalMesh(compiled);
    this.material.mm = this.mesh.scale;
    if (!this.contextLost && !this.disposed) this.uploadScene();
    this.reset();
  }

  uploadScene() {
    const mesh = this.mesh;
    for (const texture of this.geometryTextures) this.dropTexture(texture);
    this.bvh = buildFacetBVH(mesh);
    const planes = new Float32Array(mesh.faces.flatMap(face => [...face.normal, face.offset]));
    const materials = new Float32Array(mesh.faces.flatMap(face => [face.finish.state === 'frosted' ? face.finish.alpha : 0, face.finish.scatter || 0, 0, 0]));
    this.geometryTextures = [this.texture(this.bvh.nodes), this.texture(this.bvh.triangles), this.texture(planes), this.texture(materials)];
  }

  setOptions(input) {
    const keys = Object.keys(input);
    // Validation belongs to the state layer; accept only renderer-owned settings.
    for (const key of keys) {
      if (key in this.options) this.options[key] = input[key];
      else if (key in this.material && key !== 'mm') this.material[key] = input[key];
      else if (key === 'integrator') this.engine = input[key] === 0 ? 'fast' : 'path';
      else if (key === 'mode') this.mode = input[key];
    }
    if (keys.every(key => DISPLAY_OPTIONS.has(key))) this.display();
    else this.reset();
  }

  setInteractive(on) {
    on = !!on;
    if (on === this.interactive) return;
    this.interactive = on;
    if (on) {
      this.priorSize = [this.canvas.width, this.canvas.height];
      this.priorTarget = this.target;
      this.setSize(Math.round(110 * this.canvas.width / this.canvas.height), 110);
    } else {
      this.setSize(...(this.priorSize ?? [220, 220]));
      this.target = this.priorTarget ?? this.target;
    }
  }

  reset() {
    this.sample = 0;
    this.write = 0;
    this.started = performance.now();
    this.reportProgress();
  }

  reportProgress() {
    this.onProgress({ sample: this.sample, target: this.target, width: this.canvas.width, height: this.canvas.height });
  }

  uniform(program, name, value, type = 'f') {
    const gl = this.gl;
    if (!this.uniformCache.has(program)) this.uniformCache.set(program, new Map());
    const cache = this.uniformCache.get(program);
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    const location = cache.get(name);
    if (location === null) return;
    if (Array.isArray(value)) {
      if (value.length === 2) gl.uniform2fv(location, value);
      else gl.uniform3fv(location, value);
    } else if (type === 'i') gl.uniform1i(location, value);
    else gl.uniform1f(location, value);
  }

  bind(program, name, texture, slot) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    this.uniform(program, name, slot, 'i');
  }

  renderOnce() {
    if (this.disposed || this.contextLost || !this.mesh) return false;
    const gl = this.gl, program = this.trace, options = this.options, mesh = this.mesh;
    if (this.fence) {
      if (gl.clientWaitSync(this.fence, 0, 0) === gl.TIMEOUT_EXPIRED) return false;
      gl.deleteSync(this.fence);
      this.fence = null;
    }
    gl.bindVertexArray(this.vao);
    gl.useProgram(program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    ['uNodes', 'uTriangles', 'uPlanes', 'uMaterials'].forEach((name, i) => this.bind(program, name, this.geometryTextures[i], i));
    const center = mesh.bbox.min.map((value, i) => (value + mesh.bbox.max[i]) / 2);
    const radius = Math.max(...mesh.bbox.max.map((value, i) => value - mesh.bbox.min[i])) / 2;
    const values = {
      uEye: this.camera.eye, uRight: this.camera.right, uUp: this.camera.up, uCenter: center, uCameraOffset: this.camera.offset ?? [0, 0, 0],
      uResolution: [this.canvas.width, this.canvas.height], uStageZ: center[2] - radius * 3,
      uPatternScale: Math.PI * 8 / Math.max(radius, 1e-5), uDistance: Math.max(4, 5 * radius),
      uAspect: this.canvas.width / this.canvas.height,
      uSpan: opticalCameraSpan(mesh, this.camera, this.canvas.width / this.canvas.height, options.compare),
      uIor: this.material.ior, uDispersion: this.material.dispersion, uScale: mesh.scale,
      uRotation: options.rotation, uSigma: this.material.sigma,
    };
    for (const [name, value] of Object.entries(values)) this.uniform(program, name, value);
    const ints = {
      uCount: mesh.faces.length, uTraversal: options.traversal, uBudget: options.budget,
      uCompare: options.compare ? 1 : 0, uMode: this.mode, uEnv: options.env,
      uIntegrator: this.engine === 'fast' ? 0 : 1, uSpectral: this.material.spectral ? 1 : 0,
      uNEE: options.nee ? 1 : 0, uSample: this.sample,
    };
    for (const [name, value] of Object.entries(ints)) this.uniform(program, name, value, 'i');
    const destination = this.targets[this.write], previous = this.targets[1 - this.write];
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.bind(program, 'uPrevious', previous.image, 4);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.sample++;
    this.write = 1 - this.write;
    this.display();
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    this.reportProgress();
    return true;
  }

  display() {
    if (this.disposed || this.contextLost || !this.mesh || !this.sample) return;
    const gl = this.gl, program = this.displayProgram, target = this.targets[1 - this.write];
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.bind(program, 'uImage', target.image, 0);
    this.bind(program, 'uGuide', target.guide, 1);
    this.bind(program, 'uMaterials', this.geometryTextures[3], 2);
    this.uniform(program, 'uExposure', this.options.exposure);
    this.uniform(program, 'uSamples', this.sample);
    this.uniform(program, 'uDenoise', this.options.denoise ? 1 : 0, 'i');
    this.uniform(program, 'uCompare', this.options.compare ? 1 : 0, 'i');
    this.uniform(program, 'uAnyFrost', this.mesh.audit.frosted ? 1 : 0, 'i');
    this.uniform(program, 'uMode', this.mode, 'i');
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readLinear() {
    if (this.contextLost || this.disposed || !this.sample) return null;
    const gl = this.gl, out = new Float32Array(this.canvas.width * this.canvas.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[1 - this.write].fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  info() {
    const gl = this.gl;
    return { renderer: gl.getParameter(gl.RENDERER), intersector: this.options.traversal === 1 ? 'BVH' : 'convex-halfspaces', samples: this.sample, resolution: [this.canvas.width, this.canvas.height], triangles: this.bvh?.triangleCount, nodes: this.bvh?.nodeCount, error: gl.getError(), contextLost: this.contextLost, elapsedMs: performance.now() - this.started };
  }

  start(target = this.target) {
    this.target = target;
    this.active = true;
    if (this.contextLost) { this.resumeAfterRestore = true; return; }
    if (this.disposed) return;
    this.running = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    const tick = () => {
      this.raf = null;
      if (!this.running || this.disposed) return;
      if (this.sample < this.target) this.renderOnce();
      if (this.sample < this.target) this.raf = requestAnimationFrame(tick);
      else this.running = false;
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    this.active = false;
    this.resumeAfterRestore = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  releaseResources() {
    const gl = this.gl;
    if (this.fence) gl.deleteSync(this.fence);
    for (const texture of this.textures ?? []) gl.deleteTexture(texture);
    for (const fbo of this.fbos ?? []) gl.deleteFramebuffer(fbo);
    for (const program of this.programs ?? []) gl.deleteProgram(program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.fence = null;
    this.textures?.clear();
    this.fbos = [];
    this.programs = [];
    this.targets = [];
    this.geometryTextures = [];
    this.uniformCache?.clear();
    this.vao = null;
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.releaseResources();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
  }
}
