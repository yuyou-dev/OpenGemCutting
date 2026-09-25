import { RoughRenderer } from '../renderer.js';
import { traceShader, displayShader } from './shaders.js';
import { packLightLabEnvironment, spectralWhite } from './environment.js';
import { environmentPreset } from '../../core/lightlab/presets.js';
import { OBSERVATION_KINDS } from '../../core/lightlab/observation.js';
import { hexToLinear, rad } from '../../core/lightlab/math.js';

const modes = { beauty: 0, angles: 1, leak: 2, path: 3, normals: 4, bounces: 5, residual: 6 };
const displayOptions = new Set(['exposure', 'toneMapping', 'denoise']);
function halton(i, base) { let f = 1, value = 0; while (i > 0) { f /= base; value += f * (i % base); i = Math.floor(i / base); } return value; }

/** LightLab transport and lighting, using the host's GPU resource lifecycle only.
 * Geometry, camera and millimetres come directly from the canonical compiler.
 * All-polished: upstream deterministic Fresnel splitting. Mixed finishes: the
 * accepted GGX dielectric transport with LightLab emitter radiance and sampling.
 */
export class LightLabRenderer extends RoughRenderer {
  constructor(canvas, onProgress = () => {}) {
    super(canvas, onProgress);
    this.environment = environmentPreset('studio');
    this.options = {
      ...this.options, maxBounces: 32, allPolished: false, mode: 'beauty',
      toneMapping: 'aces', background: '#f4f5f6', headEnabled: false, headAngle: 10, showEdges: false,
    };
    this.uploadEnvironment();
  }

  initializeResources() {
    const gl = this.gl;
    this.programs = []; this.textures = new Set(); this.fbos = []; this.geometryTextures = []; this.targets = [];
    this.uniformCache = new Map(); this.fence = null; this.vao = null; this.lightTexture = null;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.trace = this.program(traceShader);
    this.displayProgram = this.program(displayShader);
  }

  get usesRoughTransport() { return !!this.mesh?.audit.frosted && !this.options.allPolished; }

  uploadEnvironment() {
    if (!this.environment || this.contextLost || this.disposed) return;
    if (this.lightTexture) this.dropTexture(this.lightTexture);
    this.packedEnvironment = packLightLabEnvironment(this.environment);
    this.lightTexture = this.texture(new Float32Array(this.packedEnvironment.data.flat()));
  }

  uploadScene() {
    super.uploadScene();
    if (!this.lightTexture) this.uploadEnvironment();
  }

  setCamera(camera) { this.camera = camera; this.reset(); }

  setOptions(input) {
    for (const [key, value] of Object.entries(input)) {
      if (key === 'environment') {
        if (value !== this.environment) { this.environment = value; this.uploadEnvironment(); }
      }
      else if (key in this.material && key !== 'mm') this.material[key] = value;
      else if (key in this.options) this.options[key] = value;
    }
    if (Object.keys(input).every(key => displayOptions.has(key))) this.display();
    else this.reset();
  }

