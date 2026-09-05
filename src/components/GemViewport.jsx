import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IconHandMove,
  IconRotate3d,
  IconZoomIn,
} from "@tabler/icons-react";
import { DEGREES_PER_TOOTH, INDEX_TEETH, displayIndex, normalizeIndex as normalizeFacetIndex } from "../domain/faceting.js";
import {
  addVectors as add,
  averageVectors as average,
  crossVectors as cross,
  normalizeVector,
  scaleVector as multiply,
  subtractVectors as subtract,
  vectorLength as length,
} from "../utils/vector3.js";
import "./GemViewport.css";

const VIEW_POSES = {
  perspective: { yaw: -0.72, pitch: -0.52 },
  // rotateX(-90°) brings the crown (+z domain) to the camera side: 顶视 = 俯视冠部.
  top: { yaw: 0, pitch: -Math.PI / 2 },
  front: { yaw: 0, pitch: 0 },
  side: { yaw: Math.PI / 2, pitch: 0 },
};

const FALLBACK_POLYHEDRON = {
  vertices: [
    [-0.5, -0.5, -0.5],
    [0.5, -0.5, -0.5],
    [0.5, 0.5, -0.5],
    [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5],
    [0.5, -0.5, 0.5],
    [0.5, 0.5, 0.5],
    [-0.5, 0.5, 0.5],
  ],
  faces: [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ],
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function toPoint(value) {
  if (Array.isArray(value)) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }

  if (value?.position) return toPoint(value.position);

  return [Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0];
}

function normalize(vector) {
  return normalizeVector(vector, { epsilon: 1e-8, fallback: [0, 0, 1] });
}

function computeBounds(vertices) {
  if (vertices.length === 0) {
    return {
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
      center: [0, 0, 0],
      span: [1, 1, 1],
      radius: Math.sqrt(3) * 0.5,
    };
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  vertices.forEach((point) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  });

  const center = multiply(add(min, max), 0.5);
  const span = subtract(max, min).map((value) => Math.max(value, 1e-4));
  const radius = Math.max(
    ...vertices.map((point) => length(subtract(point, center))),
    length(span) * 0.5,
    0.5,
  );

  return { min, max, center, span, radius };
}

function normalizeGeometry(polyhedron) {
  const source = Array.isArray(polyhedron?.vertices) && Array.isArray(polyhedron?.faces)
    ? polyhedron
    : FALLBACK_POLYHEDRON;
  const vertices = source.vertices.map(toPoint);
  const faces = source.faces
    .map((face, faceIndex) => {
      const raw = Array.isArray(face)
        ? face
        : face?.indices ?? face?.vertexIndices ?? face?.vertices ?? face?.points ?? [];
      const points = raw.map((item) => (
        Number.isInteger(item) ? vertices[item] : toPoint(item)
      )).filter(Boolean);

      if (points.length < 3) return null;

      const normal = normalize(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
      return {
        id: face?.id ?? faceIndex,
        operationId: Array.isArray(face) ? null : face?.sourceOperationId ?? null,
        points,
        center: average(points),
        normal,
      };
    })
    .filter(Boolean);

  return {
    vertices,
    faces,
    bounds: computeBounds(vertices),
  };
}

function normalizeIndex(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return normalizeFacetIndex(Math.round(numeric));
}

function isSelectedPlane(plane, selectedIndex) {
  if (plane?.primary) return true;
  const planeIndex = normalizeIndex(plane?.index);
  const activeIndex = normalizeIndex(selectedIndex);
  return planeIndex !== null && activeIndex !== null && planeIndex === activeIndex;
}

function copyBounds(bounds) {
  return {
    min: [...bounds.min],
    max: [...bounds.max],
    center: [...bounds.center],
    span: [...bounds.span],
    radius: bounds.radius,
  };
}

function createCamera() {
  const pose = VIEW_POSES.perspective;
  return {
    yaw: pose.yaw,
    pitch: pose.pitch,
    targetYaw: pose.yaw,
    targetPitch: pose.pitch,
    zoom: 1,
    targetZoom: 1,
    panX: 0,
    panY: 8,
    targetPanX: 0,
    targetPanY: 8,
    suppressNextPose: false,
  };
}

function setCameraPose(camera, mode, immediate = false) {
  const pose = VIEW_POSES[mode] ?? VIEW_POSES.perspective;
  camera.targetYaw = pose.yaw;
  camera.targetPitch = pose.pitch;

  if (immediate) {
    camera.yaw = pose.yaw;
    camera.pitch = pose.pitch;
  }
}

function resetCamera(camera, mode) {
  setCameraPose(camera, mode, true);
  camera.zoom = 1;
  camera.targetZoom = 1;
  camera.panX = 0;
  camera.panY = 8;
  camera.targetPanX = 0;
  camera.targetPanY = 8;
}

function transformPoint(point, sceneScale) {
  return [point[0] * sceneScale, -point[2] * sceneScale, point[1] * sceneScale];
}

function p5Vertex(p, point, sceneScale) {
  const transformed = transformPoint(point, sceneScale);
  p.vertex(transformed[0], transformed[1], transformed[2]);
}

function p5Line(p, start, end, sceneScale) {
  const a = transformPoint(start, sceneScale);
  const b = transformPoint(end, sceneScale);
  p.line(a[0], a[1], a[2], b[0], b[1], b[2]);
}

function drawDashedLine(p, start, end, sceneScale, dashCount = 13) {
  const delta = subtract(end, start);
  for (let part = 0; part < dashCount; part += 2) {
    const from = add(start, multiply(delta, part / dashCount));
    const to = add(start, multiply(delta, Math.min((part + 1) / dashCount, 1)));
    p5Line(p, from, to, sceneScale);
  }
}

function expandedBounds(bounds, amount = 1.14) {
  const halfSpan = multiply(bounds.span, amount * 0.5);
  return {
    min: subtract(bounds.center, halfSpan),
    max: add(bounds.center, halfSpan),
  };
}

function drawGhostCube(p, bounds, sceneScale, lineWeight) {
  const ghost = expandedBounds(bounds);
  const [minX, minY, minZ] = ghost.min;
  const [maxX, maxY, maxZ] = ghost.max;
  const corners = [
    [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  p.noFill();
  p.stroke(92, 124, 151, 78);
  p.strokeWeight(lineWeight * 0.85);
  edges.forEach(([start, end]) => drawDashedLine(p, corners[start], corners[end], sceneScale, 17));
}

function planePatch(plane, patchRadius) {
  const descriptor = plane?.plane ?? plane;
  const rawNormal = toPoint(descriptor?.normal ?? descriptor?.n);
  const normalMagnitude = Math.max(length(rawNormal), 1e-8);
  const normalValue = normalize(rawNormal);
  const rawDistance = descriptor?.d ?? descriptor?.offset ?? descriptor?.constant;
  const d = Number.isFinite(Number(rawDistance)) ? Number(rawDistance) : 0;
  // Float the patch a hair above the exact plane to avoid z-fighting with
  // committed faces that sit on the same plane.
  const center = add(
    multiply(rawNormal, d / (normalMagnitude * normalMagnitude)),
    multiply(normalValue, 0.004),
  );
  const helper = Math.abs(normalValue[2]) < 0.82 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(normalValue, helper));
  const v = normalize(cross(normalValue, u));

  return {
    center,
    normal: normalValue,
    corners: [
      add(add(center, multiply(u, -patchRadius)), multiply(v, -patchRadius)),
      add(add(center, multiply(u, patchRadius)), multiply(v, -patchRadius)),
      add(add(center, multiply(u, patchRadius)), multiply(v, patchRadius)),
      add(add(center, multiply(u, -patchRadius)), multiply(v, patchRadius)),
    ],
  };
}

function drawPreviewPlanes(p, planes, selectedIndex, bounds, sceneScale, lineWeight, renderMode) {
  const patchRadius = Math.max(bounds.radius * 0.56, 0.5);
  const visiblePlanes = renderMode === "xray"
    ? planes
    : planes.filter((plane) => isSelectedPlane(plane, selectedIndex));
  const orderedPlanes = [...visiblePlanes].sort((a, b) => (
    Number(isSelectedPlane(a, selectedIndex)) - Number(isSelectedPlane(b, selectedIndex))
  ));

  orderedPlanes.forEach((plane) => {
    const primary = isSelectedPlane(plane, selectedIndex);
    const patch = planePatch(plane, patchRadius);
    const color = primary ? [241, 0, 82] : [54, 116, 231];

    if (primary) {
      const gl = p.drawingContext;
      gl.depthMask(false);
      p.noStroke();
      p.fill(color[0], color[1], color[2], 22);
      p.beginShape(p.TRIANGLE_FAN);
      patch.corners.forEach((point) => p5Vertex(p, point, sceneScale));
      p.endShape(p.CLOSE);
      gl.depthMask(true);
    }

    p.noFill();
    p.stroke(color[0], color[1], color[2], primary ? 226 : 72);
    p.strokeWeight(lineWeight * (primary ? 1.55 : 0.9));
    patch.corners.forEach((point, index) => {
      const next = patch.corners[(index + 1) % patch.corners.length];
      if (primary) p5Line(p, point, next, sceneScale);
      else drawDashedLine(p, point, next, sceneScale, 19);
    });

    if (primary) {
      const normalEnd = add(patch.center, multiply(patch.normal, patchRadius * 0.34));
      p.stroke(color[0], color[1], color[2], 210);
      p.strokeWeight(lineWeight * 1.25);
      p5Line(p, patch.center, normalEnd, sceneScale);

      const marker = transformPoint(patch.center, sceneScale);
      p.push();
      p.translate(marker[0], marker[1], marker[2]);
      p.noStroke();
      p.fill(color[0], color[1], color[2], 235);
      p.sphere(3.2 * lineWeight, 8, 5);
      p.pop();
    }
  });
}

function groupControlWorld(gizmo, controlKind = gizmo?.kind) {
  if (!gizmo) return null;
  const [centerX, centerY] = gizmo.center ?? [0, 0];
  const radius = gizmo.radius;
  const direction = gizmo.region === "crown" ? 1 : -1;
  // Keep helper surfaces slightly outside the transformed stone. Their logical
  // values remain exact, but the visual offset prevents coplanar z-fighting at
  // the girdle boundary and table.
  const surfaceOffset = direction * Math.max(radius * 0.004, 0.004);
  const cornersAt = (z) => [
    [centerX - radius, centerY - radius, z],
    [centerX + radius, centerY - radius, z],
    [centerX + radius, centerY + radius, z],
    [centerX - radius, centerY + radius, z],
  ];
  if (controlKind === "translate") {
    const handleX = centerX - radius * 0.86;
    const displayZ = gizmo.shiftZ + surfaceOffset;
    return {
      kind: controlKind,
      center: [centerX, centerY, displayZ],
      axisStart: [handleX, centerY, gizmo.baseZ],
      handle: [handleX, centerY, displayZ],
      corners: cornersAt(displayZ),
      baseCorners: cornersAt(gizmo.baseZ),
    };
  }
  const displayZ = gizmo.scaleZ + surfaceOffset;
  return {
    kind: "scale",
    center: [centerX, centerY, displayZ],
    axisStart: [centerX, centerY, gizmo.shiftZ],
    handle: [centerX, centerY, displayZ + direction * Math.min(gizmo.axisLength * 0.1, 0.05)],
    corners: cornersAt(displayZ),
    baseCorners: null,
  };
}

function drawGroupControlPlane(p, gizmo, sceneScale, lineWeight) {
  if (!gizmo) return;
  const controls = [groupControlWorld(gizmo, "translate"), groupControlWorld(gizmo, "scale")];
  const gl = p.drawingContext;
  gl.depthMask(false);
  const baseCorners = controls.find((control) => control?.baseCorners)?.baseCorners;
  if (baseCorners) {
    p.noStroke();
    p.fill(74, 74, 70, 12);
    p.beginShape(p.TRIANGLE_FAN);
    baseCorners.forEach((point) => p5Vertex(p, point, sceneScale));
    p.endShape(p.CLOSE);
    p.noFill();
    p.stroke(100, 100, 96, 128);
    p.strokeWeight(lineWeight);
    baseCorners.forEach((point, index) => drawDashedLine(p, point, baseCorners[(index + 1) % baseCorners.length], sceneScale, 18));
  }
  controls.forEach((control) => {
    if (!control) return;
    const color = control.kind === "scale" ? [22, 140, 131] : [125, 91, 184];
    p.noStroke();
    p.fill(color[0], color[1], color[2], control.kind === "scale" ? 18 : 12);
    p.beginShape(p.TRIANGLE_FAN);
    control.corners.forEach((point) => p5Vertex(p, point, sceneScale));
    p.endShape(p.CLOSE);
    p.noFill();
    p.stroke(color[0], color[1], color[2], control.kind === "scale" ? 220 : 190);
    p.strokeWeight(lineWeight * (control.kind === "scale" ? 1.6 : 1.25));
    control.corners.forEach((point, index) => p5Line(p, point, control.corners[(index + 1) % control.corners.length], sceneScale));
  });
  gl.depthMask(true);
}

function faceColor(face, bounds, renderMode, highlightOperationId, activeOperationId, previewOperationId) {
  const height = Math.max(bounds.span[2], 1e-5);
  const position = (face.center[2] - bounds.min[2]) / height;
  const facing = Math.abs(face.normal[2]);

  const alpha = renderMode === "xray" ? 112 : 245;

  if (activeOperationId && face.operationId === activeOperationId) {
    return [249 + facing * 3, 168 + facing * 16, 198 + facing * 12, renderMode === "xray" ? 155 : 246];
  }

  if (previewOperationId && face.operationId === previewOperationId) {
    return [148 + facing * 12, 203 + facing * 12, 240 + facing * 8, renderMode === "xray" ? 150 : 246];
  }

  if (highlightOperationId && face.operationId === highlightOperationId) {
    return [237 + facing * 8, 34 + facing * 12, 93 + facing * 20, renderMode === "xray" ? 150 : 246];
  }

  if (position < 0.42) {
    return [223 + facing * 12, 205 + facing * 13, 108 + facing * 22, alpha];
  }

  if (position > 0.59) {
    return [238 + facing * 11, 225 + facing * 10, 230 + facing * 12, alpha];
  }

  return [211 + facing * 18, 218 + facing * 16, 220 + facing * 17, alpha];
}

function edgeKey(a, b) {
  const pointKey = (point) => point.map((value) => value.toFixed(6)).join(",");
  return [pointKey(a), pointKey(b)].sort().join("|");
}

function viewDepth(point, yaw, pitch) {
  const [x, y, z] = transformPoint(point, 1);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const yawZ = -sinYaw * x + cosYaw * z;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return sinPitch * y + cosPitch * yawZ;
}

/* ---------------------------------------------------------------------------
 * Screen-space picking helpers. The draw loop captures the renderer's live
 * model-view / projection matrices each frame; picking projects domain points
 * through the same matrices, so hover/click always matches what is on screen.
 * ------------------------------------------------------------------------ */

function multiplyMat4Point(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

function projectDomainPoint(point, frame, clipToViewport = true) {
  if (!frame?.mv || !frame?.pr || !frame.width || !frame.height) return null;
  const [tx, ty, tz] = transformPoint(point, frame.scale);
  const [vx, vy, vz] = multiplyMat4Point(frame.mv, tx, ty, tz);
  const [cx, cy, cz, cw] = multiplyMat4Point(frame.pr, vx, vy, vz);
  if (!Number.isFinite(cw) || Math.abs(cw) < 1e-9) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  if (clipToViewport && (ndcX < -1.6 || ndcX > 1.6 || ndcY < -1.6 || ndcY > 1.6)) return null;
  return {
    x: ((ndcX + 1) / 2) * frame.width,
    y: ((1 - ndcY) / 2) * frame.height,
    viewX: vx,
    viewY: vy,
    viewZ: vz,
    ndcZ: cz / cw,
    clipW: cw,
  };
}

function projectedTriangle(point, a, b, c) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-7) return null;
  const wa = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  const wb = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  const wc = 1 - wa - wb;
  if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) return null;
  const inverseW = wa / a.clipW + wb / b.clipW + wc / c.clipW;
  if (Math.abs(inverseW) < 1e-9) return null;
  return {
    ndcZ: wa * a.ndcZ + wb * b.ndcZ + wc * c.ndcZ,
    viewX: (wa * a.viewX / a.clipW + wb * b.viewX / b.clipW + wc * c.viewX / c.clipW) / inverseW,
    viewY: (wa * a.viewY / a.clipW + wb * b.viewY / b.clipW + wc * c.viewY / c.clipW) / inverseW,
    viewZ: (wa * a.viewZ / a.clipW + wb * b.viewZ / b.clipW + wc * c.viewZ / c.clipW) / inverseW,
  };
}

