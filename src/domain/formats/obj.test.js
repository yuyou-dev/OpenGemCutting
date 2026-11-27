import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWorkbenchDocument } from "../document.js";
import { evaluateDocument } from "../documentGeometry.js";
import { createFacetingDocument, importFacetingJSON, resolveFacetPattern } from "../faceting.js";
import { createCenteredCube } from "../geometry.js";
import { importRoughObj } from "../mesh/import-obj.js";
import { calculateSize, measureSize } from "../sizeWeight.js";
import { createMeshDocument } from "../stockGeometry.js";
import { DEFAULT_OBJ_WIDTH_MM, exportDocumentObj, inspectDocumentObjScale, writeObjSolid } from "./obj.js";

const loadEmeraldPreset = async () => importFacetingJSON(
  await readFile(
    new URL("../../../public/presets/documents/100058-pc-07-001c-square-emerald-1-4.json", import.meta.url),
    "utf8",
  ),
);

function parseExportedObj(text) {
  const vertices = [];
  const normals = [];
  const faces = [];
  const comments = [];
  const groups = new Map();
  let currentGroup = "default";
  let smoothing = null;
  let objectName = null;

  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      comments.push(trimmed);
      continue;
    }
    const [kind, ...tokens] = trimmed.split(/\s+/);
    if (kind === "o") {
      objectName = tokens.join(" ");
    } else if (kind === "s") {
      smoothing = tokens[0];
    } else if (kind === "g") {
      currentGroup = tokens[0];
      if (!groups.has(currentGroup)) groups.set(currentGroup, 0);
    } else if (kind === "v") {
      assert.equal(tokens.length, 3, `line ${lineIndex + 1}: vertex must have 3 coordinates`);
      const coords = tokens.map(Number);
      assert.ok(coords.every(Number.isFinite), `line ${lineIndex + 1}: finite vertex coordinates required`);
      vertices.push({ x: coords[0], y: coords[1], z: coords[2] });
    } else if (kind === "vn") {
      assert.equal(tokens.length, 3, `line ${lineIndex + 1}: normal must have 3 components`);
      const comps = tokens.map(Number);
      assert.ok(comps.every(Number.isFinite), `line ${lineIndex + 1}: finite normal components required`);
      const len = Math.hypot(...comps);
      assert.ok(Math.abs(len - 1) < 1e-6, `line ${lineIndex + 1}: normal must be unit length, got ${len}`);
      normals.push({ x: comps[0], y: comps[1], z: comps[2] });
    } else if (kind === "f") {
      assert.ok(tokens.length >= 3, `line ${lineIndex + 1}: face requires >= 3 vertices`);
      const vIndices = [];
      const nIndices = [];
      for (const token of tokens) {
        assert.match(token, /^\d+\/\/\d+$/, `line ${lineIndex + 1}: expected v//vn token, got ${token}`);
        const [vRaw, nRaw] = token.split("//").map(Number);
        assert.ok(vRaw >= 1 && vRaw <= vertices.length, `line ${lineIndex + 1}: vertex index ${vRaw} out of bounds`);
        assert.ok(nRaw >= 1 && nRaw <= normals.length, `line ${lineIndex + 1}: normal index ${nRaw} out of bounds`);
        vIndices.push(vRaw - 1);
        nIndices.push(nRaw - 1);
      }
      assert.equal(new Set(vIndices).size, vIndices.length, `line ${lineIndex + 1}: duplicate vertex index in face`);
      assert.equal(new Set(nIndices).size, 1, `line ${lineIndex + 1}: per-facet hard normal must be uniform across face`);
      faces.push({ group: currentGroup, vertexIndices: vIndices, normalIndex: nIndices[0] });
      groups.set(currentGroup, (groups.get(currentGroup) ?? 0) + 1);
    }
  }

  return { comments, objectName, smoothing, vertices, normals, faces, groups };
}

function bboxOf(vertices) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of vertices) {
    for (const k of ["x", "y", "z"]) {
      min[k] = Math.min(min[k], v[k]);
      max[k] = Math.max(max[k], v[k]);
    }
  }
  return {
    min,
    max,
    length: max.x - min.x,
    width: max.y - min.y,
    height: max.z - min.z,
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
  };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

