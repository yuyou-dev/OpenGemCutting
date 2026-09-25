import { Device } from '@vgpu/core';
import shader from './opticsShader.wgsl?raw';
import { packOpticsPlaneTexture, packOpticsMeshTextures } from '../domain/opticsGeometry.js';
import { opticsViewFrame } from './opticsViewFrame.js';
import { createWebgpuOpticsScheduler } from './opticsWebgpuScheduler.js';

/** Same framing, material units, one-sample quality and 1100px cap as WebGL2.
 * Only the execution backend and geometry transport change. */
export async function createWebgpuOpticsRenderer(canvas, onFailure) {
  // Use the official browser-capable core, without the vgpu CLI/Node dependencies.
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable.');
  const gpu = new Device(await adapter.requestDevice(), adapter.info);
  let disposed = false, failed = false, context, pipeline, uniformBuffer, bindGroup;
  let buffers = [], uploadedGeometry = null, scheduler;
  const fail = () => {
    if (disposed || failed) return;
    failed = true;
    onFailure();
  };
  gpu.gpu.addEventListener('uncapturederror', fail);
  gpu.gpu.lost.then(() => { if (!disposed) fail(); });
  function destroy() {
    if (disposed) return;
    disposed = true;
    scheduler?.destroy();
    gpu.gpu.removeEventListener('uncapturederror', fail);
    context?.unconfigure();
    buffers.forEach(buffer => buffer.destroy());
    uniformBuffer?.destroy();
    gpu.destroy();
  }
  function uniforms(geometry, settings, camera, view) {
    return {
      res: [view.width, view.height, geometry.mesh?.nodes.length ?? 0, geometry.mesh ? 1 : 0],
      position: [...view.frame.position, 0], forward: [...view.frame.forward, 0],
      right: [...view.frame.right, 0], up: [...view.frame.up, 0],
      body: [...view.bodyColor, 0],
      optics: [settings.material.ior, settings.material.dispersion, settings.material.absorption, 0],
      view: [view.cameraScale, settings.view.exposure, settings.view.environmentRotation, view.environment],
      observer: [...view.observer, settings.advanced.maxBounces],
      background: [...view.background, 0],
      framing: [view.focusOffset, camera.panX, camera.panY, geometry.planes?.length ?? 0],
    };
  }
  try {
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('WebGPU canvas unavailable.');
    // Explicit vec4 uniform layout matches Params in opticsShader.wgsl (11 × 16 bytes).
    gpu.pushErrorScope('validation');
    const module = gpu.createShader(shader);
    pipeline = await gpu.gpu.createRenderPipelineAsync({
      label: 'OpenGemCutting optics', layout: 'auto',
      vertex: { module: module.gpu, entryPoint: 'vs' },
      fragment: { module: module.gpu, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    uniformBuffer = gpu.createBuffer({ size: 176, usage: ['uniform', 'copy_dst'] });
    context.configure({ device: gpu.gpu, format: 'rgba8unorm', alphaMode: 'opaque' });
    const initError = await gpu.popErrorScope();
    if (initError) throw initError;
    scheduler = createWebgpuOpticsScheduler({
      onError: fail,
      async render(options) {
        if (disposed || failed) return;
        const { geometry, settings, camera } = options;
        const view = opticsViewFrame(canvas, options);
        if (canvas.width !== view.width) canvas.width = view.width;
        if (canvas.height !== view.height) canvas.height = view.height;
        const p = uniforms(geometry, settings, camera, view);
        gpu.gpu.pushErrorScope('validation');
        try {
          uniformBuffer.write(new Float32Array([
            ...p.res, ...p.position, ...p.forward, ...p.right, ...p.up, ...p.body,
            ...p.optics, ...p.view, ...p.observer, ...p.background, ...p.framing,
          ]));
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
              const buffer = gpu.createBuffer({ size: value.byteLength, usage: ['storage', 'copy_dst'] });
              buffers.push(buffer);
              buffer.write(value);
            }
            bindGroup = gpu.gpu.createBindGroup({
              layout: pipeline.getBindGroupLayout(0),
              entries: [uniformBuffer, ...buffers].map((buffer, binding) => ({ binding, resource: { buffer: buffer.gpu } })),
            });
          }
          const encoder = gpu.gpu.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{
            view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store',
            clearValue: { r: 1, g: 1, b: 1, a: 1 },
          }] });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3);
          pass.end();
          gpu.gpu.queue.submit([encoder.finish()]);
          await gpu.queue.flush();
        } finally {
          // Always drain the validation scope, including a failed upload.
          // Use the native device: the wrapper may have been disposed by a lost event.
          const error = await gpu.gpu.popErrorScope();
          if (error) throw error;
        }
        if (disposed || failed) return;
        uploadedGeometry = geometry;
        canvas.dataset.renderStage = view.stage;
      },
    });
    return { draw: scheduler.draw, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
}