function createSolidOccluder(geometry, frame, renderMode) {
  if (renderMode !== "solid" || !frame || !geometry?.faces?.length) return () => false;
  const triangles = geometry.faces.flatMap((face) => {
    const points = face.points.map((point) => {
      const [x, y, z] = transformPoint(point, frame.scale);
      return multiplyMat4Point(frame.mv, x, y, z).slice(0, 3);
    });
    return points.slice(1, -1).map((point, index) => [points[0], point, points[index + 2]]);
  });

  return (point) => {
    if (!Number.isFinite(point?.viewX) || !Number.isFinite(point?.viewY) || !Number.isFinite(point?.viewZ)) return false;
    const origin = frame.perspective ? [0, 0, 0] : [point.viewX, point.viewY, 0];
    const target = [point.viewX, point.viewY, point.viewZ];
    const direction = frame.perspective ? normalize(target) : [0, 0, -1];
    const pointDistance = frame.perspective ? length(target) : -point.viewZ;

    return triangles.some(([a, b, c]) => {
      const edge1 = subtract(b, a);
      const edge2 = subtract(c, a);
      const h = cross(direction, edge2);
      const determinant = edge1[0] * h[0] + edge1[1] * h[1] + edge1[2] * h[2];
      if (Math.abs(determinant) < 1e-7) return false;
      const inverse = 1 / determinant;
      const s = subtract(origin, a);
      const u = inverse * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
      if (u < 0 || u > 1) return false;
      const q = cross(s, edge1);
      const v = inverse * (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]);
      if (v < 0 || u + v > 1) return false;
      const distance = inverse * (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]);
      return distance > 1e-5 && distance < pointDistance - 1e-4;
    });
  };
}

function createSolidSilhouetteTest(geometry, frame, renderMode) {
  if (renderMode !== "solid" || !frame || !geometry?.faces?.length) return () => false;
  const triangles = geometry.faces.flatMap((face) => {
    const points = face.points.map((point) => projectDomainPoint(point, frame, false));
    if (points.some((point) => !point)) return [];
    return points.slice(1, -1).map((point, index) => [points[0], point, points[index + 2]]);
  });
  return (point) => triangles.some(([a, b, c]) => projectedTriangle(point, a, b, c) !== null);
}

function createHelperOcclusionTest(geometry, frame, renderMode) {
  const isOccluded = createSolidOccluder(geometry, frame, renderMode);
  const isInsideSilhouette = createSolidSilhouetteTest(geometry, frame, renderMode);
  const center = projectDomainPoint(geometry?.bounds?.center, frame, false);
  return (point) => (
    isOccluded(point)
    || Boolean(center && point?.viewZ < center.viewZ && isInsideSilhouette(point))
  );
}

function createSolidInteriorTest(geometry, renderMode) {
  if (renderMode !== "solid" || !geometry?.faces?.length) return () => false;
  const [centerX, centerY] = geometry.bounds.center;
  const radialEnvelope = Math.max(...geometry.vertices.map((point) => (
    Math.hypot(point[0] - centerX, point[1] - centerY)
  )));
  return (point) => (
    point[2] >= geometry.bounds.min[2] - 1e-5
    && point[2] <= geometry.bounds.max[2] + 1e-5
    && Math.hypot(point[0] - centerX, point[1] - centerY) < radialEnvelope - 1e-5
  );
}

function createHelperVisibilityContext(scene) {
  const { geometry, frame, renderMode } = scene;
  const isOccluded = createHelperOcclusionTest(geometry, frame, renderMode);
  const isInsideSolid = createSolidInteriorTest(geometry, renderMode);
  const isInsideSilhouette = createSolidSilhouetteTest(geometry, frame, renderMode);
  return {
    isOccluded,
    isInsideSolid,
    isInsideSilhouette,
    isSurfacePointVisible(point) {
      const projected = projectDomainPoint(point, frame, false);
      return Boolean(projected && !isOccluded(projected));
    },
    isWorldPointVisible(point) {
      const projected = projectDomainPoint(point, frame, false);
      return Boolean(projected && !isInsideSolid(point) && !isOccluded(projected));
    },
  };
}

function overlayDepth(point) {
  return Number.isFinite(point?.ndcZ) ? 400 - point.ndcZ * 1000 : 0;
}

function drawProjectedScreenSegment(p, start, end) {
  p.line(
    start.x - p.width / 2,
    start.y - p.height / 2,
    overlayDepth(start),
    end.x - p.width / 2,
    end.y - p.height / 2,
    overlayDepth(end),
  );
}

function drawClippedWorldSegment(p, start, end, projectPoint, isHidden, isInsideSolid, subdivisions = 24) {
  const delta = subtract(end, start);
  for (let part = 0; part < subdivisions; part += 1) {
    const worldStart = add(start, multiply(delta, part / subdivisions));
    const worldEnd = add(start, multiply(delta, (part + 1) / subdivisions));
    const projectedStart = projectPoint(worldStart);
    const projectedEnd = projectPoint(worldEnd);
    const projectedMidpoint = projectPoint(add(worldStart, multiply(subtract(worldEnd, worldStart), 0.5)));
    if (
      !projectedStart
      || !projectedEnd
      || !projectedMidpoint
      || isInsideSolid(add(worldStart, multiply(subtract(worldEnd, worldStart), 0.5)))
      || isHidden(projectedMidpoint)
    ) continue;
    drawProjectedScreenSegment(p, projectedStart, projectedEnd);
  }
}

function drawProjectedWorldSegment(
  p,
  start,
  end,
  projectPoint,
  isOccluded,
  isInsideSolid,
  isInsideSilhouette,
  subdivisions = 8,
) {
  for (let part = 0; part < subdivisions; part += 1) {
    const worldStart = add(start, multiply(subtract(end, start), part / subdivisions));
    const worldEnd = add(start, multiply(subtract(end, start), (part + 1) / subdivisions));
    const worldMidpoint = add(worldStart, multiply(subtract(worldEnd, worldStart), 0.5));
    const projectedStart = projectPoint(worldStart);
    const projectedEnd = projectPoint(worldEnd);
    const projectedMidpoint = projectPoint(worldMidpoint);
    if (
      !projectedStart
      || !projectedEnd
      || !projectedMidpoint
      || isInsideSolid(worldMidpoint)
      || isOccluded(projectedMidpoint)
      || isInsideSilhouette(projectedMidpoint)
    ) continue;
    drawProjectedScreenSegment(p, projectedStart, projectedEnd);
  }
}

function pointToSegment2D(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return { distance: Math.hypot(x - px, y - py), t };
}