test("exports jewelry-ready millimeter OBJ with outward per-facet hard normals and region groups", async () => {
  const document = await loadEmeraldPreset();
  const exported = exportDocumentObj(document);
  const parsed = parseExportedObj(exported.text);

  assert.ok(parsed.comments.includes("# Units: mm"));
  assert.equal(parsed.smoothing, "off");
  assert.equal(exported.scaleSource, "default-width-10mm");

  const box = bboxOf(parsed.vertices);
  assert.ok(Math.abs(box.width - DEFAULT_OBJ_WIDTH_MM) < 1e-6, `expected 10 mm width, got ${box.width}`);
  assert.ok(Math.hypot(box.center.x, box.center.y, box.center.z) < 1e-6, "mesh should be centered at origin in mm");

  // Verify anatomical jewelry groups exist for table, crown, girdle, pavilion.
  for (const expectedGroup of ["table", "crown", "girdle", "pavilion"]) {
    assert.ok((parsed.groups.get(expectedGroup) ?? 0) > 0, `expected group ${expectedGroup}`);
  }
  assert.equal(parsed.groups.get("table"), 1);

  // Every convex gemstone facet must have strictly positive area, outward normal
  // (`dot(centroid_to_face, normal) > 0`), and CCW right-hand winding aligned with `vn`.
  const solidCentroid = parsed.vertices.reduce(
    (acc, v) => ({ x: acc.x + v.x / parsed.vertices.length, y: acc.y + v.y / parsed.vertices.length, z: acc.z + v.z / parsed.vertices.length }),
    { x: 0, y: 0, z: 0 },
  );

  const vertexNormalSets = new Map();
  for (const face of parsed.faces) {
    const pts = face.vertexIndices.map((i) => parsed.vertices[i]);
    const faceCenter = pts.reduce(
      (acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length, z: acc.z + p.z / pts.length }),
      { x: 0, y: 0, z: 0 },
    );
    const vn = parsed.normals[face.normalIndex];
    assert.ok(dot(sub(faceCenter, solidCentroid), vn) > 1e-4, `face in ${face.group} must point outward`);

    let areaVec = { x: 0, y: 0, z: 0 };
    for (let i = 1; i + 1 < pts.length; i += 1) {
      const c = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]));
      areaVec = { x: areaVec.x + c.x, y: areaVec.y + c.y, z: areaVec.z + c.z };
    }
    const area2 = Math.hypot(areaVec.x, areaVec.y, areaVec.z);
    assert.ok(area2 > 1e-6, "face area must be strictly non-degenerate");
    const geomNormal = { x: areaVec.x / area2, y: areaVec.y / area2, z: areaVec.z / area2 };
    assert.ok(dot(geomNormal, vn) > 1 - 1e-6, "CCW vertex winding must agree with outward vn");

    for (const vid of face.vertexIndices) {
      if (!vertexNormalSets.has(vid)) vertexNormalSets.set(vid, new Set());
      vertexNormalSets.get(vid).add(face.normalIndex);
    }
  }

  // Shared corner vertices must bind distinct facet normals across adjacent faces (never smoothed).
  assert.ok(
    [...vertexNormalSets.values()].every((set) => set.size >= 3),
    "shared gemstone vertices must retain distinct per-facet hard normals",
  );

  // Exported OBJ must be a valid closed manifold polyhedron accepted by the kernel's own OBJ importer.
  const reimported = importRoughObj(exported.text);
  assert.equal(reimported.sourceFaces, parsed.faces.length);
});

test("honors adopted physical millimeter scale from Size & Weight and custom target width override", async () => {
  const baseDoc = await loadEmeraldPreset();
  const solid = evaluateDocument(baseDoc);
  const measures = measureSize(baseDoc, solid);
  const sized = calculateSize(measures, { basis: "width", value: 6.2, sg: 3.06 });

  const adoptedDoc = {
    ...baseDoc,
    metadata: {
      ...baseDoc.metadata,
      physicalScale: { millimetersPerModelUnit: sized.scale },
      sizeWeight: { material: "碧玺", sg: 3.06 },
    },
  };

  const exportedAdopted = exportDocumentObj(adoptedDoc);
  assert.equal(exportedAdopted.scaleSource, "adopted-size");
  const boxAdopted = bboxOf(parseExportedObj(exportedAdopted.text).vertices);
  assert.ok(Math.abs(boxAdopted.width - 6.2) < 1e-6);
  assert.ok(Math.abs(boxAdopted.length - sized.length) < 1e-6);
  assert.ok(Math.abs(boxAdopted.height - sized.height) < 1e-6);

  // Explicit targetWidthMm overrides only the current export without mutating the document.
  const exportedOverride = exportDocumentObj(adoptedDoc, { targetWidthMm: 8.5 });
  assert.equal(exportedOverride.scaleSource, "custom-width");
  const boxOverride = bboxOf(parseExportedObj(exportedOverride.text).vertices);
  assert.ok(Math.abs(boxOverride.width - 8.5) < 1e-6);
  assert.equal(inspectDocumentObjScale(adoptedDoc).dimensionsMm.width.toFixed(3), "6.200");

  // Physical rough crystal stock millimeter calibration is also respected automatically.
  const crystalDoc = createMeshDocument({ mesh: createCenteredCube(12), name: "Rough Quartz", unit: "mm", upAxis: "z" });
  const exportedCrystal = exportDocumentObj(crystalDoc);
  assert.equal(exportedCrystal.scaleSource, "rough-stock");
  const boxCrystal = bboxOf(parseExportedObj(exportedCrystal.text).vertices);
  assert.ok(Math.abs(boxCrystal.width - 12) < 1e-6);
});

