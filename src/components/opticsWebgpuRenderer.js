import { init, draw, frame, surface, storage } from 'vgpu';
import shader from './opticsShader.wgsl?raw';
import { backgroundColor } from '../domain/optics.js';
import { packOpticsPlaneTexture, packOpticsMeshTextures, opticsMeshFraming } from '../domain/opticsGeometry.js';
import { normalizeVector } from '../utils/vector3.js';
import { opticsCameraFrame } from './viewportOrbit.js';
import { createWebgpuOpticsScheduler } from './opticsWebgpuScheduler.js';

const hexToRgb = hex => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};
const environmentIndex = id => id === 'jewelry' ? 1 : id === 'contrast' ? 2 : id === 'hearts' ? 3 : 0;

/** Same framing, material units, one-sample quality and 1100px cap as WebGL2.
 * Only the execution backend and geometry transport change. */
export async function createWebgpuOpticsRenderer(canvas, onFailure) {
  const gpu = await init({ powerPreference: 'high-performance' });
  let disposed = false, failed = false, target, drawable, buffers = [], uploadedGeometry = null, scheduler;
  const fail = () => {
    if (disposed || failed) return;
    failed = true;
    onFailure();
  };
  const removeError = gpu.onError(fail);
  gpu.gpu.addEventListener('uncapturederror', fail);
  gpu.gpu.lost.then(() => { if (!disposed) fail(); });
  function destroy() {
    if (disposed) return;
    disposed = true;
    scheduler?.destroy();
    removeError();
    gpu.gpu.removeEventListener('uncapturederror', fail);
    gpu.dispose();
  }
  function uniforms(geometry, settings, camera, focusOffset, width, height) {
    const cameraFrame = opticsCameraFrame(camera);
    let meshFraming;
    if (geometry.mesh) {
      const inspector = focusOffset ? canvas.parentElement?.parentElement?.querySelector('.optics-inspector') : null;
      const covered = inspector ? Math.max(0, canvas.getBoundingClientRect().right - inspector.getBoundingClientRect().left + 24) : 0;
      meshFraming = opticsMeshFraming(geometry.mesh, { width: canvas.clientWidth, height: canvas.clientHeight, occludedRight: covered });
    }
    return {
      res: [width, height, geometry.mesh?.nodes.length ?? 0, geometry.mesh ? 1 : 0],
      position: [...cameraFrame.position, 0], forward: [...cameraFrame.forward, 0],
      right: [...cameraFrame.right, 0], up: [...cameraFrame.up, 0],
      body: [...hexToRgb(settings.material.bodyColor), 0],
      optics: [settings.material.ior, settings.material.dispersion, settings.material.absorption, 0],
      view: [(meshFraming?.cameraScale ?? 0.34) / camera.zoom, settings.view.exposure, settings.view.environmentRotation, environmentIndex(settings.view.environment)],
      observer: [...normalizeVector(cameraFrame.position), settings.advanced.maxBounces],
      background: [...hexToRgb(backgroundColor(settings)), 0],
      framing: [meshFraming?.focusOffset ?? focusOffset, camera.panX, camera.panY, geometry.planes?.length ?? 0],
    };
  }
  try {
    target = surface(gpu, canvas, { autoResize: false, size: [2, 2], format: 'rgba8unorm', alphaMode: 'opaque' });
    scheduler = createWebgpuOpticsScheduler({
      onError: fail,
      async render({ geometry, settings, camera, focusOffset = 0 }) {
        if (disposed || failed) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5, 1100 / Math.max(canvas.clientWidth, canvas.clientHeight));
        const width = Math.max(2, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(2, Math.round(canvas.clientHeight * ratio));
        if (target.size[0] !== width || target.size[1] !== height) target.resize([width, height]);
        const p = uniforms(geometry, settings, camera, focusOffset, width, height);
        if (geometry !== uploadedGeometry) {
          // Reuse the canonical float32 packing: threaded BVH escape indices and
          // all triangles/planes remain identical. Padding is harmless in storage.
          const packed = geometry.mesh
            ? packOpticsMeshTextures(geometry.mesh, 4096)
            : { planes: packOpticsPlaneTexture(geometry.planes, 4096) };
          const data = [packed.nodes, packed.triangles, packed.planes].map(value => value?.data ?? new Float32Array(4));
          if (data.some(value => value.byteLength > gpu.gpu.limits.maxStorageBufferBindingSize || value.byteLength > gpu.gpu.limits.maxBufferSize)) {
            throw new Error('Optical geometry exceeds WebGPU storage limits.');
          }
          // Previous submission completed before the scheduler starts this draw.
          buffers.forEach(buffer => buffer.destroy());
          buffers = [];
          for (const value of data) {
            const buffer = storage(gpu, value.byteLength, 'read');
            buffers.push(buffer);
            buffer.write(value);
          }
          const bindings = { p, nodes: buffers[0], triangles: buffers[1], planes: buffers[2] };
          if (drawable) drawable.set(bindings);
          else drawable = draw(gpu, { shader, label: 'OpenGemCutting optics', vertices: 3, set: bindings });
        } else drawable.set({ p });
        frame(gpu, encoder => encoder.pass(target, drawable));
        await gpu.gpu.queue.onSubmittedWorkDone();
        await gpu.settled();
        if (disposed || failed) return;
        uploadedGeometry = geometry;
        canvas.dataset.renderStage = 'complete';
      },
    });
    return { draw: scheduler.draw, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
}