function pointInPolygon2D(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function groupControlScreenInfo(frame, gizmo, controlKind = gizmo?.kind) {
  const world = groupControlWorld(gizmo, controlKind);
  if (!world) return null;
  const center = projectDomainPoint(world.center, frame, false);
  const handle = projectDomainPoint(world.handle, frame, false);
  const zUnit = projectDomainPoint(add(world.center, [0, 0, 1]), frame, false);
  const corners = world.corners.map((point) => projectDomainPoint(point, frame, false));
  if (!center || !handle || !zUnit || corners.some((point) => !point)) return null;
  const zDx = zUnit.x - center.x;
  const zDy = zUnit.y - center.y;
  const pxPerUnit = Math.hypot(zDx, zDy);
  if (pxPerUnit < 2) return null;
  return {
    ...world,
    worldCenter: world.center,
    worldAxisStart: world.axisStart,
    worldHandle: world.handle,
    worldCorners: world.corners,
    center,
    handle,
    corners,
    dirX: zDx / pxPerUnit,
    dirY: zDy / pxPerUnit,
    pxPerUnit,
    delta: gizmo.delta,
    scale: gizmo.scale,
    baseHeight: gizmo.baseHeight,
    kind: world.kind,
    minScale: gizmo.minScale ?? 0.02,
    minDelta: gizmo.minDelta,
    maxDelta: gizmo.maxDelta,
    region: gizmo.region,
  };
}

function groupControlHandleHit(x, y, control, visibility) {
  if (!control) return false;
  const handleVisible = visibility?.isWorldPointVisible(control.worldHandle) ?? true;
  if (handleVisible && Math.hypot(x - control.handle.x, y - control.handle.y) <= 18) return true;
  return handleVisible && pointToSegment2D(x, y, control.center.x, control.center.y, control.handle.x, control.handle.y).distance <= 11;
}

function groupControlPlaneHit(x, y, control, visibility) {
  if (!control) return false;
  const screenPoint = { x, y };
  const planePoint = projectedTriangle(screenPoint, control.corners[0], control.corners[1], control.corners[2])
    ?? projectedTriangle(screenPoint, control.corners[0], control.corners[2], control.corners[3]);
  return Boolean(planePoint && !visibility?.isOccluded(planePoint));
}

function groupControlHit(x, y, control, visibility) {
  return groupControlHandleHit(x, y, control, visibility) || groupControlPlaneHit(x, y, control, visibility);
}

function groupControlsScreenInfo(frame, gizmo) {
  if (!gizmo) return { translate: null, scale: null, rotation: null };
  const translate = groupControlScreenInfo(frame, gizmo, "translate");
  const scale = groupControlScreenInfo(frame, gizmo, "scale");
  const rotation = indexRingScreenInfo(frame, {
      indexRing: {
        center: [gizmo.center[0], gizmo.center[1], gizmo.shiftZ],
        outerRadius: gizmo.radius * 0.76,
        innerRadius: gizmo.radius * 0.69,
        baseIndex: normalizeFacetIndex(gizmo.rotationTeeth),
        repeat: 1,
        mirror: 0,
        locked: false,
        groupRotation: true,
      },
    });
  return { translate, scale, rotation };
}

function groupRotationRingHit(x, y, ring, visibility) {
  if (!ring) return false;
  if (!visibility?.isOccluded(ring.outerHandle) && Math.hypot(x - ring.outerHandle.x, y - ring.outerHandle.y) <= 15) return true;
  return ring.outer.slice(0, INDEX_TEETH).some((point, index) => {
    const next = ring.outer[index + 1];
    const worldMidpoint = ringPoint(ring.worldCenter, ring.outerRadius, index + 0.5);
    const projectedMidpoint = ring.projectPoint(worldMidpoint);
    return projectedMidpoint
      && !visibility?.isOccluded(projectedMidpoint)
      && pointToSegment2D(x, y, point.x, point.y, next.x, next.y).distance <= 7;
  });
}

const PICK_VERTEX_PX = 12;

function pickSceneTarget(x, y, scene) {
  const { frame, faces = [] } = scene;
  if (!frame) return null;

  if (scene.meetPickEnabled) {
    let bestVertex = null;
    const visibility = createHelperVisibilityContext({
      ...scene,
      geometry: scene.meetGeometry ?? scene.geometry,
    });
    (scene.meetTargets ?? []).forEach((target, index) => {
      if (target.kind === "edge") {
        const [a, b] = target.endpoints.map((endpoint) => endpoint.fallbackWorldPoint);
        const pa = projectDomainPoint(a, frame), pb = projectDomainPoint(b, frame);
        if (!pa || !pb) return;
        const hit = pointToSegment2D(x, y, pa.x, pa.y, pb.x, pb.y);
        const point = a.map((value, axis) => value + (b[axis] - value) * hit.t);
        if (hit.distance <= 8 && visibility.isSurfacePointVisible(point) && (!bestVertex || hit.distance < bestVertex.distance)) {
          bestVertex = { kind: "edge", point, index, distance: hit.distance, target };
        }
        return;
      }
      const point = target.point ?? target.target ?? target.fallbackWorldPoint ?? target;
      if (!visibility.isSurfacePointVisible(point)) return;
      const projected = projectDomainPoint(point, frame);
      if (!projected) return;
      const distance = Math.hypot(projected.x - x, projected.y - y);
      if (distance <= PICK_VERTEX_PX && (!bestVertex || distance < bestVertex.distance)) {
        bestVertex = { kind: "vertex", point, index, distance, target };
      }
    });
    return bestVertex;
  }

  const hitFaces = faces
    .filter((face) => face.operationId)
    .map((face) => {
      const polygon = face.points.map((point) => {
        const projected = projectDomainPoint(point, frame);
        return projected ? [projected.x, projected.y] : null;
      });
      if (polygon.some((point) => !point)) return null;
      if (!pointInPolygon2D(x, y, polygon)) return null;
      const center = projectDomainPoint(face.center, frame);
      return { kind: "face", operationId: face.operationId, viewZ: center?.viewZ ?? 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.viewZ - a.viewZ);
  return hitFaces[0] ?? null;
}

function angleArcWorldInfo(gizmo) {
  if (!gizmo?.radial || !Number.isFinite(gizmo.arcRadius)) return null;
  const radial = normalize(gizmo.radial);
  const ring = gizmo.indexRing;
  const bearing = ring?.center && Number.isFinite(ring.outerRadius)
    ? ringPoint(ring.center, ring.outerRadius, normalizeFacetIndex(Math.round(ring.baseIndex)))
    : ringPoint(gizmo.bearingCenter ?? [0, 0, 0], gizmo.bearingRadius, normalizeFacetIndex(Math.round(gizmo.baseIndex)));
  const center = add(bearing, multiply(radial, -gizmo.arcRadius));
  const pointAtAngle = (angle) => {
    return add(center, multiply(angleNormal(gizmo, angle), gizmo.arcRadius));
  };
  const samples = Array.from({ length: 91 }, (_, angle) => ({ angle, point: pointAtAngle(angle) }));
  return { center, samples, knob: pointAtAngle(gizmo.industryAngle), bearing };
}

function depthScreenInfo(frame, gizmo) {
  if (!frame || !gizmo?.normal) return null;
  const arc = angleArcWorldInfo(gizmo);
  if (!arc) return null;
  const normal = normalize(gizmo.normal);
  const planeOffset = normal[0] * gizmo.center[0] + normal[1] * gizmo.center[1] + normal[2] * gizmo.center[2];
  const knobOffset = normal[0] * arc.knob[0] + normal[1] * arc.knob[1] + normal[2] * arc.knob[2];
  const carriagePoint = add(arc.knob, multiply(normal, planeOffset - knobOffset));
  const carriage = projectDomainPoint(carriagePoint, frame, false);
  const directionTip = projectDomainPoint(add(carriagePoint, normal), frame, false);
  const railStart = projectDomainPoint(arc.knob, frame, false);
  const railEnd = projectDomainPoint(carriagePoint, frame, false);
  if (!carriage || !directionTip || !railStart || !railEnd) return null;
  const dx = directionTip.x - carriage.x;
  const dy = directionTip.y - carriage.y;
  const lengthPx = Math.hypot(dx, dy);
  if (lengthPx < 1e-4) return null;
  return {
    x: carriage.x,
    y: carriage.y,
    dirX: dx / lengthPx,
    dirY: dy / lengthPx,
    pxPerUnit: lengthPx,
    railStart,
    railEnd,
    railStartWorld: arc.knob,
    railEndWorld: carriagePoint,
  };
}

function angleNormal(gizmo, industryAngle) {
  const radians = (industryAngle * Math.PI) / 180;
  const radial = normalize(gizmo.radial);
  const zDirection = gizmo.region === "pavilion" ? -1 : 1;
  return normalize([
    radial[0] * Math.sin(radians),
    radial[1] * Math.sin(radians),
    zDirection * Math.cos(radians),
  ]);
}

function angleArcScreenInfo(frame, gizmo) {
  if (!frame) return null;
  const world = angleArcWorldInfo(gizmo);
  if (!world) return null;
  const center = projectDomainPoint(world.center, frame, false);
  if (!center) return null;
  const samples = world.samples.map(({ point, angle }) => {
    const screen = projectDomainPoint(point, frame, false);
    return screen ? { ...screen, angle } : null;
  }).filter(Boolean);
  const knob = projectDomainPoint(world.knob, frame, false);
  if (samples.length < 2 || !knob) return null;
  const bearing = projectDomainPoint(world.bearing, frame, false);
  return { center, samples, knob, bearing, locked: gizmo.angleLocked };
}

function depthHandleHit(x, y, handle, tolerance = 9) {
  if (!handle) return false;
  if (Math.hypot(x - handle.x, y - handle.y) <= tolerance + 4) return true;
  return pointToSegment2D(
    x,
    y,
    handle.railStart.x,
    handle.railStart.y,
    handle.railEnd.x,
    handle.railEnd.y,
  ).distance <= tolerance;
}

function angleHandleHit(x, y, arc, tolerance = 13) {
  if (!arc || arc.locked) return false;
  if (Math.hypot(x - arc.knob.x, y - arc.knob.y) <= tolerance) return true;
  return arc.samples.some((point, index) => {
    const next = arc.samples[index + 1];
    if (!next) return false;
    return pointToSegment2D(x, y, point.x, point.y, next.x, next.y).distance <= 7;
  });
}

function angleAtScreenPoint(x, y, arc) {
  if (!arc?.samples.length) return null;
  let closestAngle = arc.samples[0].angle;
  let closestDistance = Infinity;
  arc.samples.forEach((sample, index) => {
    const next = arc.samples[index + 1];
    if (!next) return;
    const { distance, t } = pointToSegment2D(x, y, sample.x, sample.y, next.x, next.y);
    if (distance < closestDistance) {
      closestAngle = sample.angle + (next.angle - sample.angle) * t;
      closestDistance = distance;
    }
  });
  return Math.round(closestAngle * 100) / 100;
}

function ringPoint(center, radius, tooth) {
  const angle = tooth * DEGREES_PER_TOOTH * Math.PI / 180;
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
    center[2],
  ];
}

function indexRingScreenInfo(frame, gizmo) {
  const ring = gizmo?.indexRing;
  if (!frame || !ring?.center || !Number.isFinite(ring.outerRadius) || !Number.isFinite(ring.innerRadius)) return null;
  const center = projectDomainPoint(ring.center, frame);
  if (!center) return null;
  // The index ring intentionally extends beyond the canvas at high zoom.
  // Keep its finite screen coordinates and let the canvas clip them; treating
  // an off-canvas tick as an invalid projection would stop the p5 draw loop.
  const projectRingPoint = (radius, tooth) => projectDomainPoint(
    ringPoint(ring.center, radius, tooth),
    frame,
    false,
  );
  const outer = Array.from({ length: INDEX_TEETH + 1 }, (_, tooth) => projectRingPoint(ring.outerRadius, tooth));
  const inner = Array.from({ length: INDEX_TEETH + 1 }, (_, tooth) => projectRingPoint(ring.innerRadius, tooth));
  if (outer.some((point) => !point) || inner.some((point) => !point)) return null;

  const baseIndex = normalizeFacetIndex(Math.round(ring.baseIndex));
  const repeat = Math.max(1, Math.round(ring.repeat));
  const mirror = clamp(Math.round(ring.mirror), 0, INDEX_TEETH / 2);
  const rotationStep = INDEX_TEETH / repeat;
  const axisStep = (INDEX_TEETH / 2) / repeat;
  const rotationIndices = Array.from({ length: repeat }, (_, ordinal) => normalizeFacetIndex(baseIndex + ordinal * rotationStep));
  const mirroredIndices = Array.from({ length: repeat }, (_, ordinal) => normalizeFacetIndex(baseIndex + mirror * 2 + ordinal * rotationStep));
  const axes = Array.from({ length: repeat }, (_, ordinal) => baseIndex + mirror + ordinal * axisStep);
  const mirrorCandidates = Array.from({ length: INDEX_TEETH / 2 + 1 }, (_, offset) => ({
    offset,
    point: projectRingPoint(ring.innerRadius, baseIndex + offset),
  }));

  return {
    ...ring,
    worldCenter: ring.center,
    center,
    baseIndex,
    repeat,
    mirror,
    outer,
    inner,
    outerHandle: projectRingPoint(ring.outerRadius, baseIndex),
    mirrorHandle: projectRingPoint(ring.innerRadius, baseIndex + mirror),
    rotationIndices,
    mirroredIndices,
    axes,
    mirrorCandidates,
    projectPoint: (point) => projectDomainPoint(point, frame, false),
    projectRingPoint,
  };
}

function ringPathHit(x, y, points, tolerance = 7) {
  return points.some((point, index) => {
    const next = points[index + 1];
    return next && pointToSegment2D(x, y, point.x, point.y, next.x, next.y).distance <= tolerance;
  });
}

function indexRingHandleHit(x, y, ring) {
  if (!ring || ring.locked) return false;
  if (Math.hypot(x - ring.outerHandle.x, y - ring.outerHandle.y) <= 13) return true;
  return ringPathHit(x, y, ring.outer, 6);
}

function indexRingKnobHit(x, y, ring) {
  return Boolean(ring && !ring.locked && Math.hypot(x - ring.outerHandle.x, y - ring.outerHandle.y) <= 13);
}

function mirrorRingHandleHit(x, y, ring) {
  if (!ring || ring.locked) return false;
  if (Math.hypot(x - ring.mirrorHandle.x, y - ring.mirrorHandle.y) <= 13) return true;
  return ringPathHit(x, y, ring.mirrorCandidates.map((candidate) => candidate.point), 6);
}

function mirrorRingKnobHit(x, y, ring) {
  return Boolean(ring && !ring.locked && Math.hypot(x - ring.mirrorHandle.x, y - ring.mirrorHandle.y) <= 13);
}

function indexAtScreenPoint(x, y, ring) {
  if (!ring) return null;
  let best = null;
  ring.outer.slice(0, INDEX_TEETH).forEach((point, index) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance) best = { value: index, distance };
  });
  return best?.value ?? null;
}

