import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createFacetingDocument, resolveFacetPattern } from "../src/domain/faceting.js";
import { clipPolyhedronByPlanes, createCenteredCube, measurePolyhedron } from "../src/domain/geometry.js";
import { createFacetReportPdfBytes } from "../src/report/pdfReport.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Mirror the real workbench document: the fixed T1 table layer is always first.
const facets = [
  ...resolveFacetPattern({ patternId: "table-facet", label: "T1 台面", region: "crown", baseIndex: 0, repeat: 1, mirror: 0, industryAngleDeg: 0, depth: 0.2, metadata: { operationType: "table" } }),
  ...resolveFacetPattern({ patternId: "p1", label: "P1 亭部主面", region: "pavilion", baseIndex: 0, repeat: 8, mirror: 0, industryAngleDeg: 41, depth: 0.42 }),
  ...resolveFacetPattern({ patternId: "c1", label: "C1 冠部主面", region: "crown", baseIndex: 6, repeat: 8, mirror: 0, industryAngleDeg: 32, depth: 0.3 }),
  ...resolveFacetPattern({ patternId: "c2", label: "C2 冠部星面", region: "crown", baseIndex: 12, repeat: 8, mirror: 0, industryAngleDeg: 15, depth: 0.3 }),
  ...resolveFacetPattern({ patternId: "g1", label: "G1 腰部分面", region: "girdle", baseIndex: 0, repeat: 16, mirror: 0, industryAngleDeg: 90, depth: 0.1 }),
];
const document = createFacetingDocument({ name: "未命名切型 01", facets });
const solid = clipPolyhedronByPlanes(
  createCenteredCube(2),
  facets.map((facet) => ({ ...facet.plane, operationId: facet.patternId, faceId: facet.id, region: facet.region })),
);
const [regularBytes, boldBytes, logoBytes] = await Promise.all([
  readFile(path.join(root, "public/fonts/NotoSerifSC-Light.ttf")),
  readFile(path.join(root, "public/fonts/NotoSerifSC-SemiBold.ttf")),
  readFile(path.join(root, "public/brand/logo-report.png")),
]);
const pdf = await createFacetReportPdfBytes(
  // Mirror the default export choice: girdle facet tables are auxiliary and excluded.
  { document, solid, metrics: measurePolyhedron(solid), generatedAt: new Date("2026-08-30T12:00:00+08:00"), includeGirdle: false },
  { regularBytes, boldBytes, logoBytes },
);
const outputDir = path.join(root, "output/pdf");
const outputPath = path.join(outputDir, "facet-96-vector-sample-report.pdf");
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, pdf);
console.log(outputPath);
