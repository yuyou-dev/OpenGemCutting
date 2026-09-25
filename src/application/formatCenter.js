import { decodeText, detectFormat, diagnostic, diagnosticFromError, statusFor } from "../domain/formats/shared.js";
import { readAscDesign, writeAscDesign } from "../domain/gemcadAsc.js";
import { readGcsDesign, writeGcsDesign } from "../domain/formats/gcs.js";
import { readGemDesign } from "../domain/formats/gem.js";
import { designFromDocument, designSummary, documentFromDesign, planeDesignSolid, sameShape, solidDimensions } from "../domain/formats/planeDesign.js";
import { formatById, isQuietDiagnostic, presentConcepts, transferReport } from "../domain/formats/capabilities.js";
import { exportFacetingJSON, importFacetingJSON } from "../domain/faceting.js";
import { assertValidDocumentGeometry, evaluateDocument } from "../domain/documentGeometry.js";
import { assertDocumentImportBudget } from "../domain/importBudget.js";
import { ensureTableFacet } from "../domain/document.js";
import { facetSurfaceState } from "../domain/facetSurface.js";
import { safeFileStem } from "../utils/format.js";

/*
 * Format center: inspect one source (a file or the open project), plan every
 * destination by really writing it, and read foreign exports back to confirm
 * the shape. Nothing here changes a project: opening in the workbench returns
 * a new document for the host to create as a separate project.
 */

const WRITERS = {
  asc: { write: writeAscDesign, read: (text) => readAscDesign(text).design, mime: "text/plain;charset=utf-8" },
  gcs: { write: writeGcsDesign, read: (text) => readGcsDesign(text).design, mime: "application/xml;charset=utf-8" },
};
const LABELS = { asc: "ASC", gcs: "GCS" };

function visible(diagnostics) {
  return diagnostics.filter((item) => !isQuietDiagnostic(item));
}

function frostedFaceIds(design) {
  return new Set(design.tiers.filter((tier) => !tier.hidden).flatMap((tier, tierIndex) => tier.entries
    .map((entry, entryIndex) => (entry.finish?.state === "frosted" ? `${tierIndex}:${entryIndex}` : null)).filter(Boolean)));
}

function documentFacts(document) {
  const converted = designFromDocument(document, { target: "该格式" });
  const concave = document.concaveCuts?.filter((cut) => cut.enabled !== false).length ?? 0;
  return {
    design: converted.design,
    facts: { ...converted.facts, concave: concave || (document.concaveCuts?.length ? document.concaveCuts.length : 0), meshStock: document.stock?.kind === "mesh" },
  };
}

function documentSource({ origin, format, fileName, document, diagnostics = [], hasPreview = false }) {
  const { design, facts } = documentFacts(document);
  const solid = evaluateDocument(document);
  const frosted = document.facets.filter((facet) => facetSurfaceState(facet) === "frosted");
  return {
    origin,
    format,
    fileName,
    name: document.name,
    status: statusFor(diagnostics),
    diagnostics,
    document,
    design,
    facts,
    present: presentConcepts(design, facts),
    hasPreview,
    preview: { solid, open: false, frostedFaceIds: new Set(frosted.map((facet) => facet.id)) },
    summary: {
      gear: document.indexGear?.teeth ?? 96,
      storedFacetCount: document.facets.length,
      effectiveFacetCount: facts.effectiveFacetCount ?? 0,
      ...(design ? designSummary(design) : {}),
      frostedCount: frosted.length,
      dimensions: solidDimensions(solid),
    },
    workbench: null,
  };
}

function designSource({ format, fileName, design, diagnostics }) {
  const { solid, open } = planeDesignSolid(design);
  const workbench = documentFromDesign(structuredClone(design), { diagnostics: [], summary: designSummary(design) });
  if (workbench.document) {
    try {
      assertDocumentImportBudget(workbench.document);
      assertValidDocumentGeometry(workbench.document);
    } catch (error) {
      workbench.diagnostics.push(diagnostic("error", "IMPORT_BUDGET", error.message));
      workbench.document = null;
      workbench.status = "error";
    }
  }
  const facts = { open };
  return {
    origin: "file",
    format,
    fileName,
    name: design.name,
    status: statusFor(diagnostics),
    diagnostics,
    document: null,
    design,
    facts,
    present: presentConcepts(design, facts),
    hasPreview: false,
    preview: { solid, open, frostedFaceIds: frostedFaceIds(design) },
    summary: { ...designSummary(design), dimensions: open ? null : solidDimensions(solid) },
    workbench,
  };
}

function failedSource(fileName, format, diagnostics) {
  return { origin: "file", format, fileName, name: fileName, status: "error", diagnostics, document: null, design: null,
    facts: {}, present: new Map(), preview: null, summary: null, workbench: null };
}