function mirrorAtScreenPoint(x, y, ring) {
  if (!ring) return null;
  let best = null;
  ring.mirrorCandidates.forEach(({ offset, point }) => {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance) best = { value: offset, distance };
  });
  return best?.value ?? null;
}

function drawIndexRing(p, ring, isOccluded, isInsideSolid, isInsideSilhouette) {
  if (!ring) return;
  const graphite = [31, 38, 42];
  const warm = [166, 119, 18];
  const activeIndex = ring.active === "index";
  const activeMirror = ring.active === "mirror";
  const toLocal = (screen) => [screen.x - p.width / 2, screen.y - p.height / 2, overlayDepth(screen)];

  const drawTrack = (samples, radius, color, active) => {
    samples.slice(0, INDEX_TEETH).forEach((point, index) => {
      const next = samples[index + 1];
      const front = (point.viewZ + next.viewZ) / 2 >= ring.center.viewZ;
      if (!front && index % 2) return;
      const worldMidpoint = ringPoint(ring.worldCenter, radius, index + 0.5);
      const projectedMidpoint = ring.projectPoint(worldMidpoint);
      if (
        !projectedMidpoint
        || isInsideSolid(worldMidpoint)
        || isOccluded(projectedMidpoint)
        || (!front && isInsideSilhouette(projectedMidpoint))
      ) return;
      p.stroke(color[0], color[1], color[2], front ? (active ? 245 : 185) : 46);
      p.strokeWeight(active ? 1.7 : 1.05);
      drawProjectedScreenSegment(p, point, next);
    });
  };

  drawTrack(ring.outer, ring.outerRadius, graphite, activeIndex);
  drawTrack(ring.inner, ring.innerRadius, warm, activeMirror);

  for (let tooth = 0; tooth < INDEX_TEETH; tooth += 1) {
    const major = tooth % 12 === 0;
    const mid = tooth % 6 === 0;
    const front = ring.outer[tooth].viewZ >= ring.center.viewZ;
    const outerFrom = ring.projectRingPoint(ring.outerRadius, tooth);
    const outerTo = ring.projectRingPoint(ring.outerRadius + (major ? 0.055 : mid ? 0.038 : 0.022), tooth);
    const outerMidpoint = ring.projectRingPoint(ring.outerRadius + (major ? 0.0275 : mid ? 0.019 : 0.011), tooth);
    if (
      isOccluded(outerMidpoint)
      || (outerMidpoint.viewZ < ring.center.viewZ && isInsideSilhouette(outerMidpoint))
    ) continue;
    p.stroke(graphite[0], graphite[1], graphite[2], front ? (major ? 205 : 115) : 36);
    p.strokeWeight(major ? 1.45 : 0.85);
    drawProjectedScreenSegment(p, outerFrom, outerTo);
  }

  ring.axes.forEach((axis) => {
    [axis, axis + INDEX_TEETH / 2].forEach((tooth) => {
      const from = ring.projectRingPoint(ring.innerRadius - 0.028, tooth);
      const to = ring.projectRingPoint(ring.innerRadius + 0.028, tooth);
      const midpoint = ring.projectRingPoint(ring.innerRadius, tooth);
      if (
        isOccluded(midpoint)
        || (midpoint.viewZ < ring.center.viewZ && isInsideSilhouette(midpoint))
      ) return;
      p.stroke(warm[0], warm[1], warm[2], from.viewZ >= ring.center.viewZ ? 205 : 62);
      p.strokeWeight(1.25);
      drawProjectedScreenSegment(p, from, to);
    });
  });

  const axisWorldA = ringPoint(ring.worldCenter, ring.innerRadius, ring.baseIndex + ring.mirror);
  const axisWorldB = ringPoint(ring.worldCenter, ring.innerRadius, ring.baseIndex + ring.mirror + INDEX_TEETH / 2);
  p.stroke(warm[0], warm[1], warm[2], 82);
  p.strokeWeight(1);
  const segments = 15;
  for (let part = 0; part < segments; part += 2) {
    const t1 = part / segments;
    const t2 = Math.min((part + 1) / segments, 1);
    drawProjectedWorldSegment(
      p,
      add(axisWorldA, multiply(subtract(axisWorldB, axisWorldA), t1)),
      add(axisWorldA, multiply(subtract(axisWorldB, axisWorldA), t2)),
      ring.projectPoint,
      isOccluded,
      isInsideSolid,
      isInsideSilhouette,
      6,
    );
  }

  ring.rotationIndices.forEach((tooth) => {
    const point = ring.projectRingPoint(ring.outerRadius, tooth);
    if (isOccluded(point)) return;
    const [x, y, z] = toLocal(point);
    p.push();
    p.translate(x, y, z);
    p.fill(255, 255, 255, 245);
    p.stroke(graphite[0], graphite[1], graphite[2], point.viewZ >= ring.center.viewZ ? 235 : 82);
    p.strokeWeight(1.4);
    p.circle(0, 0, 8);
    p.pop();
  });

  if (ring.mirror !== 0) {
    ring.mirroredIndices.forEach((tooth) => {
      const point = ring.projectRingPoint(ring.innerRadius, tooth);
      if (isOccluded(point)) return;
      const [x, y, z] = toLocal(point);
      const size = 5.5;
      p.push();
      p.translate(x, y, z);
      p.fill(255, 255, 255, 242);
      p.stroke(warm[0], warm[1], warm[2], point.viewZ >= ring.center.viewZ ? 235 : 82);
      p.strokeWeight(1.35);
      p.quad(0, -size, size, 0, 0, size, -size, 0);
      p.pop();
    });
  }

  const drawHandle = (point, color, active) => {
    if (isOccluded(point)) return;
    const [x, y, z] = toLocal(point);
    p.push();
    p.translate(x, y, z);
    p.fill(255, 255, 255, 248);
    p.stroke(color[0], color[1], color[2], ring.locked ? 90 : 250);
    p.strokeWeight(active ? 2.6 : 2);
    p.circle(0, 0, active ? 17 : 14);
    p.noStroke();
    p.fill(color[0], color[1], color[2], ring.locked ? 90 : 255);
    p.circle(0, 0, 5);
    p.pop();
  };
  drawHandle(ring.outerHandle, graphite, activeIndex);
  drawHandle(ring.mirrorHandle, warm, activeMirror);
}

function drawGroupRotationRing(p, ring, isOccluded) {
  if (!ring) return;
  const warm = [166, 119, 18];
  const active = ring.active === "group-rotate";
  const toLocal = (screen) => [screen.x - p.width / 2, screen.y - p.height / 2, overlayDepth(screen)];
  const gl = p.drawingContext;
  const restoreDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  // Visibility is already resolved against the solid by isOccluded. Drawing
  // this screen-space ring without a second depth test keeps its front arc in
  // front while the rear arc remains clipped by the geometric test.
  gl.disable(gl.DEPTH_TEST);

  ring.outer.slice(0, INDEX_TEETH).forEach((point, index) => {
    const next = ring.outer[index + 1];
    const worldMidpoint = ringPoint(ring.worldCenter, ring.outerRadius, index + 0.5);
    const projectedMidpoint = ring.projectPoint(worldMidpoint);
    if (!projectedMidpoint || isOccluded(projectedMidpoint)) return;
    p.stroke(warm[0], warm[1], warm[2], active ? 245 : 180);
    p.strokeWeight(active ? 1.9 : 1.2);
    drawProjectedScreenSegment(p, point, next);

    const inner = ring.inner[index];
    const major = index % 12 === 0;
    p.stroke(warm[0], warm[1], warm[2], major ? 205 : 105);
    p.strokeWeight(major ? 1.25 : 0.75);
    drawProjectedScreenSegment(p, inner, point);
  });

  if (!isOccluded(ring.outerHandle)) {
    const [x, y, z] = toLocal(ring.outerHandle);
    p.push();
    p.translate(x, y, z);
    p.fill(255, 255, 255, 248);
    p.stroke(warm[0], warm[1], warm[2], 250);
    p.strokeWeight(active ? 2.7 : 2);
    p.circle(0, 0, active ? 19 : 16);
    p.noStroke();
    p.fill(warm[0], warm[1], warm[2], 255);
    p.circle(0, 0, 5);
    p.pop();
  }
  if (restoreDepthTest) gl.enable(gl.DEPTH_TEST);
}

