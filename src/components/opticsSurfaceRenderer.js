import { createWebglOpticsRenderer, createProgram } from './opticsWebglRenderer.js';
import { surfaceFragmentShader } from './opticsSurfaceShader.js';
import { MAX_SURFACE_PLANES } from '../domain/opticsSurface.js';

export const SURFACE_TARGET_SAMPLES = 128;
const MAX_BATCH_SAMPLES = 16; // Must match MAX_BATCH in the trace shader.
const FRAME_MS = 20;

// Edge-aware a-trous pass. Only pixels whose samples met a frosted boundary
// are filtered, and neighbours must share the camera-ray facet and normal.
// Luminance is compared against the pixel's standard error, so converged
// pixels are left untouched. Below four samples the per-pixel variance is not
// yet measurable, so the first pass estimates it from the same facet.
const filterShader = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform sampler2D uGuide;
uniform int uStep;
uniform bool uFirst;
uniform float uSamples;
out vec4 outColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float KERNEL[3] = float[3](0.375, 0.25, 0.0625);
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uSource, 0);
  vec4 center = texelFetch(uSource, pixel, 0);
  vec4 guide = texelFetch(uGuide, pixel, 0);
  float luminance = dot(center.rgb, LUMA);
  float variance = center.a;
  if (uFirst) {
    variance = max(0.0, center.a - luminance * luminance);
    if (guide.w > 0.5 && uSamples < 4.0) {
      float count = 0.0, mean = 0.0, square = 0.0;
      for (int y = -2; y <= 2; y += 1) {
        for (int x = -2; x <= 2; x += 1) {
          ivec2 neighbour = clamp(pixel + ivec2(x, y), ivec2(0), size - 1);
          if (abs(abs(texelFetch(uGuide, neighbour, 0).w) - guide.w) > 0.5) continue;
          float value = dot(texelFetch(uSource, neighbour, 0).rgb, LUMA);
          count += 1.0; mean += value; square += value * value;
        }
      }
      mean /= count;
      variance = max(variance, square / count - mean * mean);
    }
  }
  float deviation = sqrt(variance / uSamples);
  if (guide.w < 0.5 || deviation < 1e-4) { outColor = vec4(center.rgb, variance); return; }
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int y = -2; y <= 2; y += 1) {
    for (int x = -2; x <= 2; x += 1) {
      ivec2 neighbour = pixel + ivec2(x, y) * uStep;
      if (any(lessThan(neighbour, ivec2(0))) || any(greaterThanEqual(neighbour, size))) continue;
      vec4 other = texelFetch(uGuide, neighbour, 0);
      if (abs(abs(other.w) - guide.w) > 0.5 || dot(other.xyz, guide.xyz) < 0.99) continue;
      vec3 value = texelFetch(uSource, neighbour, 0).rgb;
      float weight = KERNEL[abs(x)] * KERNEL[abs(y)] * exp(-abs(dot(value, LUMA) - luminance) / (4.0 * deviation));
      sum += value * weight;
      total += weight;
    }
  }
  outColor = vec4(sum / total, variance);
}`;

const displayShader = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform float uExposure;
out vec4 outColor;
void main() {
  vec3 color = texelFetch(uImage, ivec2(gl_FragCoord.xy), 0).rgb * exp2(uExposure);
  color = clamp((color * (2.51 * color + .03)) / (color * (2.43 * color + .59) + .14), 0., 1.);
  outColor = vec4(pow(max(color, vec3(0)), vec3(1. / 2.2)), 1.);
}`;

/** Accumulate linear radiance, denoise for display, and size batches from
 * measured GPU time so a single submission never stalls the page. */
