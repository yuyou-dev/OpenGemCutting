import { createProgressiveOpticsRenderer, POLISHED_STAGES, SAMPLING_STAGES } from './opticsProgressiveRenderer.js';
import { t } from '../i18n/locale.js';
import { useEffect, useMemo, useRef, useState } from "react";
import { IconCube, IconHandMove, IconRotate3d, IconZoomIn } from "@tabler/icons-react";
import { opticsSurfaceMaterials, normalizedSurfaceOptics } from "../domain/opticsSurface.js";
import { resolveOpticsSettings } from "../domain/optics.js";
import { normalizedOpticsPlanes, normalizedOpticsMesh } from "../domain/opticsGeometry.js";

import { createOpticsRendererLifecycle } from "./opticsRendererLifecycle.js";
import { createWebglOpticsRenderer } from "./opticsWebglRenderer.js";
import { createAsyncOpticsRenderer } from "./opticsAsyncRenderer.js";
import { opticsCameraFromViewport } from "./viewportOrbit.js";
import { createViewportCamera, dragViewport, zoomViewport, keyViewport, resetViewport, advanceViewportCamera } from "./viewportNavigation.js";
import { startCameraTransition } from "./viewportFrames.js";
import "./OpticsViewport.css";

function cameraOrbitForView(viewMode) {
  if (viewMode === "top") return { yaw: 0, pitch: -Math.PI / 2 };
  if (viewMode === "bottom") return { yaw: 0, pitch: Math.PI / 2 };
  if (viewMode === "front") return { yaw: 0, pitch: 0 };
  if (viewMode === "side") return { yaw: -Math.PI / 2, pitch: 0 };
  return null;
}

// The shared navigation eases toward its target for many frames after input.
// Once the remaining motion is below half a pixel, draw the resting camera:
// a sampling image may then accumulate instead of restarting every frame.
function restingCamera(camera) {
  if (camera.transition) return null;
  const settled = Math.abs(camera.targetYaw - camera.yaw) < 1e-3 && Math.abs(camera.targetPitch - camera.pitch) < 1e-3
    && Math.abs(camera.targetZoom - camera.zoom) < 1e-3 * camera.zoom
    && Math.abs(camera.targetPanX - camera.panX) < .5 && Math.abs(camera.targetPanY - camera.panY) < .5;
  return settled ? { ...camera, yaw: camera.targetYaw, pitch: camera.targetPitch, zoom: camera.targetZoom,
    panX: camera.targetPanX, panY: camera.targetPanY } : null;
}