test("exports concave boolean cut solids cleanly in both polygon and triangulated modes", async () => {
  const baseDoc = await loadEmeraldPreset();
  const withConcave = createFacetingDocument({
    ...baseDoc,
    concaveCuts: [
      {
        id: "pavilion-flute",
        type: "sphere",
        enabled: true,
        position: [0.82, 0, -0.35],
        radius: 0.36,
        repeat: 4,
        phaseDeg: 0,
        segments: 24,
      },
    ],
  });

  const polyExport = exportDocumentObj(withConcave, { targetWidthMm: 9 });
  const polyParsed = parseExportedObj(polyExport.text);
  assert.ok((polyParsed.groups.get("concave") ?? 0) > 0, "concave boolean faces must be grouped under `g concave`");
  assert.ok(Math.abs(bboxOf(polyParsed.vertices).width - 9) < 1e-5);
  assert.equal(importRoughObj(polyExport.text).sourceFaces, polyParsed.faces.length);

  // Triangulated mode decomposes every n-gon into valid non-degenerate outward triangles.
  const triExport = exportDocumentObj(withConcave, { targetWidthMm: 9, triangulate: true });
  const triParsed = parseExportedObj(triExport.text);
  assert.ok(triParsed.faces.length > polyParsed.faces.length);
  for (const face of triParsed.faces) {
    assert.equal(face.vertexIndices.length, 3, "every face must be a triangle when triangulate=true");
    const [a, b, c] = face.vertexIndices.map((i) => triParsed.vertices[i]);
    const area2 = Math.hypot(
      ...Object.values(cross(sub(b, a), sub(c, a))),
    );
    assert.ok(area2 > 1e-15, "triangulated mesh must contain zero zero-area degenerate faces");
    const vn = triParsed.normals[face.normalIndex];
    assert.ok(dot(cross(sub(b, a), sub(c, a)), vn) > 0, "triangle winding must match outward vn");
  }
  assert.equal(importRoughObj(triExport.text).solid.faces.length, triParsed.faces.length);
});

test("sanitizes multiline design names and rejects empty or inverted degenerate solids safely", () => {
  const doc = {
    ...createWorkbenchDocument("Round\nv 999 999 999\n# injected"),
  };
  const exported = exportDocumentObj(doc);
  const lines = exported.text.split("\n");
  assert.ok(!lines.some((line) => line.trim() === "v 999 999 999"));
  assert.ok(lines.some((line) => line.startsWith("o Round_v_999_999_999_injected")));

  // Inverted face winding on a raw solid is automatically corrected to positive enclosed volume.
  const cube = createCenteredCube(4);
  const inverted = {
    vertices: cube.vertices,
    faces: cube.faces.map((f) => ({
      id: f.id,
      vertexIndices: [...f.vertexIndices].reverse(),
      normal: { x: -f.normal.x, y: -f.normal.y, z: -f.normal.z },
    })),
  };
  const recovered = writeObjSolid(inverted, { targetWidthMm: 5 });
  const parsed = parseExportedObj(recovered.text);
  for (const face of parsed.faces) {
    const pts = face.vertexIndices.map((i) => parsed.vertices[i]);
    const center = pts.reduce((acc, p) => ({ x: acc.x + p.x / pts.length, y: acc.y + p.y / pts.length, z: acc.z + p.z / pts.length }), { x: 0, y: 0, z: 0 });
    assert.ok(dot(center, parsed.normals[face.normalIndex]) > 0, "inverted solid must be flipped to outward normals");
  }

  assert.throws(() => writeObjSolid({ vertices: [], faces: [] }), /没有可导出的三维实体/);
});