export function createSurfaceAccumulation(gl, trace, canvas) {
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('当前显卡不支持磨砂采样所需的浮点缓冲，请使用全抛光模式。');
  }
  const filter = createProgram(gl, filterShader);
  const display = createProgram(gl, displayShader);
  const texture = () => gl.createTexture();
  const accumulated = [texture(), texture()], filtered = [texture(), texture()], guide = texture();
  const traceTargets = [gl.createFramebuffer(), gl.createFramebuffer()];
  const filterTargets = [gl.createFramebuffer(), gl.createFramebuffer()];
  const planeBlock = gl.createBuffer();
  gl.uniformBlockBinding(trace, gl.getUniformBlockIndex(trace, 'SurfacePlanes'), 0);
  const locations = new Map();
  const uniform = (program, name) => {
    const key = `${name}:${program === trace ? 0 : program === filter ? 1 : 2}`;
    if (!locations.has(key)) locations.set(key, gl.getUniformLocation(program, name));
    return locations.get(key);
  };
  const bindTexture = (unit, value) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, value);
  };
  const allocate = (value, format, w, h) => {
    bindTexture(4, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RGBA, format === gl.RGBA32F ? gl.FLOAT : gl.HALF_FLOAT, null);
  };
  const attach = (framebuffer, ...attachments) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    attachments.forEach((value, index) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + index, gl.TEXTURE_2D, value, 0));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('无法建立磨砂采样缓冲。');
  };
  let width = 0, height = 0, samples = 0, write = 0, batch = 1, pending = 0, chained = false;
  let geometry, key, options;
  return {
    get batchSamples() { return batch; },
    begin(w, h, next) {
      const nextKey = JSON.stringify([w, h, next.camera, next.settings, next.focusOffset]);
      if (geometry !== next.geometry) {
        // std140 block: every plane, then its material; unused entries stay zero.
        const block = new Float32Array(MAX_SURFACE_PLANES * 8);
        next.geometry.planes?.forEach((plane, index) => {
          block.set(plane, index * 4);
          block.set(next.geometry.materials[index], (MAX_SURFACE_PLANES + index) * 4);
        });
        gl.bindBuffer(gl.UNIFORM_BUFFER, planeBlock);
        gl.bufferData(gl.UNIFORM_BUFFER, block, gl.STATIC_DRAW);
      }
      if (geometry !== next.geometry || key !== nextKey) {
        samples = 0; write = 0; geometry = next.geometry; key = nextKey;
      }
      options = next;
      chained = false;
      if (samples >= SURFACE_TARGET_SAMPLES) return false;
      if (w !== width || h !== height) {
        width = w; height = h;
        [...accumulated, guide].forEach(value => allocate(value, gl.RGBA32F, w, h));
        filtered.forEach(value => allocate(value, gl.RGBA16F, w, h));
        traceTargets.forEach((framebuffer, index) => attach(framebuffer, accumulated[index], guide));
        filterTargets.forEach((framebuffer, index) => attach(framebuffer, filtered[index]));
      }
      // Motion shows one sample per frame; settled views use the measured batch.
      pending = next.interactive ? 1 : Math.min(batch, SURFACE_TARGET_SAMPLES - samples);
      gl.bindFramebuffer(gl.FRAMEBUFFER, traceTargets[write]);
      // The guide only changes with the view: later batches leave it in place.
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, samples === 0 ? gl.COLOR_ATTACHMENT1 : gl.NONE]);
      bindTexture(4, accumulated[1 - write]);
      gl.uniform1i(uniform(trace, 'uPrevious'), 4);
      gl.uniform1i(uniform(trace, 'uAccumulatedSamples'), samples);
      gl.uniform1i(uniform(trace, 'uBatchSamples'), pending);
      gl.uniform1i(uniform(trace, 'uConvex'), next.geometry.framing === 'convex' ? 1 : 0);
      gl.uniform1i(uniform(trace, 'uPlaneMode'), next.geometry.mesh ? 0 : 1);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, planeBlock);
      return true;
    },
    end() {
      samples += pending;
      gl.useProgram(filter);
      bindTexture(5, guide);
      gl.uniform1i(uniform(filter, 'uGuide'), 5);
      gl.uniform1f(uniform(filter, 'uSamples'), samples);
      let source = accumulated[write];
      [4, 2, 1].forEach((step, pass) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, filterTargets[pass % 2]);
        bindTexture(6, source);
        gl.uniform1i(uniform(filter, 'uSource'), 6);
        gl.uniform1i(uniform(filter, 'uStep'), step);
        gl.uniform1i(uniform(filter, 'uFirst'), pass === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        source = filtered[pass % 2];
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(display);
      bindTexture(6, source);
      gl.uniform1i(uniform(display, 'uImage'), 6);
      gl.uniform1f(uniform(display, 'uExposure'), options.settings.view.exposure);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      write = 1 - write;
      canvas.dataset.samples = String(samples);
      chained = !options.interactive && samples < SURFACE_TARGET_SAMPLES;
      return chained;
    },
    /** Grow while a batch completes within one frame; shrink proportionally when it does not. */
    completed(ms) {
      if (!chained) return;
      chained = false;
      if (ms <= FRAME_MS) batch = Math.min(MAX_BATCH_SAMPLES, batch + Math.max(1, batch >> 2));
      else if (ms > FRAME_MS * 1.8) batch = Math.max(1, Math.floor(batch * FRAME_MS / ms));
    },
    destroy() {
      [...accumulated, ...filtered, guide].forEach(value => gl.deleteTexture(value));
      [...traceTargets, ...filterTargets].forEach(value => gl.deleteFramebuffer(value));
      gl.deleteBuffer(planeBlock);
      gl.deleteProgram(filter);
      gl.deleteProgram(display);
      geometry = options = null;
    },
  };
}

export function createSurfaceOpticsRenderer(canvas, onError) {
  return createWebglOpticsRenderer(canvas, onError, {
    fragmentShader: surfaceFragmentShader,
    createAccumulation: createSurfaceAccumulation,
  });
}
