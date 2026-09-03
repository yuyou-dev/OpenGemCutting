import { displayIndex, FACET_REGION_LABELS, FACET_REGION_PREFIXES } from "../domain/faceting.js";
import { downloadBlob } from "../utils/download.js";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 38;
const REGION_ORDER = ["pavilion", "girdle", "crown"];
const REGION_ENGLISH = { pavilion: "PAVILION", crown: "CROWN", girdle: "GIRDLE" };
const REGION_LABELS = Object.fromEntries(
  REGION_ORDER.map((region) => [region, `${FACET_REGION_LABELS[region]} ${REGION_ENGLISH[region]}`]),
);
const REGION_SHORT = FACET_REGION_LABELS;
const COLOR = {
  accent: [0.937, 0.247, 0.447], ink: [0.094, 0.106, 0.114], muted: [0.43, 0.46, 0.49],
  rule: [0.84, 0.85, 0.86], soft: [0.965, 0.968, 0.97], white: [1, 1, 1],
};

function fixed(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "-";
}

function boundsOf(vertices) {
  if (!vertices.length) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  vertices.forEach((vertex) => {
    for (const axis of ["x", "y", "z"]) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  });
  return { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
}

function groupFacets(facets) {
  const groups = new Map();
  facets.forEach((facet) => {
    if (!groups.has(facet.patternId)) groups.set(facet.patternId, []);
    groups.get(facet.patternId).push(facet);
  });
  const counters = { crown: 0, girdle: 0, pavilion: 0 };
  return [...groups.values()].map((group) => {
    const first = group[0];
    counters[first.region] += 1;
    const prefix = FACET_REGION_PREFIXES[first.region];
    return {
      id: first.patternId,
      label: first.label || `${prefix}${counters[first.region]} ${REGION_SHORT[first.region]}`,
      region: first.region,
      repeat: first.repeat,
      mirror: first.mirror,
      facets: [...group].sort((a, b) => displayIndex(a.index) - displayIndex(b.index)),
    };
  });
}

export function createFacetReportModel({ document, solid, metrics, generatedAt = new Date(), includeGirdle = true }) {
  const groups = groupFacets(document.facets);
  const bounds = boundsOf(solid.vertices);
  const girdleGroups = groups.filter((group) => group.region === "girdle");
  const girdleFacetCount = girdleGroups.reduce((sum, group) => sum + group.facets.length, 0);
  const includedRegions = includeGirdle ? REGION_ORDER : REGION_ORDER.filter((region) => region !== "girdle");
  const regions = includedRegions.map((region) => {
    const regionGroups = groups.filter((group) => group.region === region).map((group) => ({
      ...group,
      rows: group.facets.map((facet, index) => ({
        group: group.label,
        face: `${index + 1}`,
        index: String(displayIndex(facet.index)).padStart(2, "0"),
        industryAngle: `${fixed(facet.industryAngleDeg, 2)}°`,
        beta: `${facet.betaDeg > 0 ? "+" : ""}${fixed(facet.betaDeg, 2)}°`,
        depth: fixed(facet.depth, 3),
        azimuth: `${fixed(facet.azimuthDeg, 2)}°`,
        plane: `n(${fixed(facet.plane.normal.x, 3)}, ${fixed(facet.plane.normal.y, 3)}, ${fixed(facet.plane.normal.z, 3)}) d=${fixed(facet.plane.offset, 3)}`,
      })),
    }));
    return {
      id: region,
      label: REGION_LABELS[region],
      groups: regionGroups,
      facetCount: regionGroups.reduce((sum, group) => sum + group.facets.length, 0),
      rows: regionGroups.flatMap((group) => group.rows),
    };
  });
  const width = Math.max(bounds.size.y, 1e-9);
  return {
    name: document.name, stock: document.stock,
    generatedAt: generatedAt.toLocaleString("zh-CN", { hour12: false }),
    facetCount: document.facets.length, operationCount: groups.length, faceCount: metrics.faces.length,
    exportedFacetCount: document.facets.length - (includeGirdle ? 0 : girdleFacetCount),
    includeGirdle,
    girdleSummary: { groupCount: girdleGroups.length, facetCount: girdleFacetCount },
    volume: metrics.volume, surfaceArea: metrics.surfaceArea, centroid: metrics.centroid,
    bounds, solid, regions,
    operationCodes: Object.fromEntries(groups.map((group) => [group.id, group.label.split(/\s+/)[0]])),
    ratios: {
      lengthWidth: bounds.size.x / width,
      heightWidth: bounds.size.z / width,
      volumeWidth3: metrics.volume / (width ** 3),
      areaWidth2: metrics.surfaceArea / (width ** 2),
    },
  };
}

export function buildFacetReportPages(model) {
  const pages = [{ kind: "cover", pageNumber: 1 }];
  model.regions.forEach((region) => {
    region.groups.forEach((group) => {
      const chunks = [];
      for (let index = 0; index < group.rows.length; index += 18) chunks.push(group.rows.slice(index, index + 18));
      chunks.forEach((rows, index) => pages.push({
        kind: "group", region, group, rows, part: index + 1, parts: chunks.length, pageNumber: pages.length + 1,
      }));
    });
  });
  return pages;
}

function viewAxis(axes) {
  return ["x", "y", "z"].find((axis) => !axes.includes(axis));
}

// The table is the topmost horizontal (+z) face: after the fixed T1 table cut
// the original cube cap is gone, so match by elevation, not by missing source.
export function findTableFace(solid) {
  const zOf = (face) => face.vertexIndices.reduce((sum, index) => sum + solid.vertices[index].z, 0) / face.vertexIndices.length;
  return solid.faces
    .filter((face) => (face.normal?.z || 0) > 0.999)
    .sort((a, b) => zOf(b) - zOf(a))[0];
}

function isFaceVisible(face, visibility) {
  if (!visibility) return true;
  if (visibility.vector) {
    const normal = face.normal || {};
    return ((normal.x || 0) * visibility.vector.x
      + (normal.y || 0) * visibility.vector.y
      + (normal.z || 0) * visibility.vector.z) > 1e-6;
  }
  return (face.normal?.[visibility.axis] || 0) * visibility.sign > 1e-6;
}

function vectorEdges(solid, visibility) {
  const edges = new Set();
  solid.faces.filter((face) => isFaceVisible(face, visibility)).forEach((face) => face.vertexIndices.forEach((start, index) => {
    const end = face.vertexIndices[(index + 1) % face.vertexIndices.length];
    edges.add(start < end ? `${start}:${end}` : `${end}:${start}`);
  }));
  return [...edges].map((edge) => edge.split(":").map(Number));
}

function fitProjection(solid, axes, box, visibility, basis) {
  const vertices = solid.vertices;
  if (!vertices.length) return { points: [], edges: [] };
  const horizontalValue = basis
    ? (vertex) => vertex.x * basis.horizontal.x + vertex.y * basis.horizontal.y + vertex.z * basis.horizontal.z
    : (vertex) => vertex[axes[0]];
  const verticalValue = basis
    ? (vertex) => vertex.x * basis.vertical.x + vertex.y * basis.vertical.y + vertex.z * basis.vertical.z
    : (vertex) => vertex[axes[1]];
  const xs = vertices.map(horizontalValue);
  const ys = vertices.map(verticalValue);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = Math.min(box.width / Math.max(maxX - minX, 1e-6), box.height / Math.max(maxY - minY, 1e-6));
  const project = (vertex) => ({
      x: box.x + box.width / 2 + (horizontalValue(vertex) - (minX + maxX) / 2) * scale,
      y: box.y + box.height / 2 + (verticalValue(vertex) - (minY + maxY) / 2) * scale,
    });
  return {
    points: vertices.map(project), edges: vectorEdges(solid, visibility), project,
    center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    bounds: {
      minX: box.x + box.width / 2 + (minX - (minX + maxX) / 2) * scale,
      maxX: box.x + box.width / 2 + (maxX - (minX + maxX) / 2) * scale,
      minY: box.y + box.height / 2 + (minY - (minY + maxY) / 2) * scale,
      maxY: box.y + box.height / 2 + (maxY - (minY + maxY) / 2) * scale,
    },
  };
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法载入 PDF 资源：${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function rgbOf(rgb, value) { return rgb(...value); }
function drawTextTop(page, text, x, top, options) { page.drawText(String(text), { ...options, x, y: A4.height - top - options.size }); }
function drawRectTop(page, x, top, width, height, options) { page.drawRectangle({ ...options, x, y: A4.height - top - height, width, height }); }
function drawLineTop(page, start, end, options) {
  page.drawLine({ ...options, start: { x: start.x, y: A4.height - start.y }, end: { x: end.x, y: A4.height - end.y } });
}

function drawHeader(page, model, assets, section, pageNumber) {
  const { font, bold, latin, rgb, logo } = assets;
  if (logo) page.drawImage(logo, { x: MARGIN, y: A4.height - 45, width: 30, height: 30 });
  drawTextTop(page, "切磨工作台", MARGIN + 38, 20, { font: bold, size: 12.5, color: rgbOf(rgb, COLOR.ink) });
  drawTextTop(page, "SUVA  ·  FACET 96", MARGIN + 38, 39, { font: latin, size: 6.2, color: rgbOf(rgb, COLOR.muted) });
  const sectionWidth = font.widthOfTextAtSize(section, 7.2);
  drawTextTop(page, section, A4.width - MARGIN - sectionWidth, 21, { font, size: 7.2, color: rgbOf(rgb, COLOR.ink) });
  const reportCode = `TECHNICAL REPORT  /  ${String(pageNumber).padStart(2, "0")}`;
  drawTextTop(page, reportCode, A4.width - MARGIN - latin.widthOfTextAtSize(reportCode, 5.7), 41, { font: latin, size: 5.7, color: rgbOf(rgb, COLOR.muted) });
  drawLineTop(page, { x: MARGIN, y: 66 }, { x: A4.width - MARGIN, y: 66 }, { thickness: 0.75, color: rgbOf(rgb, COLOR.ink) });
  drawLineTop(page, { x: MARGIN, y: 802 }, { x: A4.width - MARGIN, y: 802 }, { thickness: 0.35, color: rgbOf(rgb, COLOR.rule) });
  drawTextTop(page, `${model.name}  /  ${model.generatedAt}`, MARGIN, 812, { font, size: 5.8, color: rgbOf(rgb, COLOR.muted) });
  const footerNumber = String(pageNumber).padStart(2, "0");
  drawTextTop(page, footerNumber, A4.width - MARGIN - latin.widthOfTextAtSize(footerNumber, 5.8), 812, { font: latin, size: 5.8, color: rgbOf(rgb, COLOR.muted) });
}

function drawObjectDimension(page, start, end, objectStart, objectEnd, label, vertical, assets) {
  const { latin, rgb, degrees } = assets;
  const ink = rgbOf(rgb, COLOR.ink);
  const rule = rgbOf(rgb, COLOR.rule);
  page.drawLine({ start: objectStart, end: start, thickness: 0.35, color: rule });
  page.drawLine({ start: objectEnd, end, thickness: 0.35, color: rule });
  page.drawLine({ start, end, thickness: 0.65, color: ink });
  const arrow = 4.2;
  if (vertical) {
    page.drawLine({ start, end: { x: start.x - 2.2, y: start.y + arrow }, thickness: 0.7, color: ink });
    page.drawLine({ start, end: { x: start.x + 2.2, y: start.y + arrow }, thickness: 0.7, color: ink });
    page.drawLine({ start: end, end: { x: end.x - 2.2, y: end.y - arrow }, thickness: 0.7, color: ink });
    page.drawLine({ start: end, end: { x: end.x + 2.2, y: end.y - arrow }, thickness: 0.7, color: ink });
    const width = latin.widthOfTextAtSize(label, 6.6);
    page.drawText(label, {
      x: start.x - 10, y: (start.y + end.y) / 2 - width / 2,
      font: latin, size: 6.6, rotate: degrees(90), color: ink,
    });
  } else {
    page.drawLine({ start, end: { x: start.x + arrow, y: start.y - 2.2 }, thickness: 0.7, color: ink });
    page.drawLine({ start, end: { x: start.x + arrow, y: start.y + 2.2 }, thickness: 0.7, color: ink });
    page.drawLine({ start: end, end: { x: end.x - arrow, y: end.y - 2.2 }, thickness: 0.7, color: ink });
    page.drawLine({ start: end, end: { x: end.x - arrow, y: end.y + 2.2 }, thickness: 0.7, color: ink });
    const width = latin.widthOfTextAtSize(label, 6.6);
    page.drawRectangle({ x: (start.x + end.x - width) / 2 - 3, y: start.y - 4, width: width + 6, height: 9, color: rgbOf(rgb, COLOR.white) });
    page.drawText(label, { x: (start.x + end.x - width) / 2, y: start.y - 2.3, font: latin, size: 6.6, color: ink });
  }
}

function drawProjectionAnnotations(page, model, projection, axes, options, assets) {
  const { latin, latinBold, rgb } = assets;
  if (options.showFaceLabels) {
    const facesByOperation = new Map();
    model.solid.faces.filter((face) => isFaceVisible(face, options.visibility)).forEach((face) => {
      if (!face.sourceOperationId) return;
      const vertices = face.vertexIndices.map((index) => model.solid.vertices[index]);
      const centroid = vertices.reduce((sum, vertex) => ({
        x: sum.x + vertex.x / vertices.length,
        y: sum.y + vertex.y / vertices.length,
        z: sum.z + vertex.z / vertices.length,
      }), { x: 0, y: 0, z: 0 });
      const point = projection.project(centroid);
      const candidate = { point, score: axes[1] === "z" ? -Math.abs(point.x - projection.center.x) : point.y };
      const existing = facesByOperation.get(face.sourceOperationId);
      if (!existing || candidate.score > existing.score) facesByOperation.set(face.sourceOperationId, candidate);
    });
    let labelIndex = 0;
    facesByOperation.forEach(({ point }, operationId) => {
      const label = model.operationCodes[operationId] || operationId;
      const size = 5.8;
      const offsetX = axes[1] === "z" ? 0 : [-10, 0, 10][labelIndex % 3];
      const annotationPoint = axes[1] === "z" ? point : {
        x: projection.center.x + (point.x - projection.center.x) * 0.76,
        y: projection.center.y + (point.y - projection.center.y) * 0.76,
      };
      page.drawText(label, {
        x: annotationPoint.x + offsetX - latinBold.widthOfTextAtSize(label, size) / 2, y: annotationPoint.y - size / 2,
        font: latinBold, size, color: rgbOf(rgb, COLOR.muted),
      });
      labelIndex += 1;
    });
  }
  if (options.showIndices) {
    const source = model.regions.flatMap((region) => region.groups).find((group) => group.facets.length)?.facets || [];
    const labels = source.length > 12 ? source.filter((_, index) => index % Math.ceil(source.length / 12) === 0) : source;
    labels.forEach((facet) => {
      const radians = facet.azimuthDeg * Math.PI / 180;
      const radiusX = options.indexRadiusX;
      const radiusY = options.indexRadiusY;
      // Facet normals use (cos θ, sin θ) in the x/y plane; keep the index ring
      // radially aligned with the facet it labels.
      const x = projection.center.x + Math.cos(radians) * radiusX;
      const y = projection.center.y + Math.sin(radians) * radiusY;
      const label = String(displayIndex(facet.index));
      page.drawText(label, {
        x: x - latin.widthOfTextAtSize(label, 5.1) / 2, y: y - 2.5,
        font: latin, size: 5.1, color: rgbOf(rgb, COLOR.muted),
      });
    });
  }
}

function drawProjection(page, model, config, assets) {
  const { font, bold, latin, rgb } = assets;
  const {
    x, top, width, height, title, subtitle, axes, basis, horizontalLabel, verticalLabel,
    showFaceLabels = false, showIndices = false, viewSign = 1, showTableWidth = false,
    highlightOperationId = null,
  } = config;
  drawRectTop(page, x, top, width, height, { borderWidth: 0.6, borderColor: rgbOf(rgb, COLOR.rule), color: rgbOf(rgb, COLOR.white) });
  drawTextTop(page, title, x + 10, top + 8, { font: bold, size: 7, color: rgbOf(rgb, COLOR.ink) });
  if (subtitle) drawTextTop(page, subtitle, x + width - 10 - latin.widthOfTextAtSize(subtitle, 5.2), top + 10, { font: latin, size: 5.2, color: rgbOf(rgb, COLOR.muted) });
  const box = { x: x + 34, y: A4.height - top - height + 30, width: width - 52, height: height - 52 };
  const visibility = basis ? { vector: basis.view } : { axis: viewAxis(axes), sign: viewSign };
  const projection = fitProjection(model.solid, axes, box, visibility, basis);
  if (highlightOperationId) {
    model.solid.faces
      .filter((face) => face.sourceOperationId === highlightOperationId && isFaceVisible(face, visibility))
      .forEach((face) => {
        const points = face.vertexIndices.map((index) => projection.points[index]);
        if (points.length < 3) return;
        const path = `${points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${(A4.height - point.y).toFixed(2)}`).join(" ")} Z`;
        page.drawSvgPath(path, {
          y: A4.height,
          color: rgbOf(rgb, COLOR.accent),
          borderColor: rgbOf(rgb, COLOR.accent),
          borderWidth: 0.7,
          opacity: 0.24,
          borderOpacity: 0.95,
        });
      });
  }
  projection.edges.forEach(([a, b]) => page.drawLine({ start: projection.points[a], end: projection.points[b], thickness: 0.52, color: rgbOf(rgb, COLOR.ink) }));
  page.drawLine({
    start: { x: box.x + box.width / 2, y: box.y - 5 }, end: { x: box.x + box.width / 2, y: box.y + box.height + 5 },
    thickness: 0.35, color: rgbOf(rgb, COLOR.rule), dashArray: [3, 3],
  });
  drawProjectionAnnotations(page, model, projection, axes || [], {
    showFaceLabels, showIndices, visibility,
    indexRadiusX: box.width / 2 + 2, indexRadiusY: box.height / 2 + 2,
  }, assets);
  if (horizontalLabel) {
    const y = projection.bounds.minY - 12;
    drawObjectDimension(page,
      { x: projection.bounds.minX, y }, { x: projection.bounds.maxX, y },
      { x: projection.bounds.minX, y: projection.bounds.minY }, { x: projection.bounds.maxX, y: projection.bounds.minY },
      horizontalLabel, false, assets);
  }
  if (verticalLabel) {
    const xPosition = projection.bounds.minX - 12;
    drawObjectDimension(page,
      { x: xPosition, y: projection.bounds.minY }, { x: xPosition, y: projection.bounds.maxY },
      { x: projection.bounds.minX, y: projection.bounds.minY }, { x: projection.bounds.minX, y: projection.bounds.maxY },
      verticalLabel, true, assets);
  }
  if (showTableWidth && axes[1] === "z") {
    const tableFace = findTableFace(model.solid);
    if (tableFace) {
      const tablePoints = tableFace.vertexIndices.map((index) => projection.points[index]);
      const min = tablePoints.reduce((best, point) => point.x < best.x ? point : best, tablePoints[0]);
      const max = tablePoints.reduce((best, point) => point.x > best.x ? point : best, tablePoints[0]);
      const horizontalAxis = axes[0];
      const values = tableFace.vertexIndices.map((index) => model.solid.vertices[index][horizontalAxis]);
      const label = `T ${fixed(Math.max(...values) - Math.min(...values), 3)}`;
      const y = Math.max(...tablePoints.map((point) => point.y)) + 10;
      drawObjectDimension(page, { x: min.x, y }, { x: max.x, y }, min, max, label, false, assets);
    }
  }
}

function drawSpecRow(page, x, top, width, label, value, assets, accent = false) {
  const { font, latin, latinBold, rgb } = assets;
  drawLineTop(page, { x, y: top + 17 }, { x: x + width, y: top + 17 }, { thickness: 0.35, color: rgbOf(rgb, COLOR.rule) });
  drawTextTop(page, label, x, top + 3, { font, size: 5.7, color: rgbOf(rgb, COLOR.muted) });
  const valueFont = /^[\d+\-.,:/ A-Z²³]+$/.test(value) ? latinBold : font;
  drawTextTop(page, value, x + width - valueFont.widthOfTextAtSize(value, 6.5), top + 2, {
    font: valueFont, size: 6.5, color: rgbOf(rgb, accent ? COLOR.accent : COLOR.ink),
  });
}

function drawCover(page, model, assets, pageNumber) {
  const { font, bold, latinBold, rgb } = assets;
  drawHeader(page, model, assets, "切型技术报告", pageNumber);
  drawTextTop(page, "FACETING DESIGN DOSSIER  /  96 INDEX", MARGIN, 88, { font: latinBold, size: 6.8, color: rgbOf(rgb, COLOR.accent) });
  drawTextTop(page, model.name, MARGIN, 106, { font: bold, size: 22, color: rgbOf(rgb, COLOR.ink) });
  drawTextTop(page, "精密切型技术图谱 · 尺寸比例 · 切面编号 · 逐面参数", MARGIN, 138, { font, size: 7.2, color: rgbOf(rgb, COLOR.muted) });
  drawRectTop(page, MARGIN, 158, 519, 2.4, { color: rgbOf(rgb, COLOR.accent) });

  drawTextTop(page, "ORTHOGRAPHIC STUDY  /  正投影技术图", MARGIN, 176, { font: bold, size: 6.2, color: rgbOf(rgb, COLOR.ink) });
  const gap = 8;
  const wideDiagramWidth = (A4.width - MARGIN * 2 - gap) / 2;
  const narrowDiagramWidth = (A4.width - MARGIN * 2 - gap * 2) / 3;
  const sqrt2 = Math.sqrt(2);
  const sqrt6 = Math.sqrt(6);
  const sqrt3 = Math.sqrt(3);
  drawProjection(page, model, {
    x: MARGIN, top: 190, width: narrowDiagramWidth, height: 158, title: "斜45°标准视图 / 45°", subtitle: "OPAQUE",
    basis: {
      horizontal: { x: 1 / sqrt2, y: -1 / sqrt2, z: 0 },
      vertical: { x: -1 / sqrt6, y: -1 / sqrt6, z: 2 / sqrt6 },
      view: { x: 1 / sqrt3, y: 1 / sqrt3, z: 1 / sqrt3 },
    },
    showFaceLabels: true,
  }, assets);
  drawProjection(page, model, {
    x: MARGIN + narrowDiagramWidth + gap, top: 190, width: narrowDiagramWidth, height: 158, title: "顶面视图 / TOP", subtitle: "OPAQUE +Z",
    axes: ["x", "y"], horizontalLabel: `L ${fixed(model.bounds.size.x, 3)}`,
    verticalLabel: `W ${fixed(model.bounds.size.y, 3)}`, showIndices: true, showFaceLabels: true, viewSign: 1,
  }, assets);
  drawProjection(page, model, {
    x: MARGIN + (narrowDiagramWidth + gap) * 2, top: 190, width: narrowDiagramWidth, height: 158, title: "底面视图 / BOTTOM", subtitle: "OPAQUE -Z",
    axes: ["x", "y"], horizontalLabel: `L ${fixed(model.bounds.size.x, 3)}`,
    verticalLabel: `W ${fixed(model.bounds.size.y, 3)}`, showIndices: true, showFaceLabels: true, viewSign: -1,
  }, assets);
  drawProjection(page, model, {
    x: MARGIN, top: 360, width: wideDiagramWidth, height: 158, title: "正面视图 / FRONT", subtitle: "OPAQUE +Y",
    axes: ["x", "z"], horizontalLabel: `L ${fixed(model.bounds.size.x, 3)}`,
    verticalLabel: `H ${fixed(model.bounds.size.z, 3)}`, showFaceLabels: true, viewSign: 1, showTableWidth: true,
  }, assets);
  drawProjection(page, model, {
    x: MARGIN + wideDiagramWidth + gap, top: 360, width: wideDiagramWidth, height: 158, title: "侧面视图 / SIDE", subtitle: "OPAQUE +X",
    axes: ["y", "z"], horizontalLabel: `W ${fixed(model.bounds.size.y, 3)}`,
    verticalLabel: `H ${fixed(model.bounds.size.z, 3)}`, showFaceLabels: true, viewSign: 1, showTableWidth: true,
  }, assets);

  const specWidth = 250;
  drawTextTop(page, "DESIGN SPECIFICATION", MARGIN, 540, { font: latinBold, size: 6.2, color: rgbOf(rgb, COLOR.accent) });
  drawTextTop(page, model.name, MARGIN, 557, { font: bold, size: 12.5, color: rgbOf(rgb, COLOR.ink) });
  drawTextTop(page, "SUVA FACET 96  /  TECHNICAL CUT", MARGIN, 578, { font: latinBold, size: 5.6, color: rgbOf(rgb, COLOR.muted) });
  drawSpecRow(page, MARGIN, 595, specWidth, "分度系统", "96 INDEX", assets, true);
  drawSpecRow(page, MARGIN, 614, specWidth, "记录 / 几何面", `${model.exportedFacetCount} / ${model.faceCount} FACES`, assets);
  drawSpecRow(page, MARGIN, 633, specWidth, "外包尺寸 L / W / H", `${fixed(model.bounds.size.x, 3)} / ${fixed(model.bounds.size.y, 3)} / ${fixed(model.bounds.size.z, 3)}`, assets);
  const ratioX = 307;
  drawTextTop(page, "MEASURED RATIOS", ratioX, 540, { font: latinBold, size: 6.2, color: rgbOf(rgb, COLOR.ink) });
  drawSpecRow(page, ratioX, 557, specWidth, "L / W", fixed(model.ratios.lengthWidth, 3), assets);
  drawSpecRow(page, ratioX, 576, specWidth, "H / W", fixed(model.ratios.heightWidth, 3), assets);
  drawSpecRow(page, ratioX, 595, specWidth, "VOL / W³", fixed(model.ratios.volumeWidth3, 3), assets);
  drawSpecRow(page, ratioX, 614, specWidth, "AREA / W²", fixed(model.ratios.areaWidth2, 3), assets);
  drawSpecRow(page, ratioX, 633, specWidth, "CENTROID Z", fixed(model.centroid.z, 3), assets);

  drawTextTop(page, "FACET STRUCTURE  /  切面结构", MARGIN, 674, { font: bold, size: 6.2, color: rgbOf(rgb, COLOR.ink) });
  model.regions.forEach((region, index) => {
    const x = MARGIN + index * 176;
    drawRectTop(page, x, 690, 166, 53, { color: rgbOf(rgb, index % 2 ? COLOR.white : COLOR.soft), borderColor: rgbOf(rgb, COLOR.rule), borderWidth: 0.35 });
    drawTextTop(page, region.label, x + 10, 700, { font: bold, size: 7, color: rgbOf(rgb, COLOR.ink) });
    drawTextTop(page, `${region.groups.length} GROUPS`, x + 10, 720, { font: assets.latin, size: 5.6, color: rgbOf(rgb, COLOR.muted) });
    const faceLabel = `${region.facetCount} FACES`;
    drawTextTop(page, faceLabel, x + 156 - assets.latinBold.widthOfTextAtSize(faceLabel, 8.5), 715, { font: assets.latinBold, size: 8.5, color: rgbOf(rgb, COLOR.ink) });
  });
  if (!model.includeGirdle && model.girdleSummary.facetCount > 0) {
    const noteX = MARGIN + model.regions.length * 176;
    drawRectTop(page, noteX, 690, 166, 53, { borderColor: rgbOf(rgb, COLOR.rule), borderWidth: 0.35 });
    drawTextTop(page, "腰部 GIRDLE", noteX + 10, 700, { font: bold, size: 7, color: rgbOf(rgb, COLOR.muted) });
    drawTextTop(page, `${model.girdleSummary.facetCount} FACES · 逐面表未导出`, noteX + 10, 720, { font, size: 5.6, color: rgbOf(rgb, COLOR.muted) });
  }
  drawTextTop(page, "DRAWING NOTES", MARGIN, 761, { font: latinBold, size: 5.8, color: rgbOf(rgb, COLOR.ink) });
  drawTextTop(page, "所有视图均为不穿透投影；含斜45°标准视图，尺寸线以双向箭头直接标注外包尺寸和台面宽度 T。", MARGIN, 777, { font, size: 6, color: rgbOf(rgb, COLOR.muted) });
}

function drawGroupAnalysis(page, model, region, group, top, assets) {
  const { font, bold, latin, latinBold, rgb } = assets;
  const diagramWidth = 226;
  const projection = region.id === "girdle"
    ? {
      axes: ["x", "z"], viewSign: 1,
      title: "腰部正视 / GIRDLE FRONT", subtitle: "OPAQUE +Y",
      horizontalLabel: `L ${fixed(model.bounds.size.x, 3)}`,
      verticalLabel: `H ${fixed(model.bounds.size.z, 3)}`,
    }
    : {
      axes: ["x", "y"], viewSign: region.id === "crown" ? 1 : -1,
      title: region.id === "crown" ? "冠部顶视 / CROWN TOP" : "亭部底视 / PAVILION BOTTOM",
      subtitle: region.id === "crown" ? "OPAQUE +Z" : "OPAQUE -Z",
      horizontalLabel: `L ${fixed(model.bounds.size.x, 3)}`,
      verticalLabel: `W ${fixed(model.bounds.size.y, 3)}`,
    };
  drawProjection(page, model, {
    x: MARGIN, top, width: diagramWidth, height: 160,
    ...projection, highlightOperationId: group.id,
  }, assets);
  const panelX = MARGIN + diagramWidth + 17;
  const panelWidth = 276;
  drawRectTop(page, panelX, top, panelWidth, 160, { color: rgbOf(rgb, COLOR.soft) });
  drawTextTop(page, region.label, panelX + 12, top + 12, { font, size: 6, color: rgbOf(rgb, COLOR.muted) });
  drawTextTop(page, group.label, panelX + 12, top + 29, { font: bold, size: 11, color: rgbOf(rgb, COLOR.ink) });
  const angles = group.facets.map((facet) => facet.industryAngleDeg);
  const depths = group.facets.map((facet) => facet.depth);
  const angleRange = angles.length ? `${fixed(Math.min(...angles), 2)}°  /  ${fixed(Math.max(...angles), 2)}°` : "-";
  const depthRange = depths.length ? `${fixed(Math.min(...depths), 3)}  /  ${fixed(Math.max(...depths), 3)}` : "-";
  drawSpecRow(page, panelX + 12, top + 51, panelWidth - 24, "记录面", `${group.facets.length} FACES`, assets);
  drawSpecRow(page, panelX + 12, top + 70, panelWidth - 24, "重复 / 镜像", `${group.repeat} / ${group.mirror ? `+${group.mirror}` : "AXIS"}`, assets);
  drawSpecRow(page, panelX + 12, top + 89, panelWidth - 24, "行业角范围", angleRange, assets);
  drawSpecRow(page, panelX + 12, top + 108, panelWidth - 24, "深度范围", depthRange, assets);
  const indices = group.facets.map((facet) => String(displayIndex(facet.index)).padStart(2, "0")).join("-");
  drawTextTop(page, "INDEX", panelX + 12, top + 134, { font: latinBold, size: 5.6, color: rgbOf(rgb, COLOR.accent) });
  drawTextTop(page, indices.length > 64 ? `${indices.slice(0, 61)}...` : indices, panelX + 50, top + 133, { font: latin, size: 5.4, color: rgbOf(rgb, COLOR.ink) });
}

function drawGroupPage(page, model, descriptor, assets) {
  const { font, bold, latin, rgb } = assets;
  const { region, group, rows, part, parts, pageNumber } = descriptor;
  drawHeader(page, model, assets, `${group.label} / ${region.label}`, pageNumber);
  drawTextTop(page, "FACET GROUP SCHEDULE", MARGIN, 88, { font: assets.latinBold, size: 6.2, color: rgbOf(rgb, COLOR.accent) });
  drawTextTop(page, group.label, MARGIN, 104, { font: bold, size: 18, color: rgbOf(rgb, COLOR.ink) });
  const summary = `${region.label} · ${group.facets.length} 面 · ${part}/${parts}`;
  drawTextTop(page, summary, A4.width - MARGIN - font.widthOfTextAtSize(summary, 7), 113, { font, size: 7, color: rgbOf(rgb, COLOR.muted) });
  drawGroupAnalysis(page, model, region, group, 140, assets);
  const columns = [
    { x: MARGIN, label: "组 / 面" }, { x: 143, label: "索引" }, { x: 188, label: "行业角" },
    { x: 249, label: "几何 β" }, { x: 310, label: "深度" }, { x: 365, label: "方位角" },
    { x: 435, label: "裁切平面 normal / offset" },
  ];
  const tableTop = 320;
  drawRectTop(page, MARGIN, tableTop, 519, 24, { color: rgbOf(rgb, COLOR.ink) });
  columns.forEach((column) => drawTextTop(page, column.label, column.x + 5, tableTop + 8, { font: bold, size: column.x === 435 ? 5.6 : 6.2, color: rgbOf(rgb, COLOR.white) }));
  const rowHeight = 22.5;
  rows.forEach((row, index) => {
    const top = tableTop + 24 + index * rowHeight;
    drawRectTop(page, MARGIN, top, 519, rowHeight, { color: rgbOf(rgb, index % 2 ? COLOR.white : COLOR.soft) });
    const values = [`${row.group} / ${row.face}`, row.index, row.industryAngle, row.beta, row.depth, row.azimuth, row.plane];
    columns.forEach((column, columnIndex) => drawTextTop(page, values[columnIndex], column.x + 5, top + 8.5, {
      font: columnIndex === 0 ? bold : latin, size: columnIndex === 6 ? 5.2 : 6.3, color: rgbOf(rgb, COLOR.ink),
    }));
  });
  const tableBottom = tableTop + 24 + rows.length * rowHeight;
  drawLineTop(page, { x: MARGIN, y: tableBottom }, { x: A4.width - MARGIN, y: tableBottom }, { thickness: 0.7, color: rgbOf(rgb, COLOR.ink) });
}

export async function createFacetReportPdfBytes(input, resources) {
  const [{ PDFDocument, StandardFonts, degrees, rgb }, fontkit] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  const { regularBytes, boldBytes, logoBytes = null } = resources;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit.default ?? fontkit);
  const [font, bold, latin, latinBold, logo] = await Promise.all([
    pdf.embedFont(regularBytes), pdf.embedFont(boldBytes), pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold), logoBytes ? pdf.embedPng(logoBytes) : null,
  ]);
  const model = createFacetReportModel(input);
  const assets = { font, bold, latin, latinBold, logo, degrees, rgb };
  buildFacetReportPages(model).forEach((descriptor) => {
    const page = pdf.addPage([A4.width, A4.height]);
    if (descriptor.kind === "cover") drawCover(page, model, assets, descriptor.pageNumber);
    else drawGroupPage(page, model, descriptor, assets);
  });
  pdf.setTitle(`${model.name} - 切磨技术报告`);
  pdf.setSubject("Facet 96 cutting parameters and measured vector drawings");
  pdf.setAuthor("SUVA 切磨工作台");
  pdf.setCreator("SUVA Facet 96");
  return pdf.save({ useObjectStreams: true });
}

export async function createFacetReportPdf(input) {
  const [regularBytes, boldBytes, logoBytes] = await Promise.all([
    fetchBytes(`${import.meta.env.BASE_URL}fonts/NotoSerifSC-Light.ttf`),
    fetchBytes(`${import.meta.env.BASE_URL}fonts/NotoSerifSC-SemiBold.ttf`),
    fetchBytes(`${import.meta.env.BASE_URL}brand/logo-report.png`).catch(() => null),
  ]);
  const bytes = await createFacetReportPdfBytes(input, { regularBytes, boldBytes, logoBytes });
  return new Blob([bytes], { type: "application/pdf" });
}

export async function downloadFacetReport(input) {
  const blob = await createFacetReportPdf(input);
  const safeName = input.document.name.replace(/[^\p{L}\p{N}-]+/gu, "-") || "facet-96";
  downloadBlob(blob, `${safeName}-切磨技术报告.pdf`);
}