function drawPickOverlay(p, scene) {
  const frame = scene.frame;
  if (!frame) return;
  const depthHandle = depthScreenInfo(frame, scene.cutGizmo);
  const angleArc = angleArcScreenInfo(frame, scene.cutGizmo);
  const indexRing = indexRingScreenInfo(frame, scene.cutGizmo);
  const groupControls = groupControlsScreenInfo(frame, scene.groupGizmo);
  const groupControlList = [groupControls.translate, groupControls.scale].filter(Boolean);
  const groupRotationRing = groupControls.rotation;
  if (indexRing) indexRing.active = scene.activeGizmo;
  if (groupRotationRing) groupRotationRing.active = scene.activeGizmo;
  const hasConstructionOverlay = scene.meetPickEnabled || scene.constructionMarkers?.length || scene.nextJumpMarker;
  if (!depthHandle && !angleArc && !indexRing && !groupControlList.length && !groupRotationRing && !hasConstructionOverlay) return;

  const gl = p.drawingContext;
  const {
    isOccluded,
    isInsideSolid,
    isInsideSilhouette,
    isWorldPointVisible,
  } = createHelperVisibilityContext(scene);
  const constructionVisibility = createHelperVisibilityContext({
    ...scene,
    geometry: scene.meetGeometry ?? scene.geometry,
  });
  const isConstructionPointVisible = constructionVisibility.isSurfacePointVisible;
  const isDepthOccluded = (point) => (
    isOccluded(point)
    || Boolean(
      frame.pitch > 0
      && isInsideSilhouette(point)
    )
  );
  if (scene.renderMode === "solid") gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  p.camera(0, 0, 400, 0, 0, 0, 0, 1, 0);
  p.ortho(-p.width / 2, p.width / 2, -p.height / 2, p.height / 2, -1000, 1000);
  const toLocal = (screen) => [screen.x - p.width / 2, screen.y - p.height / 2, overlayDepth(screen)];

  if (scene.meetPickEnabled) {
    (scene.meetTargets ?? []).forEach((target) => {
      if (target.kind === "edge") {
        const [a, b] = target.endpoints.map((endpoint) => endpoint.fallbackWorldPoint);
        p.stroke(42, 93, 82, 235);
        p.strokeWeight(2);
        drawClippedWorldSegment(p, a, b, (point) => projectDomainPoint(point, frame), constructionVisibility.isOccluded, () => false);
        return;
      }
      const point = target.point ?? target.target ?? target.fallbackWorldPoint ?? target;
      if (!isConstructionPointVisible(point)) return;
      const projected = projectDomainPoint(point, frame);
      if (!projected) return;
      const [x, y, z] = toLocal(projected);
      p.push();
      p.translate(x, y, z);
      p.fill(255, 255, 255, 225);
      p.stroke(42, 93, 82, 235);
      p.strokeWeight(1.5);
      p.circle(0, 0, 11);
      p.pop();
    });
  }

  if (scene.nextJumpMarker) {
    const point = scene.nextJumpMarker.point ?? scene.nextJumpMarker.target;
    const projected = point ? projectDomainPoint(point, frame) : null;
    if (projected) {
      const hidden = constructionVisibility.isOccluded(projected);
      const [x, y, z] = toLocal(projected);
      p.push();
      p.translate(x, y, z);
      p.noFill();
      p.stroke(166, 119, 18, hidden ? 135 : 245);
      p.strokeWeight(1.8);
      p.beginShape();
      p.vertex(0, -7);
      p.vertex(7, 0);
      p.vertex(0, 7);
      p.vertex(-7, 0);
      p.endShape(p.CLOSE);
      p.line(-3, 0, 3, 0);
      p.line(0, -3, 0, 3);
      p.pop();
    }
  }

  for (const marker of scene.constructionMarkers ?? []) {
    const point = marker.point ?? marker.target;
    const projected = point ? projectDomainPoint(point, frame) : null;
    if (projected && isConstructionPointVisible(point)) {
      const [x, y, z] = toLocal(projected);
      const isError = marker.status === "unreachable" || marker.status === "stale";
      const isWarning = marker.status === "destructive";
      p.push();
      p.translate(x, y, z);
      p.noFill();
      p.stroke(isError ? 179 : isWarning ? 166 : 237, isError ? 38 : isWarning ? 119 : 34, isError ? 77 : isWarning ? 18 : 93, 255);
      p.strokeWeight(2);
      if (isError) {
        for (let start = 0; start < p.TWO_PI; start += p.PI / 3) p.arc(0, 0, 19, 19, start, start + p.PI / 6);
      } else if (marker.locked) {
        p.fill(237, 34, 93, 245);
        p.circle(0, 0, 13);
        p.noFill();
        p.rect(-5, -1, 10, 8, 2);
        p.arc(0, -1, 7, 8, p.PI, p.TWO_PI);
      } else {
        p.circle(0, 0, 15);
      }
      p.pop();
    }
  }

  groupControlList.forEach((groupControl) => {
    const active = scene.activeGizmo === `group-${groupControl.kind}`;
    const scaleMode = groupControl.kind === "scale";
    const color = scaleMode ? [22, 140, 131] : [125, 91, 184];
    const handleVisible = isWorldPointVisible(groupControl.worldHandle);
    p.stroke(scaleMode ? 178 : 201, scaleMode ? 225 : 184, scaleMode ? 220 : 230, active ? 230 : 178);
    p.strokeWeight(active ? 8 : 6);
    drawClippedWorldSegment(
      p,
      groupControl.worldAxisStart,
      groupControl.worldHandle,
      (point) => projectDomainPoint(point, frame, false),
      isOccluded,
      isInsideSolid,
    );
    p.stroke(color[0], color[1], color[2], 245);
    p.strokeWeight(active ? 2.5 : 1.8);
    drawClippedWorldSegment(
      p,
      groupControl.worldAxisStart,
      groupControl.worldHandle,
      (point) => projectDomainPoint(point, frame, false),
      isOccluded,
      isInsideSolid,
    );
    if (handleVisible) {
      const [handleX, handleY, handleZ] = toLocal(groupControl.handle);
      p.push();
      p.translate(handleX, handleY, handleZ);
      p.fill(255, 255, 255, 248);
      p.stroke(color[0], color[1], color[2], 255);
      p.strokeWeight(active ? 2.6 : 2);
      p.circle(0, 0, active ? 22 : 18);
      p.noStroke();
      p.fill(color[0], color[1], color[2], 255);
      p.circle(0, 0, 6);
      if (scaleMode) {
        p.noFill();
        p.stroke(color[0], color[1], color[2], 210);
        p.strokeWeight(1);
        p.circle(0, 0, active ? 29 : 25);
      }
      p.pop();
    }
  });

  drawGroupRotationRing(p, groupRotationRing, isOccluded);

  drawIndexRing(p, indexRing, isOccluded, isInsideSolid, isInsideSilhouette);

  if (angleArc) {
    const blue = [47, 111, 228];
    const graphite = [49, 56, 60];
    const active = scene.activeGizmo === "angle";

    const [centerX, centerY] = toLocal(angleArc.center);
    const [bearingX, bearingY, bearingZ] = toLocal(angleArc.bearing ?? angleArc.center);
    p.push();
    p.translate(bearingX, bearingY, bearingZ);
    p.noStroke();
    p.fill(49, 56, 60, angleArc.locked ? 52 : 210);
    p.circle(0, 0, active ? 24 : 21);
    p.fill(226, 231, 233, angleArc.locked ? 62 : 245);
    p.circle(0, 0, active ? 16 : 14);
    p.noFill();
    p.stroke(graphite[0], graphite[1], graphite[2], angleArc.locked ? 70 : 215);
    p.strokeWeight(1.2);
    p.circle(0, 0, active ? 24 : 21);
    p.pop();

    // The 90-degree endpoint is the selected index bearing, so the angle bridge
    // and the 96-tooth wheel are one continuous mechanism with no connector.
    p.noFill();
    p.stroke(142, 181, 239, angleArc.locked ? 38 : active ? 150 : 105);
    p.strokeWeight(active ? 9 : 7.5);
    angleArc.samples.slice(0, -1).forEach((point, index) => {
      drawProjectedScreenSegment(p, point, angleArc.samples[index + 1]);
    });
    p.stroke(blue[0], blue[1], blue[2], angleArc.locked ? 92 : active ? 255 : 205);
    p.strokeWeight(active ? 2.2 : 1.55);
    angleArc.samples.slice(0, -1).forEach((point, index) => {
      drawProjectedScreenSegment(p, point, angleArc.samples[index + 1]);
    });

    for (let angle = 0; angle <= 90; angle += 5) {
      const point = angleArc.samples.find((sample) => sample.angle === angle);
      if (!point) continue;
      const dx = point.x - angleArc.center.x;
      const dy = point.y - angleArc.center.y;
      const magnitude = Math.max(Math.hypot(dx, dy), 1);
      const nx = dx / magnitude;
      const ny = dy / magnitude;
      const [px, py, pz] = toLocal(point);
      const major = angle % 15 === 0;
      p.stroke(blue[0], blue[1], blue[2], angleArc.locked ? 62 : major ? 190 : 125);
      p.strokeWeight(major ? 1.25 : 0.8);
      p.line(
        px - nx * (major ? 5 : 3),
        py - ny * (major ? 5 : 3),
        pz,
        px + nx * (major ? 7 : 4),
        py + ny * (major ? 7 : 4),
        pz,
      );
    }

    const [knobX, knobY, knobZ] = toLocal(angleArc.knob);
    p.push();
    p.translate(knobX, knobY, knobZ);
    p.fill(255, 255, 255, 240);
    p.stroke(blue[0], blue[1], blue[2], angleArc.locked ? 105 : 245);
    p.strokeWeight(active ? 2.5 : 2);
    p.circle(0, 0, active ? 17 : 14);
    p.noStroke();
    p.fill(blue[0], blue[1], blue[2], angleArc.locked ? 105 : 255);
    p.circle(0, 0, 5);
    p.pop();
  }

  if (depthHandle) {
    const [hx, hy, hz] = toLocal(depthHandle);
    const active = scene.activeGizmo === "depth";
    // One straight telescoping rail connects the angle carriage to the active
    // cutting plane. Dragging anywhere on it changes depth only.
    p.stroke(244, 136, 167, active ? 225 : 150);
    p.strokeWeight(active ? 7 : 5.5);
    drawClippedWorldSegment(
      p,
      depthHandle.railStartWorld,
      depthHandle.railEndWorld,
      (point) => projectDomainPoint(point, frame, false),
      isDepthOccluded,
      isInsideSolid,
    );
    p.stroke(237, 34, 93, active ? 255 : 220);
    p.strokeWeight(active ? 2.4 : 1.8);
    drawClippedWorldSegment(
      p,
      depthHandle.railStartWorld,
      depthHandle.railEndWorld,
      (point) => projectDomainPoint(point, frame, false),
      isDepthOccluded,
      isInsideSolid,
    );

    if (!isInsideSolid(depthHandle.railEndWorld) && !isDepthOccluded(depthHandle)) {
      p.push();
      p.translate(hx, hy, hz);
      p.fill(255, 247, 250, 248);
      p.stroke(237, 34, 93, active ? 255 : 235);
      p.strokeWeight(active ? 2 : 1.6);
      p.circle(0, 0, active ? 18 : 15);
      p.noStroke();
      p.fill(237, 34, 93, 255);
      p.circle(0, 0, 4);
      p.pop();
    }

  }

  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
}

function drawCanvasBadge(context, x, y, label, color) {
  context.save();
  context.font = "600 12px 'IBM Plex Mono', monospace";
  context.textBaseline = "middle";
  const width = Math.ceil(context.measureText(label).width) + 16;
  const height = 25;
  const density = context.getTransform().a || 1;
  const canvasWidth = context.canvas.width / density;
  const canvasHeight = context.canvas.height / density;
  const safeX = clamp(x, 8, canvasWidth - width - 8);
  const safeY = clamp(y, 8, canvasHeight - height - 8);
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(safeX, safeY, width, height, 5);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.fillText(label, safeX + 8, safeY + height / 2 + 0.5);
  context.restore();
}

