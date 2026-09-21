import { t } from '../i18n/locale.js';
import { useEffect, useMemo, useRef, useState } from "react";
import { IconCube, IconHandMove, IconRotate3d, IconZoomIn } from "@tabler/icons-react";
import { resolveOpticsSettings } from "../domain/optics.js";
import { normalizedOpticsPlanes, normalizedOpticsMesh } from "../domain/opticsGeometry.js";
import { clamp } from "../utils/format.js";
import { createOpticsRendererLifecycle } from "./opticsRendererLifecycle.js";
import { createWebglOpticsRenderer } from "./opticsWebglRenderer.js";
import { createAsyncOpticsRenderer } from "./opticsAsyncRenderer.js";
import { opticsOrbitAfterInput } from "./viewportOrbit.js";
import "./OpticsViewport.css";

function cameraOrbitForView(viewMode) {
  if (viewMode === "top") return { yaw: 0, elevation: Math.PI / 2 };
  if (viewMode === "bottom") return { yaw: 0, elevation: -Math.PI / 2 };
  if (viewMode === "front") return { yaw: 0, elevation: 0 };
  if (viewMode === "side") return { yaw: Math.PI / 2, elevation: 0 };
  return null;
}


export function OpticsViewport({ polyhedron, settings, viewMode = "perspective", onViewModeChange, inspectorOpen = true }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [error, setError] = useState("");
  // Backend choice is session-only. A fresh canvas is required after WebGPU:
  // a canvas cannot switch context types once it has acquired one.
  const [backend, setBackend] = useState(() =>
    new URLSearchParams(window.location.search).get("opticsBackend") === "webgl2" ? "webgl2" : "webgpu");
  const cameraRef = useRef({ yaw: -0.62, elevation: 0.42, ...cameraOrbitForView(viewMode), zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef(null);
  const transitionRef = useRef(0);
  const previousViewRef = useRef(viewMode);
  const perspectiveRef = useRef({ yaw: -0.62, elevation: 0.42 });
  const resolvedSettings = useMemo(() => resolveOpticsSettings(settings), [settings]);
  const geometry = useMemo(() => {
    if (polyhedron.kind === "mesh") {
      const mesh = normalizedOpticsMesh(polyhedron);
      return { mesh, faceCount: mesh.faceCount };
    }
    return normalizedOpticsPlanes(polyhedron);
  }, [polyhedron]);
  const drawRef = useRef(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onError = (message) => {
      setError(message);
      canvas.dataset.error = message;
    };
    canvas.dataset.backend = backend;
    const renderer = backend === "webgl2"
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
    rendererRef.current = renderer;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      renderer?.destroy();
      rendererRef.current = null;
      dragRef.current = null;
    };
  }, [backend]);

  drawRef.current = () => rendererRef.current?.draw({
    geometry,
    settings: resolvedSettings,
    camera: cameraRef.current,
    focusOffset: inspectorOpen ? 0.23 : 0,
  });

  useEffect(() => {
    drawRef.current();
  }, [backend, geometry, inspectorOpen, resolvedSettings, viewMode]);

  useEffect(() => {
    if (previousViewRef.current === viewMode) return undefined;
    const camera = cameraRef.current;
    if (previousViewRef.current === "perspective") perspectiveRef.current = { yaw: camera.yaw, elevation: camera.elevation };
    previousViewRef.current = viewMode;
    if (dragRef.current) return undefined;
    const target = cameraOrbitForView(viewMode) ?? perspectiveRef.current;
    const start = { yaw: camera.yaw, elevation: camera.elevation };
    const yawDelta = Math.atan2(Math.sin(target.yaw - start.yaw), Math.cos(target.yaw - start.yaw));
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520;
    const started = performance.now();
    const frame = (now) => {
      const t = duration ? Math.min(1, (now - started) / duration) : 1;
      const eased = t * t * (3 - 2 * t);
      camera.yaw = start.yaw + yawDelta * eased;
      camera.elevation = start.elevation + (target.elevation - start.elevation) * eased;
      drawRef.current();
      transitionRef.current = t < 1 ? requestAnimationFrame(frame) : 0;
    };
    transitionRef.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(transitionRef.current); transitionRef.current = 0; };
  }, [viewMode]);

  // Match GemViewport's lock: the wheel listener must be non-passive so the
  // canvas zoom never leaks into page scroll, and touchmove stays inside the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      cameraRef.current.zoom = clamp(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.0012), 0.55, 2.4);
      drawRef.current();
    };
    const onTouchMove = (event) => event.preventDefault();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, [backend]);

  const resetCamera = () => {
    cancelAnimationFrame(transitionRef.current);
    transitionRef.current = 0;
    previousViewRef.current = "perspective";
    cameraRef.current = { yaw: -0.62, elevation: 0.42, zoom: 1, panX: 0, panY: 0 };
    onViewModeChange?.("perspective");
    drawRef.current();
  };

  return (
    <section className="optics-viewport" aria-label={t("宝石光学仿真视口")}>
      <canvas
        key={backend}
        ref={canvasRef}
        className="optics-viewport__canvas"
        data-testid="optics-webgl-canvas"
        tabIndex="0"
        role="application"
        aria-label={t("物理宝石光学仿真。拖拽旋转，Shift 加拖拽平移，滚轮缩放，0 键复位。")}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          if (transitionRef.current) {
            cancelAnimationFrame(transitionRef.current);
            transitionRef.current = 0;
            previousViewRef.current = "perspective";
            onViewModeChange?.("perspective");
          }
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            pan: event.shiftKey,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          drag.x = event.clientX;
          drag.y = event.clientY;
          if (drag.pan) {
            cameraRef.current.panX += dx * 0.002;
            cameraRef.current.panY -= dy * 0.002;
          } else {
            Object.assign(cameraRef.current, opticsOrbitAfterInput(cameraRef.current, dx * 0.008, dy * 0.008));
            previousViewRef.current = "perspective";
            onViewModeChange?.("perspective");
          }
          drawRef.current();
        }}
        onPointerUp={() => {
          dragRef.current = null;
          drawRef.current();
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          drawRef.current();
        }}
        onDoubleClick={resetCamera}
        onKeyDown={(event) => {
          if (event.key === "0") resetCamera();
          if (event.key === "+" || event.key === "=") cameraRef.current.zoom = Math.min(2.4, cameraRef.current.zoom * 1.08);
          if (event.key === "-") cameraRef.current.zoom = Math.max(0.55, cameraRef.current.zoom / 1.08);
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) {
            event.preventDefault();
            cancelAnimationFrame(transitionRef.current);
            transitionRef.current = 0;
            const horizontal = event.key === "ArrowLeft" ? -0.08 : event.key === "ArrowRight" ? 0.08 : 0;
            const vertical = event.key === "ArrowUp" ? -0.06 : event.key === "ArrowDown" ? 0.06 : 0;
            Object.assign(cameraRef.current, opticsOrbitAfterInput(cameraRef.current, horizontal, vertical));
            previousViewRef.current = "perspective";
            onViewModeChange?.("perspective");
            drawRef.current();
          }
        }}
      />
      {error ? <p className="optics-viewport__error">{t(error)}</p> : null}
      <div className="optics-orientation" aria-hidden="true">
        <IconCube size={27} stroke={1.25} />
        <span className="axis-x">X</span><span className="axis-y">Y</span><span className="axis-z">Z</span>
      </div>
      <div className="optics-viewport__hints" aria-label={t("仿真视口操作提示")}>
        <span><IconRotate3d size={15} stroke={1.7} />{t("拖拽旋转")}</span>
        <span><IconZoomIn size={15} stroke={1.7} />{t("滚轮缩放")}</span>
        <span><IconHandMove size={15} stroke={1.7} />{t("Shift + 拖拽平移")}</span>
      </div>
      <span className="optics-viewport__geometry-status">{t("视口实体 ·")} {t(geometry.faceCount)} {polyhedron.kind === "mesh" ? t("面片") : t("面")}{(polyhedron.kind === "mesh" ? polyhedron.faces.some((face) => face.region === "rough" || face.sourceOperationId === "rough-mesh") : polyhedron.faces.some((face) => face.sourceOperationId === "rough-cube")) ? t("（含毛坯面）") : t("（全部为刻面）")}</span>
    </section>
  );
}