/** Read a dropped or chosen file. Content decides the format, not the name. */
export function inspectFormatFile(input, fileName = "") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let format = null;
  try {
    const detected = detectFormat(bytes, fileName);
    format = detected.format;
    if (!format) {
      return failedSource(fileName, null, [diagnostic("error", "UNKNOWN_FORMAT", "无法识别这个文件。格式中心可读取 GemCAD（.asc、.gem）、Gem Cut Studio（.gcs）和本软件项目（.json）。")]);
    }
    const notes = detected.extension && detected.extension !== format
      ? [diagnostic("info", "EXTENSION_MISMATCH", `文件扩展名是 .${detected.extension}，内容是${formatById(format).label}；已按内容读取。`)]
      : [];
    if (format === "gem") {
      const read = readGemDesign(bytes, { fileName });
      return designSource({ format, fileName, design: read.design, diagnostics: [...notes, ...read.diagnostics] });
    }
    const decoded = decodeText(bytes);
    notes.push(...decoded.diagnostics);
    if (format === "json") {
      assertDocumentImportBudget(JSON.parse(decoded.text));
      const document = ensureTableFacet(importFacetingJSON(decoded.text));
      assertValidDocumentGeometry(document);
      return documentSource({ origin: "file", format, fileName, document, diagnostics: notes });
    }
    const read = format === "asc" ? readAscDesign(decoded.text, { fileName }) : readGcsDesign(decoded.text, { fileName });
    const diagnostics = [...notes, ...read.diagnostics];
    if (!read.design) return failedSource(fileName, format, diagnostics);
    return designSource({ format, fileName, design: read.design, diagnostics });
  } catch (error) {
    const item = error?.code ? diagnosticFromError(error) : diagnostic("error", "UNREADABLE_FILE", `文件无法读取：${error.message}`);
    return failedSource(fileName, format, [item]);
  }
}

/** The open project, as committed (unsaved cut previews are never exported). */
export function inspectProjectSource(document, { hasPreview = false } = {}) {
  return documentSource({ origin: "project", format: "project", fileName: "", document, hasPreview });
}

/** Destinations offered for a source, in display order. */
export function targetsFor(source) {
  if (!source || source.status === "error") return [];
  if (source.origin === "project") return ["asc", "gcs"];
  return ["workbench", ...["asc", "gcs", "json"].filter((target) => target !== source.format)];
}

function outcome(report, status) {
  if (status === "error" || report.blocked.length) return "blocked";
  if (report.lost.length) return "lossy";
  if (report.approximate.length) return "approximate";
  return "complete";
}

/**
 * Plan one destination: the written file (or document), what it keeps,
 * approximates, loses or cannot hold, and whether reading it back gave the
 * same shape. A failed read-back blocks the export.
 */
export function planTarget(source, target) {
  const stem = safeFileStem(source.name || "facet-design");
  if (target === "workbench" || target === "json") {
    const document = source.document ?? source.workbench?.document ?? null;
    const diagnostics = visible(source.document ? [] : source.workbench?.diagnostics ?? []);
    const status = document ? statusFor(diagnostics) : "error";
    const report = transferReport("json", source.present, diagnostics);
    if (!document && !report.blocked.length) report.blocked.push({ id: "document", label: "不能成为本软件项目", detail: "", note: diagnostics.find((item) => item.severity === "error")?.message ?? "" });
    return {
      target,
      status,
      outcome: outcome(report, status),
      report,
      diagnostics,
      document,
      fileName: target === "json" ? `${stem}.json` : "",
      text: target === "json" && document ? exportFacetingJSON(document) : "",
      mime: "application/json",
      verified: Boolean(document),
    };
  }

  const writer = WRITERS[target];
  let design = source.design;
  const diagnostics = [];
  if (source.document) {
    const converted = designFromDocument(source.document, { target: LABELS[target] });
    diagnostics.push(...converted.diagnostics);
    design = converted.design;
  }
  let text = "";
  let verified = false;
  if (design && !diagnostics.some((item) => item.severity === "error")) {
    const written = writer.write(design, { diagnostics });
    text = written.text;
    if (text) {
      let back = null;
      try { back = writer.read(text); } catch { back = null; }
      verified = Boolean(back) && sameShape(design, back);
      if (!verified) {
        diagnostics.push(diagnostic("error", "SELF_CHECK_FAILED", `写出的 ${LABELS[target]} 文件读回后形状不一致，已停止导出。请保存 JSON 并反馈这个设计。`));
        text = "";
      }
    }
  }
  const shown = visible(diagnostics);
  const status = statusFor(diagnostics);
  const report = transferReport(target, source.present, diagnostics);
  if (status === "error" && !report.blocked.length) {
    report.blocked.push({ id: "error", label: "不能转换", detail: "", note: diagnostics.find((item) => item.severity === "error")?.message ?? "" });
  }
  return {
    target,
    status,
    outcome: outcome(report, status),
    report,
    diagnostics: shown,
    document: null,
    fileName: `${stem}.${target}`,
    text: status === "error" ? "" : text,
    mime: writer.mime,
    verified,
  };
}

export function planTargets(source) {
  return Object.fromEntries(targetsFor(source).map((target) => [target, planTarget(source, target)]));
}