function drawGizmoLabels(canvas, scene) {
  if (!canvas || !scene.frame) return;
  const density = Math.min(window.devicePixelRatio || 1, 1.75);
  const width = Math.round(scene.frame.width);
  const height = Math.round(scene.frame.height);
  if (canvas.width !== Math.round(width * density) || canvas.height !== Math.round(height * density)) {
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
  }
  const context = canvas.getContext("2d");
  context.setTransform(density, 0, 0, density, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!scene.pickingEnabled || (!scene.cutGizmo && !scene.groupGizmo && !scene.constructionMarkers?.length && !scene.nextJumpMarker)) return;

  const groupControls = groupControlsScreenInfo(scene.frame, scene.groupGizmo);
  const visibility = createHelperVisibilityContext(scene);
  const constructionVisibility = createHelperVisibilityContext({
    ...scene,
    geometry: scene.meetGeometry ?? scene.geometry,
  });
  for (const marker of scene.constructionMarkers ?? []) {
    const constructionPoint = marker?.point ?? marker?.target;
    const constructionScreen = constructionPoint ? projectDomainPoint(constructionPoint, scene.frame) : null;
    if (constructionScreen && constructionVisibility.isSurfacePointVisible(constructionPoint)) {
      const status = marker.status;
      const label = status === "stale"
        ? "Meet · 来源失效"
        : status === "unreachable"
          ? "Meet · 不可达"
          : status === "destructive"
            ? "Meet · 覆盖已有面"
            : marker.locked ? "Meet · 已锁" : "Meet · 待锁定";
      drawCanvasBadge(
        context,
        constructionScreen.x + 12,
        constructionScreen.y + (marker.slot === "B" ? 10 : -31),
        `${marker.slot ?? "A"} · ${marker.locked ? label : label.replace("Meet", "预览")}`,
        status === "valid" ? "#ed225d" : status === "destructive" ? "#a67712" : "#b3264d",
      );
    }
  }
  const nextJumpPoint = scene.nextJumpMarker?.point ?? scene.nextJumpMarker?.target;
  const nextJumpScreen = nextJumpPoint ? projectDomainPoint(nextJumpPoint, scene.frame) : null;
  if (nextJumpScreen) {
    const hidden = constructionVisibility.isOccluded(nextJumpScreen);
    drawCanvasBadge(
      context,
      nextJumpScreen.x + 12,
      nextJumpScreen.y + 10,
      `下一点 · ${scene.nextJumpMarker.position ?? "—"}${hidden ? " · 背面" : ""}`,
      hidden ? "#887b58" : "#a67712",
    );
  }
  const translateControl = groupControls.translate;
  const scaleControl = groupControls.scale;
  const rotationRing = groupControls.rotation;
  if (translateControl && visibility.isWorldPointVisible(translateControl.worldHandle)) {
    drawCanvasBadge(context, translateControl.handle.x + 10, translateControl.handle.y - 29, `ΔZ ${translateControl.delta >= 0 ? "+" : ""}${translateControl.delta.toFixed(3)}`, "#7d5bb8");
  }
  if (scaleControl && visibility.isWorldPointVisible(scaleControl.worldHandle)) {
    drawCanvasBadge(context, scaleControl.handle.x + 12, scaleControl.handle.y - 31, `H ${(scaleControl.scale * 100).toFixed(1)}%`, "#168c83");
  }
  if (rotationRing && !visibility.isOccluded(rotationRing.outerHandle)) {
    const teeth = scene.groupGizmo.rotationTeeth;
    drawCanvasBadge(context, rotationRing.outerHandle.x + 10, rotationRing.outerHandle.y + 12, `R ${teeth >= 0 ? "+" : ""}${teeth}T`, "#a67712");
  }

  const depth = depthScreenInfo(scene.frame, scene.cutGizmo);
  const arc = angleArcScreenInfo(scene.frame, scene.cutGizmo);
  const indexRing = indexRingScreenInfo(scene.frame, scene.cutGizmo);
  const { isOccluded, isInsideSolid, isInsideSilhouette } = visibility;
  if (arc) {
    context.save();
    context.fillStyle = arc.locked ? "rgba(47, 111, 228, 0.48)" : "#2f6fe4";
    context.font = "500 10px 'IBM Plex Mono', monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    [0, 45, 90].forEach((angle) => {
      const sample = arc.samples.find((point) => point.angle === angle);
      if (!sample || isOccluded(sample)) return;
      const dx = sample.x - arc.center.x;
      const dy = sample.y - arc.center.y;
      const magnitude = Math.max(Math.hypot(dx, dy), 1);
      context.fillText(`${angle}°`, sample.x + (dx / magnitude) * 19, sample.y + (dy / magnitude) * 19);
    });
    context.restore();
    if (!isOccluded(arc.knob)) {
      drawCanvasBadge(
        context,
        arc.knob.x + 12,
        arc.knob.y - 30,
        `A ${scene.cutGizmo.industryAngle.toFixed(2)}°`,
        arc.locked ? "rgba(47, 111, 228, 0.48)" : "#2f6fe4",
      );
    }
  }
  const depthOccluded = depth && (
    isOccluded(depth)
    || Boolean(scene.frame.pitch > 0 && isInsideSilhouette(depth))
    || isInsideSolid(depth.railEndWorld)
  );
  if (depth && !depthOccluded) {
    const perpendicularX = -depth.dirY;
    const perpendicularY = depth.dirX;
    drawCanvasBadge(
      context,
      depth.x + depth.dirX * 45 + perpendicularX * 10,
      depth.y + depth.dirY * 45 + perpendicularY * 10,
      `D ${scene.cutGizmo.value.toFixed(3)}`,
      "#ed225d",
    );
  }
  if (indexRing) {
    const outerBounds = indexRing.outer.slice(0, INDEX_TEETH).reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    context.save();
    context.fillStyle = indexRing.locked ? "rgba(31, 38, 42, 0.38)" : "rgba(31, 38, 42, 0.78)";
    context.font = "500 10px 'IBM Plex Mono', monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let tooth = 0; tooth < INDEX_TEETH; tooth += 12) {
      const labelPoint = indexRing.projectRingPoint(indexRing.outerRadius + 0.105, tooth);
      if (isOccluded(labelPoint)) continue;
      context.globalAlpha = labelPoint.viewZ >= indexRing.center.viewZ ? 1 : 0.42;
      context.fillText(String(displayIndex(tooth)), labelPoint.x, labelPoint.y);
    }
    context.globalAlpha = 1;
    if (width >= 760) {
      const legendX = clamp(outerBounds.maxX - 150, outerBounds.minX + 18, width - 170);
      const legendY = clamp(outerBounds.maxY + 34, 72, height - 50);
      context.textAlign = "left";
      context.strokeStyle = "#1f262a";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(legendX, legendY);
      context.lineTo(legendX + 24, legendY);
      context.stroke();
      context.fillStyle = "#4d5559";
      context.fillText("外圈：分度", legendX + 32, legendY);
      context.strokeStyle = "#a67712";
      context.beginPath();
      context.moveTo(legendX, legendY + 21);
      context.lineTo(legendX + 24, legendY + 21);
      context.stroke();
      context.fillText("内圈：镜像轴偏移", legendX + 32, legendY + 21);
    }
    context.restore();
    if (!isOccluded(indexRing.outerHandle)) {
      drawCanvasBadge(
        context,
        indexRing.outerHandle.x + 12,
        indexRing.outerHandle.y + 10,
        `主切面 · I${String(displayIndex(indexRing.baseIndex)).padStart(2, "0")}`,
        indexRing.locked ? "rgba(31, 38, 42, 0.45)" : "#1f262a",
      );
    }
    if (!isOccluded(indexRing.mirrorHandle)) {
      drawCanvasBadge(
        context,
        indexRing.mirrorHandle.x + 12,
        indexRing.mirrorHandle.y - 34,
        indexRing.mirror === 0 ? "M 0 · 重合" : `M +${indexRing.mirror}T`,
        indexRing.locked ? "rgba(166, 119, 18, 0.45)" : "#a67712",
      );
    }
  }
}

function drawPolyhedron(p, geometry, sceneScale, lineWeight, yaw, pitch, renderMode, highlightOperationId, activeOperationId, previewOperationId) {
  const gl = p.drawingContext;
  gl.depthMask(renderMode !== "xray");
  [...geometry.faces]
    .sort((a, b) => viewDepth(a.center, yaw, pitch) - viewDepth(b.center, yaw, pitch))
    .forEach((face) => {
      const [red, green, blue, alpha] = faceColor(face, geometry.bounds, renderMode, highlightOperationId, activeOperationId, previewOperationId);
      p.noStroke();
      p.fill(red, green, blue, alpha);
      p.beginShape(p.TRIANGLE_FAN);
      const normal = transformPoint(face.normal, 1);
      p.normal(normal[0], normal[1], normal[2]);
      face.points.forEach((point) => p5Vertex(p, point, sceneScale));
      p.endShape(p.CLOSE);
    });
  gl.depthMask(true);

  const uniqueEdges = new Map();
  geometry.faces.forEach((face) => {
    face.points.forEach((point, index) => {
      const next = face.points[(index + 1) % face.points.length];
      uniqueEdges.set(edgeKey(point, next), [point, next]);
    });
  });

  p.noFill();
  p.stroke(31, 38, 42, renderMode === "xray" ? 112 : 210);
  p.strokeWeight(lineWeight * (renderMode === "xray" ? 0.85 : 1.1));
  uniqueEdges.forEach(([start, end]) => p5Line(p, start, end, sceneScale));

  if (activeOperationId) {
    p.stroke(238, 36, 96, renderMode === "xray" ? 155 : 235);
    p.strokeWeight(lineWeight * 1.65);
    geometry.faces
      .filter((face) => face.operationId === activeOperationId)
      .forEach((face) => face.points.forEach((point, index) => {
        p5Line(p, point, face.points[(index + 1) % face.points.length], sceneScale);
      }));
  }
}

function drawAxis(p, bounds, sceneScale, lineWeight, renderMode) {
  const height = Math.max(bounds.span[2], 1);
  const bottom = bounds.min[2] - height * 0.48;
  const top = bounds.max[2] + height * 0.48;
  const centerX = bounds.center[0];
  const centerY = bounds.center[1];
  const gl = p.drawingContext;

  if (renderMode === "xray") gl.disable(gl.DEPTH_TEST);
  p.stroke(18, 23, 26, 86);
  p.strokeWeight(lineWeight * 0.8);
  if (renderMode === "solid") {
    drawDashedLine(p, [centerX, centerY, bottom], [centerX, centerY, bounds.min[2]], sceneScale, 7);
    drawDashedLine(p, [centerX, centerY, bounds.max[2]], [centerX, centerY, top], sceneScale, 7);
  } else {
    drawDashedLine(p, [centerX, centerY, bottom], [centerX, centerY, top], sceneScale, 19);
  }
  if (renderMode === "xray") gl.enable(gl.DEPTH_TEST);
}

function drawOrientationGizmo(p, camera) {
  const gl = p.drawingContext;
  gl.clear(gl.DEPTH_BUFFER_BIT);
  p.camera(0, 0, 400, 0, 0, 0, 0, 1, 0);
  p.ortho(-p.width / 2, p.width / 2, -p.height / 2, p.height / 2, -1000, 1000);

  p.push();
  p.translate(-p.width / 2 + 57, p.height / 2 - 84, 0);
  p.rotateX(camera.pitch);
  p.rotateY(camera.yaw);
  p.stroke(35, 42, 46, 205);
  p.strokeWeight(1);
  p.fill(244, 246, 246, 232);
  p.box(34);

  p.strokeWeight(1.5);
  p.stroke(237, 34, 93, 225);
  p.line(0, 0, 0, 30, 0, 0);
  p.stroke(93, 148, 220, 225);
  p.line(0, 0, 0, 0, 0, 30);
  p.stroke(32, 39, 42, 225);
  p.line(0, 0, 0, 0, -30, 0);
  p.pop();
}