  renderOnce() {
    if (this.disposed || this.contextLost || !this.mesh) return false;
    const gl = this.gl, p = this.trace, options = this.options, mesh = this.mesh, env = this.environment;
    if (this.fence) {
      if (gl.clientWaitSync(this.fence, 0, 0) === gl.TIMEOUT_EXPIRED) return false;
      gl.deleteSync(this.fence); this.fence = null;
    }
    gl.bindVertexArray(this.vao); gl.useProgram(p); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    ['uNodes', 'uTriangles', 'uPlanes', 'uMaterials'].forEach((name, i) => this.bind(p, name, this.geometryTextures[i], i));
    this.bind(p, 'uLights', this.lightTexture, 5);
    const center = mesh.bbox.min.map((value, k) => (value + mesh.bbox.max[k]) / 2);
    const radius = Math.max(...mesh.bbox.max.map((value, k) => value - mesh.bbox.min[k])) / 2;
    const mode = modes[options.mode] ?? 0;
    const observation = mode === 0 ? Math.max(0, OBSERVATION_KINDS.indexOf(env.observation?.kind ?? 'none')) : 0;
    const spectral = mode || observation || this.material.spectral === 'mono' ? 0 : this.material.spectral === 'spectral' && !this.interactive ? 2 : 1;
    const values = {
      uResolution: [this.canvas.width, this.canvas.height],
      uJitter: this.sample ? [halton(this.sample, 2) - .5, halton(this.sample, 3) - .5] : [0, 0],
      uEye: this.camera.eye, uRight: this.camera.right, uUp: this.camera.up, uCenter: center, uCameraOffset: this.camera.offset ?? [0, 0, 0],
      uPan: [0, 0], uDistance: Math.max(4, 5 * radius), uSpan: this.camera.span,
      uAspect: this.canvas.width / this.canvas.height, uIor: this.material.ior,
      uDispersion: this.material.spectral === false ? 0 : this.material.dispersion,
      uMmPerUnit: mesh.scale, uDiameter: radius * 2 * mesh.scale, uSigma: this.material.sigma,
      uSpectralWhite: spectralWhite, uBackground: hexToLinear(options.background),
      uAmbient: env.ambient, uLower: env.lower, uSample: this.sample,
      uHeadAngle: options.headEnabled ? rad(options.headAngle) : 0,
      uAperture: rad(env.observation?.aperture ?? 10), uMinAngle: rad(env.observation?.minAngle ?? 0), uBacklight: env.observation?.backlight ?? 1,
    };
    for (const [name, value] of Object.entries(values)) this.uniform(p, name, value);
    const ints = {
      uPlaneCount: mesh.faces.length, uNodeCount: this.bvh.nodeCount, uCount: mesh.faces.length,
      uMesh: 0, uLightCount: this.packedEnvironment.count, uMaxBounces: options.maxBounces,
      uMode: mode, uSpectral: spectral, uObservation: observation, uEdges: options.showEdges ? 1 : 0, uAccumulate: 1,
      uRough: this.usesRoughTransport ? 1 : 0, uNEE: options.nee ? 1 : 0,
      uTraversal: mesh.faces.length > 768 ? 1 : options.traversal,
    };
    for (const [name, value] of Object.entries(ints)) this.uniform(p, name, value, 'i');
    const destination = this.targets[this.write], previous = this.targets[1 - this.write];
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fbo); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.bind(p, 'uPrevious', previous.image, 4); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.sample++; this.write = 1 - this.write; this.display();
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); this.reportProgress();
    return true;
  }

  display() {
    if (this.disposed || this.contextLost || !this.mesh || !this.sample) return;
    const gl = this.gl, p = this.displayProgram, target = this.targets[1 - this.write];
    gl.bindVertexArray(this.vao); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(p);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.bind(p, 'uImage', target.image, 0); this.bind(p, 'uGuide', target.guide, 1);
    this.uniform(p, 'uExposure', this.options.exposure); this.uniform(p, 'uSamples', this.sample);
    this.uniform(p, 'uTone', this.options.toneMapping === 'aces' ? 0 : this.options.toneMapping === 'reinhard' ? 1 : 2, 'i');
    const mode = modes[this.options.mode] ?? 0;
    const observing = mode === 0 && this.environment.observation?.kind !== 'none';
    this.uniform(p, 'uMode', observing ? 1 : mode, 'i');
    this.uniform(p, 'uDenoise', this.options.denoise ? 1 : 0, 'i');
    this.uniform(p, 'uRough', this.usesRoughTransport ? 1 : 0, 'i');
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  info() {
    return { ...super.info(), engine: 'LightLab', transport: this.usesRoughTransport ? 'GGX dielectric + LightLab' : 'LightLab polished',
      intersector: this.usesRoughTransport && (this.mesh.faces.length > 768 || this.options.traversal === 1) ? 'BVH' : 'convex-halfspaces', lights: this.packedEnvironment.count };
  }
}