export function OpticsViewport({ polyhedron, facets = [], settings, viewMode = "perspective", onViewModeChange, inspectorOpen = true }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [error, setError] = useState("");
  // Backend choice is session-only. A fresh canvas is required after WebGPU:
  // a canvas cannot switch context types once it has acquired one.
  const [backend, setBackend] = useState(() =>
    new URLSearchParams(window.location.search).get("opticsBackend") === "webgl2" ? "webgl2" : "webgpu");
  const [surfaceMode, setSurfaceMode] = useState("polished");
  const surface = useMemo(() => {
    try { return opticsSurfaceMaterials(polyhedron, facets); }
    catch (issue) { return { frostedCount: 0, error: issue.message }; }
  }, [polyhedron, facets]);
  const rendererKind = surfaceMode === "design" && surface.frostedCount > 0 ? "surface" : backend;
  const cameraRef = useRef(createViewportCamera({ yaw: 0.62, pitch: -0.42, ...cameraOrbitForView(viewMode), panY: 0 }));
  const dragRef = useRef(null);
  const transitionRef = useRef(0);
  const previousViewRef = useRef(viewMode);
  const perspectiveRef = useRef({ yaw: 0.62, pitch: -0.42 });
  const resolvedSettings = useMemo(() => resolveOpticsSettings(settings), [settings]);
  const geometry = useMemo(() => {
    if (rendererKind === "surface") return normalizedSurfaceOptics(polyhedron, surface.materials);
    if (polyhedron.kind === "mesh") {
      const mesh = normalizedOpticsMesh(polyhedron);
      return { mesh, faceCount: mesh.faceCount };
    }
    return normalizedOpticsPlanes(polyhedron);
  }, [polyhedron, rendererKind, surface]);
  const drawRef = useRef(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let disposed = false;
    const onError = (message) => {
      if (disposed) return;
      setError(message);
      canvas.dataset.error = message;
    };
    setError("");
    canvas.dataset.backend = rendererKind === "surface" ? "webgl2-surface" : backend;
    const backendRenderer = rendererKind === "surface"
      ? createAsyncOpticsRenderer({
        createRenderer: async () => {
          const { createSurfaceOpticsRenderer } = await import("./opticsSurfaceRenderer.js");
          if (disposed) return null;
          return createOpticsRendererLifecycle(canvas, {
            createRenderer: createSurfaceOpticsRenderer, onError,
            onRestore: () => drawRef.current(),
          });
        },
        onFallback: () => onError("磨砂预览暂不可用，请切回全抛光。"),
      })
      : backend === "webgl2"
      ? createOpticsRendererLifecycle(canvas, {
        createRenderer: createWebglOpticsRenderer,
        onError,
        onRestore: () => drawRef.current(),
      })
      : createAsyncOpticsRenderer({
        createRenderer: async (onFailure) => {
          const { createWebgpuOpticsRenderer } = await import("./opticsWebgpuRenderer.js");
          return createWebgpuOpticsRenderer(canvas, onFailure);
        },
        onFallback: () => { setError(""); setBackend("webgl2"); },
      });
    const renderer = createProgressiveOpticsRenderer(backendRenderer,
      { stages: rendererKind === "surface" ? SAMPLING_STAGES : POLISHED_STAGES });
    rendererRef.current = renderer;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => {
      disposed = true;
      observer.disconnect();
      renderer?.destroy();
      rendererRef.current = null;
      dragRef.current = null;
      cancelAnimationFrame(transitionRef.current);
      transitionRef.current = 0;
    };
  }, [rendererKind]);

  drawRef.current = (interactive = Boolean(dragRef.current || transitionRef.current)) => {
    if (surfaceMode === "design" && surface.error) return;
    const resting = !dragRef.current && restingCamera(cameraRef.current);
    rendererRef.current?.draw({
      interactive: interactive && !resting,
      geometry,
      settings: resolvedSettings,
      camera: opticsCameraFromViewport(resting || cameraRef.current, canvasRef.current?.clientHeight ?? 1),
      focusOffset: inspectorOpen ? 0.23 : 0,
    });
  };

  useEffect(() => {
    drawRef.current();
  }, [rendererKind, geometry, inspectorOpen, resolvedSettings, viewMode]);

  const animate = () => {
    if (transitionRef.current) return;
    const frame = now => {
      const moving = advanceViewportCamera(cameraRef.current, now);
      transitionRef.current = moving ? requestAnimationFrame(frame) : 0;
      drawRef.current(Boolean(moving || dragRef.current));
    };
    transitionRef.current = requestAnimationFrame(frame);
  };
  const usePerspective = () => {
    previousViewRef.current = "perspective";
    onViewModeChange?.("perspective");
  };
  useEffect(() => {
    if (previousViewRef.current === viewMode) return;
    const camera = cameraRef.current;
    if (previousViewRef.current === "perspective") perspectiveRef.current = { yaw: camera.yaw, pitch: camera.pitch };
    previousViewRef.current = viewMode;
    if (dragRef.current) return;
    const target = cameraOrbitForView(viewMode) ?? perspectiveRef.current;
    const yaw = camera.yaw + Math.atan2(Math.sin(target.yaw - camera.yaw), Math.cos(target.yaw - camera.yaw));
    startCameraTransition(camera, { ...target, yaw }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520, performance.now());
    animate();
  }, [viewMode]);

  // Match GemViewport's lock: the wheel listener must be non-passive so the
  // canvas zoom never leaks into page scroll, and touchmove stays inside the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      zoomViewport(cameraRef.current, event.deltaY);
      animate();
    };
    const onTouchMove = (event) => event.preventDefault();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, [rendererKind]);

  const resetCamera = () => {
    resetViewport(cameraRef.current, { yaw: .62, pitch: -.42, panY: 0 });
    usePerspective();
    drawRef.current();
  };
  const endPointer = event => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    drawRef.current();
  };

  return (
    <section className="optics-viewport" aria-label={t("宝石光学仿真视口")}>
      <canvas
        key={rendererKind}
        ref={canvasRef}
        className="optics-viewport__canvas"
        style={surfaceMode === "design" && surface.error ? { visibility: "hidden" } : undefined}
        data-testid="optics-webgl-canvas"
        data-surface-mode={surfaceMode}
        tabIndex="0"
        role="application"
        aria-label={t("物理宝石光学仿真。拖拽旋转，Shift 加拖拽平移，滚轮缩放，0 键复位。")}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          cameraRef.current.transition = null;
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          dragViewport(cameraRef.current, event.clientX - drag.x, event.clientY - drag.y, event.shiftKey);
          drag.x = event.clientX; drag.y = event.clientY;
          if (!event.shiftKey) usePerspective();
          animate();
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={() => { dragRef.current = null; drawRef.current(); }}
        onDoubleClick={resetCamera}
        onKeyDown={(event) => {
          if (event.key === '0' || event.key === 'Home') { event.preventDefault(); resetCamera(); return; }
          if (keyViewport(cameraRef.current, event.key, event.shiftKey)) {
            event.preventDefault();
            if (event.key.startsWith('Arrow') && !event.shiftKey) usePerspective();
            animate();
          }
        }}
      />
      <div className="optics-surface-control">
        <div className="optics-view-switch optics-surface-tabs" role="tablist" aria-label={t("表面仿真模式")}>
          {[["polished", "全抛光"], ["design", "按设计表面"]].map(([mode, label]) => (
            <button key={mode} type="button" role="tab" className={surfaceMode === mode ? "is-active" : ""} aria-selected={surfaceMode === mode}
              tabIndex={surfaceMode === mode ? 0 : -1}
              onClick={() => setSurfaceMode(mode)}
              onKeyDown={event => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const next = event.key === "Home" ? "polished" : event.key === "End" ? "design" : surfaceMode === "polished" ? "design" : "polished";
                  setSurfaceMode(next);
                  event.currentTarget.parentElement.children[next === "polished" ? 0 : 1].focus();
                }
              }}>{t(label)}</button>
          ))}
        </div>
        {surfaceMode === "design" && !surface.error && <p role="status">{t(surface.frostedCount
          ? "按已保存标注模拟磨砂；仅影响预览。"
          : "当前设计未标注磨砂面，与全抛光相同。")}</p>}
      </div>
      {(surfaceMode === "design" && surface.error) || error ? <p role="alert" className="optics-viewport__error">{t(surfaceMode === "design" && surface.error || error)}</p> : null}
      <div className="optics-orientation" aria-hidden="true">
        <IconCube size={27} stroke={1.25} />
        <span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span>
      </div>
      <div className="optics-viewport__hints" aria-label={t("仿真视口操作提示")}>
        <span><IconRotate3d size={15} stroke={1.7} />{t("拖拽旋转")}</span>
        <span><IconZoomIn size={15} stroke={1.7} />{t("滚轮缩放")}</span>
        <span><IconHandMove size={15} stroke={1.7} />{t("Shift + 拖拽平移")}</span>
      </div>
      <span className="optics-viewport__geometry-status">{t("视口实体 ·")} {geometry.faceCount} {polyhedron.kind === "mesh" ? t("面片") : t("面")}{(polyhedron.kind === "mesh" ? polyhedron.faces.some((face) => face.region === "rough" || face.sourceOperationId === "rough-mesh") : polyhedron.faces.some((face) => face.sourceOperationId === "rough-cube")) ? t("（含毛坯面）") : t("（全部为刻面）")}</span>
    </section>
  );
}