function calculateSceneScale(width, height, bounds) {
  const diameter = Math.max(bounds.radius * 2, 1e-4);
  return Math.max(36, Math.min(width, height) * 0.58 / diameter);
}

function isStockGeometry(polyhedron, geometry) {
  if (geometry.vertices.length !== 8 || geometry.faces.length !== 6) return false;
  if (polyhedron?.faces?.every((face) => String(face?.id ?? "").startsWith("cube:"))) {
    return true;
  }
  const [x, y, z] = geometry.bounds.span;
  const tolerance = Math.max(x, y, z) * 1e-6;
  return Math.abs(x - y) <= tolerance && Math.abs(y - z) <= tolerance;
}

function attachViewportInteractions(canvas, cameraRef, sceneRef, requestViewModeRef, interactionRef) {
  let activePointer = null;
  let gizmoDrag = null;

  const canvasPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const endPointer = (event) => {
    if (activePointer?.id !== event.pointerId) return;
    const wasGizmoDrag = Boolean(gizmoDrag);
    if (wasGizmoDrag) {
      gizmoDrag = null;
      sceneRef.current.activeGizmo = null;
    }
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.classList.remove("is-dragging");

    // Treat a sub-4px press as a click: pick layers.
    if (!wasGizmoDrag && sceneRef.current.pickingEnabled) {
      const moved = Math.hypot(event.clientX - activePointer.downX, event.clientY - activePointer.downY);
      if (moved < 4) {
        const { x, y } = canvasPoint(event);
        const target = pickSceneTarget(x, y, sceneRef.current);
        if (["vertex", "edge"].includes(target?.kind) && sceneRef.current.meetPickEnabled) {
          interactionRef.current?.onVertexPick?.(target.target);
        } else if (target?.kind === "face") {
          interactionRef.current?.onFacePick?.(target.operationId);
        }
      }
    }
    activePointer = null;
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY, downX: event.clientX, downY: event.clientY };

    // Angle and depth remain independent degrees of freedom.
    const scene = sceneRef.current;
    if (scene.pickingEnabled && scene.frame) {
      const { x, y } = canvasPoint(event);
      const groupControls = groupControlsScreenInfo(scene.frame, scene.groupGizmo);
      const groupVisibility = createHelperVisibilityContext(scene);
      const arc = angleArcScreenInfo(scene.frame, scene.cutGizmo);
      const depth = depthScreenInfo(scene.frame, scene.cutGizmo);
      const indexRing = indexRingScreenInfo(scene.frame, scene.cutGizmo);
      const beginGroupDrag = (control) => {
        gizmoDrag = {
          kind: `group-${control.kind}`,
          startX: x,
          startY: y,
          startValue: control.kind === "scale" ? control.scale : control.delta,
          info: control,
        };
        scene.activeGizmo = `group-${control.kind}`;
      };
      if (groupRotationRingHit(x, y, groupControls.rotation, groupVisibility)) {
        gizmoDrag = { kind: "group-rotate", ring: groupControls.rotation };
        scene.activeGizmo = "group-rotate";
        const nextRotation = indexAtScreenPoint(x, y, groupControls.rotation);
        if (nextRotation !== null) interactionRef.current?.onGroupRotationDrag?.(nextRotation);
      } else if (groupControlHandleHit(x, y, groupControls.translate, groupVisibility)) {
        beginGroupDrag(groupControls.translate);
      } else if (groupControlHandleHit(x, y, groupControls.scale, groupVisibility)) {
        beginGroupDrag(groupControls.scale);
      } else if (groupControlPlaneHit(x, y, groupControls.scale, groupVisibility)) {
        beginGroupDrag(groupControls.scale);
      } else if (groupControlPlaneHit(x, y, groupControls.translate, groupVisibility)) {
        beginGroupDrag(groupControls.translate);
      } else if (mirrorRingKnobHit(x, y, indexRing)) {
        gizmoDrag = { kind: "mirror", ring: indexRing };
        scene.activeGizmo = "mirror";
      } else if (indexRingKnobHit(x, y, indexRing)) {
        gizmoDrag = { kind: "index", ring: indexRing };
        scene.activeGizmo = "index";
        const nextIndex = indexAtScreenPoint(x, y, indexRing);
        if (nextIndex !== null) interactionRef.current?.onIndexDrag?.(nextIndex);
      } else if (angleHandleHit(x, y, arc)) {
        gizmoDrag = { kind: "angle", arc };
        scene.activeGizmo = "angle";
      } else if (!scene.cutGizmo?.depthLocked && depthHandleHit(x, y, depth)) {
        gizmoDrag = { kind: "depth", startX: x, startY: y, startDepth: scene.cutGizmo.value, info: depth };
        scene.activeGizmo = "depth";
      } else if (mirrorRingHandleHit(x, y, indexRing)) {
        gizmoDrag = { kind: "mirror", ring: indexRing };
        scene.activeGizmo = "mirror";
      } else if (indexRingHandleHit(x, y, indexRing)) {
        gizmoDrag = { kind: "index", ring: indexRing };
        scene.activeGizmo = "index";
        const nextIndex = indexAtScreenPoint(x, y, indexRing);
        if (nextIndex !== null) interactionRef.current?.onIndexDrag?.(nextIndex);
      }
    }

    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
  };

  const onPointerMove = (event) => {
    if (activePointer?.id === event.pointerId) {
      const movedX = event.clientX - activePointer.x;
      const movedY = event.clientY - activePointer.y;
      activePointer.x = event.clientX;
      activePointer.y = event.clientY;

      if (gizmoDrag?.kind === "depth") {
        const { x, y } = canvasPoint(event);
        const along = (x - gizmoDrag.startX) * gizmoDrag.info.dirX + (y - gizmoDrag.startY) * gizmoDrag.info.dirY;
        // Deeper cuts move the plane along -n, hence the sign flip.
        const nextDepth = gizmoDrag.startDepth - along / gizmoDrag.info.pxPerUnit;
        interactionRef.current?.onDepthDrag?.(nextDepth);
        event.preventDefault();
        return;
      }

      if (gizmoDrag?.kind === "group-translate" || gizmoDrag?.kind === "group-scale") {
        const { x, y } = canvasPoint(event);
        const along = (x - gizmoDrag.startX) * gizmoDrag.info.dirX + (y - gizmoDrag.startY) * gizmoDrag.info.dirY;
        const nextValue = gizmoDrag.kind === "group-scale"
          ? Math.max(
            gizmoDrag.info.minScale,
            gizmoDrag.startValue
              + (gizmoDrag.info.region === "crown" ? 1 : -1) * along / gizmoDrag.info.pxPerUnit / Math.max(gizmoDrag.info.baseHeight, 1e-6),
          )
          : clamp(
            gizmoDrag.startValue + along / gizmoDrag.info.pxPerUnit,
            gizmoDrag.info.minDelta,
            gizmoDrag.info.maxDelta,
          );
        if (gizmoDrag.kind === "group-scale") interactionRef.current?.onGroupScaleDrag?.(nextValue);
        else interactionRef.current?.onGroupDeltaDrag?.(nextValue);
        event.preventDefault();
        return;
      }

      if (gizmoDrag?.kind === "group-rotate") {
        const { x, y } = canvasPoint(event);
        const nextRotation = indexAtScreenPoint(x, y, gizmoDrag.ring);
        if (nextRotation !== null) interactionRef.current?.onGroupRotationDrag?.(nextRotation);
        event.preventDefault();
        return;
      }

      if (gizmoDrag?.kind === "angle") {
        const { x, y } = canvasPoint(event);
        const nextAngle = angleAtScreenPoint(x, y, gizmoDrag.arc);
        if (nextAngle !== null) interactionRef.current?.onAngleDrag?.(nextAngle);
        event.preventDefault();
        return;
      }

      if (gizmoDrag?.kind === "index") {
        const { x, y } = canvasPoint(event);
        const nextIndex = indexAtScreenPoint(x, y, gizmoDrag.ring);
        if (nextIndex !== null) interactionRef.current?.onIndexDrag?.(nextIndex);
        event.preventDefault();
        return;
      }

      if (gizmoDrag?.kind === "mirror") {
        const { x, y } = canvasPoint(event);
        const nextMirror = mirrorAtScreenPoint(x, y, gizmoDrag.ring);
        if (nextMirror !== null) interactionRef.current?.onMirrorDrag?.(nextMirror);
        event.preventDefault();
        return;
      }

      const camera = cameraRef.current;
      if (event.shiftKey) {
        camera.targetPanX += movedX;
        camera.targetPanY += movedY;
      } else {
        camera.targetYaw += movedX * 0.008;
        camera.targetPitch = clamp(camera.targetPitch + movedY * 0.008, -1.48, 1.48);
        if (sceneRef.current.viewMode !== "perspective") {
          requestViewModeRef.current?.("perspective", true);
        }
      }
      event.preventDefault();
      return;
    }

    // Hover picking (no button pressed).
    const scene = sceneRef.current;
    if (!scene.pickingEnabled || !scene.frame) return;
    const { x, y } = canvasPoint(event);
    const groupControls = groupControlsScreenInfo(scene.frame, scene.groupGizmo);
    const groupVisibility = createHelperVisibilityContext(scene);
    const arc = scene.cutGizmo ? angleArcScreenInfo(scene.frame, scene.cutGizmo) : null;
    const depth = scene.cutGizmo ? depthScreenInfo(scene.frame, scene.cutGizmo) : null;
    const indexRing = scene.cutGizmo ? indexRingScreenInfo(scene.frame, scene.cutGizmo) : null;
    if (groupRotationRingHit(x, y, groupControls.rotation, groupVisibility)) {
      canvas.style.cursor = "grab";
      return;
    }
    if (groupControlHit(x, y, groupControls.translate, groupVisibility)) {
      canvas.style.cursor = "ns-resize";
      return;
    }
    if (groupControlHit(x, y, groupControls.scale, groupVisibility)) {
      canvas.style.cursor = "ns-resize";
      return;
    }
    if (mirrorRingKnobHit(x, y, indexRing)) {
      canvas.style.cursor = "grab";
      return;
    }
    if (indexRingKnobHit(x, y, indexRing)) {
      canvas.style.cursor = "grab";
      return;
    }
    if (angleHandleHit(x, y, arc)) {
      canvas.style.cursor = "grab";
      return;
    }
    if (!scene.cutGizmo?.depthLocked && depthHandleHit(x, y, depth)) {
      canvas.style.cursor = "grab";
      return;
    }
    if (mirrorRingHandleHit(x, y, indexRing)) {
      canvas.style.cursor = "grab";
      return;
    }
    if (indexRingHandleHit(x, y, indexRing)) {
      canvas.style.cursor = "grab";
      return;
    }
    const target = pickSceneTarget(x, y, scene);
    canvas.style.cursor = target?.kind === "face" || (["vertex", "edge"].includes(target?.kind) && scene.meetPickEnabled) ? "pointer" : "";
  };

  const onWheel = (event) => {
    const camera = cameraRef.current;
    camera.targetZoom = clamp(
      camera.targetZoom * Math.exp(-Number(event.deltaY || 0) * 0.0012),
      0.48,
      2.8,
    );
    event.preventDefault();
  };

  const onDoubleClick = (event) => {
    resetCamera(cameraRef.current, sceneRef.current.viewMode);
    event.preventDefault();
  };

  const onKeyDown = (event) => {
    const camera = cameraRef.current;
    const isPan = event.shiftKey;
    let handled = true;
    let changesOrbit = false;

    switch (event.key) {
      case "ArrowLeft":
        if (isPan) camera.targetPanX -= 14;
        else { camera.targetYaw -= 0.12; changesOrbit = true; }
        break;
      case "ArrowRight":
        if (isPan) camera.targetPanX += 14;
        else { camera.targetYaw += 0.12; changesOrbit = true; }
        break;
      case "ArrowUp":
        if (isPan) camera.targetPanY -= 14;
        else { camera.targetPitch = clamp(camera.targetPitch - 0.1, -1.48, 1.48); changesOrbit = true; }
        break;
      case "ArrowDown":
        if (isPan) camera.targetPanY += 14;
        else { camera.targetPitch = clamp(camera.targetPitch + 0.1, -1.48, 1.48); changesOrbit = true; }
        break;
      case "+":
      case "=":
        camera.targetZoom = clamp(camera.targetZoom * 1.12, 0.48, 2.8);
        break;
      case "-":
      case "_":
        camera.targetZoom = clamp(camera.targetZoom / 1.12, 0.48, 2.8);
        break;
      case "0":
      case "Home":
        resetCamera(camera, sceneRef.current.viewMode);
        break;
      default:
        handled = false;
    }

    if (changesOrbit && sceneRef.current.viewMode !== "perspective") {
      requestViewModeRef.current?.("perspective", true);
    }
    if (handled) event.preventDefault();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDoubleClick);
  canvas.addEventListener("keydown", onKeyDown);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", endPointer);
    canvas.removeEventListener("pointercancel", endPointer);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDoubleClick);
    canvas.removeEventListener("keydown", onKeyDown);
  };
}

export function GemViewport({
  polyhedron,
  meetPolyhedron = null,
  previewPlanes = [],
  selectedIndex = 0,
  viewMode = "perspective",
  onViewModeChange,
  renderMode = "solid",
  resetSignal,
  highlightOperationId = null,
  activeOperationId = null,
  previewOperationId = null,
  pickingEnabled = false,
  cutGizmo = null,
  groupGizmo = null,
  onFacePick,
  meetTargets = [],
  meetPickEnabled = false,
  constructionMarkers = [],
  nextJumpMarker = null,
  onVertexPick,
  onDepthDrag,
  onAngleDrag,
  onIndexDrag,
  onMirrorDrag,
  onGroupDeltaDrag,
  onGroupScaleDrag,
  onGroupRotationDrag,
  suspended = false,
}) {
  const hostRef = useRef(null);
  const cameraRef = useRef(createCamera());
  const sceneRef = useRef({});
  const requestViewModeRef = useRef(null);
  const interactionRef = useRef(null);
  const gizmoLabelCanvasRef = useRef(null);
  const instanceRef = useRef(null);
  const normalizedGeometry = useMemo(() => normalizeGeometry(polyhedron), [polyhedron]);
  const normalizedMeetGeometry = useMemo(
    () => normalizeGeometry(meetPolyhedron ?? polyhedron),
    [meetPolyhedron, polyhedron],
  );
  const hasExplicitGeometry = Array.isArray(polyhedron?.vertices) && Array.isArray(polyhedron?.faces);
  const ghostBoundsRef = useRef(null);
  const initialMode = VIEW_POSES[viewMode] ? viewMode : "perspective";
  const [activeViewMode, setActiveViewMode] = useState(initialMode);

  interactionRef.current = {
    onFacePick,
    onVertexPick,
    onDepthDrag,
    onAngleDrag,
    onIndexDrag,
    onMirrorDrag,
    onGroupDeltaDrag,
    onGroupScaleDrag,
    onGroupRotationDrag,
  };

  const requestViewMode = useCallback((nextMode, fromCanvas = false) => {
    if (!VIEW_POSES[nextMode]) return;
    if (fromCanvas) cameraRef.current.suppressNextPose = true;
    setActiveViewMode(nextMode);
    onViewModeChange?.(nextMode);
  }, [onViewModeChange]);

  useLayoutEffect(() => {
    requestViewModeRef.current = requestViewMode;
  }, [requestViewMode]);

  useLayoutEffect(() => {
    // Mutate in place: transient picking state (frame/activeGizmo)
    // is owned by the interaction handlers and must survive re-renders.
    Object.assign(sceneRef.current, {
      geometry: normalizedGeometry,
      meetGeometry: normalizedMeetGeometry,
      faces: normalizedGeometry.faces,
      previewPlanes: Array.isArray(previewPlanes) ? previewPlanes : [],
      selectedIndex,
      viewMode: activeViewMode,
      renderMode,
      highlightOperationId,
      activeOperationId,
      previewOperationId,
      pickingEnabled,
      meetTargets,
      meetPickEnabled,
      constructionMarkers,
      nextJumpMarker,
      cutGizmo,
      groupGizmo,
      suspended,
    });
    if (hasExplicitGeometry && (!ghostBoundsRef.current || isStockGeometry(polyhedron, normalizedGeometry))) {
      ghostBoundsRef.current = copyBounds(normalizedGeometry.bounds);
    }
  }, [activeOperationId, activeViewMode, constructionMarkers, cutGizmo, groupGizmo, hasExplicitGeometry, highlightOperationId, meetPickEnabled, meetTargets, nextJumpMarker, normalizedGeometry, normalizedMeetGeometry, pickingEnabled, polyhedron, previewOperationId, previewPlanes, renderMode, selectedIndex, suspended]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    if (suspended) instance.noLoop();
    else instance.loop();
  }, [suspended]);

  useEffect(() => {
    const nextMode = VIEW_POSES[viewMode] ? viewMode : "perspective";
    setActiveViewMode(nextMode);
  }, [viewMode]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (camera.suppressNextPose) {
      camera.suppressNextPose = false;
      return;
    }
    setCameraPose(camera, activeViewMode);
  }, [activeViewMode]);

  useEffect(() => {
    resetCamera(cameraRef.current, activeViewMode);
  }, [resetSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let detachInteractions = () => {};
    let cancelled = false;
    let instance = null;
    let resizeObserver = null;

    const sketch = (p) => {
      let renderer;

      p.setup = () => {
        const width = Math.max(320, Math.round(host.clientWidth || 720));
        const height = Math.max(320, Math.round(host.clientHeight || 520));
        p.pixelDensity(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer = p.createCanvas(width, height, p.WEBGL);
        renderer.parent(host);
        renderer.elt.setAttribute("tabindex", "0");
        renderer.elt.setAttribute("role", "application");
        renderer.elt.setAttribute(
          "aria-label",
          "三维宝石视口。拖拽或方向键旋转，Shift 加拖拽或方向键平移，滚轮或加减键缩放，0 键复位。拖动外分度环调整索引，拖动内环调整镜像轴偏移，拖动蓝色弧形桥架调整行业角，拖动粉色伸缩杆调整深度；群组操纵杆可拖动紫色升降面、青绿色高度比例面和暖金色 96 分度旋转环。",
        );
        renderer.elt.setAttribute("data-testid", "gem-webgl-canvas");
        detachInteractions = attachViewportInteractions(
          renderer.elt,
          cameraRef,
          sceneRef,
          requestViewModeRef,
          interactionRef,
        );
        p.colorMode(p.RGB, 255, 255, 255, 255);
        p.frameRate(60);
      };

      p.draw = () => {
        const { geometry, previewPlanes: planes, selectedIndex: index, viewMode: mode, renderMode: displayMode } = sceneRef.current;
        const camera = cameraRef.current;
        const ghostBounds = ghostBoundsRef.current ?? geometry.bounds;
        camera.yaw += (camera.targetYaw - camera.yaw) * 0.16;
        camera.pitch += (camera.targetPitch - camera.pitch) * 0.16;
        camera.zoom += (camera.targetZoom - camera.zoom) * 0.16;
        camera.panX += (camera.targetPanX - camera.panX) * 0.18;
        camera.panY += (camera.targetPanY - camera.panY) * 0.18;

        p.background(255);
        const fieldOfView = p.radians(38);
        const cameraDistance = (p.height / 2) / Math.tan(fieldOfView / 2);
        p.camera(0, 0, cameraDistance, 0, 0, 0, 0, 1, 0);
        if (mode === "perspective") {
          p.perspective(fieldOfView, p.width / Math.max(p.height, 1), 1, Math.max(5000, cameraDistance * 8));
        } else {
          // Negative near distances flip ortho depth ordering (bottom faces
          // render on top); the camera is always far from the scene, so a
          // small positive near plane is safe.
          p.ortho(-p.width / 2, p.width / 2, -p.height / 2, p.height / 2, 1, Math.max(5000, cameraDistance * 8));
        }

        p.ambientLight(218, 221, 222);
        p.directionalLight(255, 250, 247, -0.42, 0.58, -1);
        p.directionalLight(160, 185, 214, 0.78, -0.3, 0.4);

        const sceneScale = calculateSceneScale(p.width, p.height, ghostBounds);
        // p5 WebGL stroke weights are already screen-space pixels. Keep the
        // technical linework stable instead of thickening it as the model
        // zooms out or thinning it as the model zooms in.
        const lineWeight = 1;
        p.push();
        p.translate(camera.panX, camera.panY, 0);
        p.scale(camera.zoom);
        p.rotateX(camera.pitch);
        p.rotateY(camera.yaw);

        if (displayMode === "xray") drawGhostCube(p, ghostBounds, sceneScale, lineWeight);
        // Solid first so preview planes are correctly occluded by geometry;
        // patches never write depth, they only tint what the camera can see.
        drawPolyhedron(p, geometry, sceneScale, lineWeight, camera.yaw, camera.pitch, displayMode, sceneRef.current.highlightOperationId, sceneRef.current.activeOperationId, sceneRef.current.previewOperationId);
        drawPreviewPlanes(p, planes, index, ghostBounds, sceneScale, lineWeight, displayMode);
        drawGroupControlPlane(p, sceneRef.current.groupGizmo, sceneScale, lineWeight);
        drawAxis(p, ghostBounds, sceneScale, lineWeight, displayMode);

        // Capture live matrices so screen-space picking matches what is drawn.
        const glRenderer = p._renderer;
        sceneRef.current.frame = {
          mv: [...glRenderer.uMVMatrix.mat4],
          pr: [...glRenderer.uPMatrix.mat4],
          width: p.width,
          height: p.height,
          scale: sceneScale,
          perspective: mode === "perspective",
          pitch: camera.pitch,
        };
        p.pop();
        if (sceneRef.current.pickingEnabled) drawPickOverlay(p, sceneRef.current);
        drawOrientationGizmo(p, camera);
        drawGizmoLabels(gizmoLabelCanvasRef.current, sceneRef.current);
      };
    };

    (async () => {
      let p5;
      try {
        ({ default: p5 } = await import("p5"));
      } catch (error) {
        console.error("加载 p5 视口渲染器失败：", error);
        return;
      }
      if (cancelled) return;
      instance = new p5(sketch);
      instanceRef.current = instance;
      if (sceneRef.current.suspended) instance.noLoop();
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry || !instance.canvas) return;
        const width = Math.max(320, Math.round(entry.contentRect.width));
        const height = Math.max(320, Math.round(entry.contentRect.height));
        if (width !== instance.width || height !== instance.height) {
          instance.resizeCanvas(width, height, false);
        }
      });
      resizeObserver.observe(host);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      detachInteractions();
      instanceRef.current = null;
      instance?.remove();
    };
  }, []);

  return (
    <section className="gem-viewport" aria-label="宝石多面体三维视口">
      <div className="gem-viewport__canvas" ref={hostRef} />

      <canvas className="gem-viewport__gizmo-labels" ref={gizmoLabelCanvasRef} aria-hidden="true" />

      <div className="gem-viewport__interaction-hints" aria-label="视口操作提示">
        <span><IconRotate3d size={16} stroke={1.7} />拖拽旋转</span>
        <span><IconZoomIn size={16} stroke={1.7} />滚轮缩放</span>
        <span><IconHandMove size={16} stroke={1.7} />Shift + 拖拽平移</span>
      </div>
    </section>
  );
}
