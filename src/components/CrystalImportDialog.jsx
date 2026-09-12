import { t } from '../i18n/locale.js';
import { assertFileBudget, IMPORT_BUDGET } from "../domain/importBudget.js";
import { useId, useMemo, useRef, useState } from "react";
import { IconFileUpload, IconX } from "@tabler/icons-react";
import { inspectCrystalMesh, CRYSTAL_IMPORT_FACE_LIMIT } from "../domain/stockGeometry.js";
import { parseMeshOBJ } from "../domain/mesh/index.js";
import { GemViewport } from "./GemViewport.jsx";
import { useDialogFocus } from "./useDialogFocus.js";
import "./CrystalImportDialog.css";

const UNITS = { unitless: "未指定单位", mm: "毫米 · mm", cm: "厘米 · cm", m: "米 · m" };
const dimensions = (values) => values.map((value) => Number(value.toPrecision(5))).join(" × ");

export function CrystalImportDialog({ onClose, onImport, onBack }) {
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const readSequence = useRef(0);
  const titleId = useId();
  const [source, setSource] = useState(null);
  const [readError, setReadError] = useState("");
  const [reading, setReading] = useState(false);
  const [unit, setUnit] = useState("unitless");
  const [upAxis, setUpAxis] = useState("z");
  useDialogFocus(panelRef, onClose);

  const inspection = useMemo(() => {
    if (!source?.mesh) return null;
    try {
      return { result: inspectCrystalMesh(source.mesh, { fileName: source.name, unit, upAxis }) };
    } catch (error) {
      return { error: error.message };
    }
  }, [source, unit, upAxis]);
  const result = inspection?.result;
  const rawError = readError || source?.error || inspection?.error;
  const error = rawError?.replace('open boundary', '边界未闭合，请补齐缺失的面')
    .replace('non-manifold or inconsistent orientation', '面连接异常或朝向不一致，请修复连接与法线')
    .replace('self-intersection or overlapping shells', '面片自相交或晶体壳层重叠')
    .replace('Shell orientation does not match material/cavity containment', '晶体外壳与空腔的面朝向不正确')
    .replace('Non-positive material volume', '晶体体积无效，请检查面朝向与闭合情况');
  const summary = result?.summary;
  const selectFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sequence = ++readSequence.current;
    setReading(true);
    setReadError("");
    setSource(null);
    try {
      assertFileBudget(file);
      const text = await file.text();
      if (sequence !== readSequence.current) return;
      try {
        setSource({ name: file.name, mesh: parseMeshOBJ(text, { maxFaces: CRYSTAL_IMPORT_FACE_LIMIT, maxVertices: IMPORT_BUDGET.objVertices }) });
      } catch (error) {
        setSource({ name: file.name, error: error.message });
      }
    } catch (error) {
      if (sequence === readSequence.current) setReadError(error.message || "无法读取这份文件，请重新选择 OBJ 文件。");
    } finally {
      if (sequence === readSequence.current) setReading(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} tabIndex={-1} className="modal-panel crystal-import-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="asc-transfer-heading">
          <div><span className="asc-eyebrow">INITIAL CRYSTAL · OBJ</span><h2 id={titleId}>{t("导入初始晶体")}</h2></div>
          <button type="button" className="modal-close" aria-label={t("关闭导入初始晶体")} onClick={onClose}><IconX size={17} stroke={1.6} /></button>
        </header>
        <div className="crystal-import-body">
          <p className="crystal-import-intro">{t("从自己的原石形状开始设计。最多")} {t(CRYSTAL_IMPORT_FACE_LIMIT)} {t("个面（凹多边形分解后的面片也须在此限内）。先检查闭合、面片和尺寸，再建立新项目。")}</p>
          <div className="crystal-file-row">
            <input ref={inputRef} type="file" accept=".obj,text/plain" aria-label={t("选择初始晶体 OBJ 文件")} onChange={selectFile} hidden />
            <button type="button" className="secondary-button modal-button" onClick={() => inputRef.current.click()}><IconFileUpload size={17} />{source || error ? t("重新选择 OBJ") : t("选择 OBJ 文件")}</button>
            <span title={source?.name}>{reading ? t("正在读取文件…") : source?.name ?? t("支持闭合的凸形或凹形晶体")}</span>
          </div>
          <div className={`crystal-import-layout${result ? " has-preview" : ""}`}>
          {result ? <div className="crystal-import-preview"><GemViewport polyhedron={result.solid} /></div> : null}
          <div className="crystal-import-options">
          <div className="crystal-import-settings">
            <label>{t("源文件单位")}<select value={unit} onChange={(event) => setUnit(event.target.value)}>{Object.entries(UNITS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
            <label>{t("原文件朝上方向")}<select value={upAxis} onChange={(event) => setUpAxis(event.target.value)}><option value="z">{t("+Z 朝上")}</option><option value="y">{t("+Y 朝上")}</option><option value="x">{t("+X 朝上")}</option></select></label>
          </div>
          <p className="crystal-import-unit-note">{t("OBJ 不声明单位；请按建模时的设置选择，不确定时保留“未指定单位”。朝上方向将在工作台中对齐冠部 +Z。")}</p>
          {result ? <>
            <dl className="crystal-import-summary" aria-label={t("晶体预检结果")}>
              <div><dt>{t("源尺寸 · X × Y × Z")}</dt><dd>{t(dimensions(summary.sourceDimensions))}{t(unit === "unitless" ? t(" · 未指定单位") : ` ${unit}`)}</dd></div>
              <div><dt>{t("工作台尺寸 · X × Y × Z")}</dt><dd>{t(dimensions(summary.dimensions))}</dd></div>
              <div><dt>{t("顶点 / 面片")}</dt><dd>{t(summary.vertexCount)} / {t(summary.patchCount)}</dd></div>
              <div><dt>{t("预检")}</dt><dd className="crystal-import-valid">{t("闭合检查通过")}</dd></div>
            </dl>
            <p className="crystal-import-unit-note">{t("保持比例，按包围盒居中，最长边统一为 2.000；不会改变晶体的凹陷与轮廓。源尺寸与单位随 JSON 保留。")}</p>
          </> : null}
          </div>
          </div>
          {error ? <div className="crystal-import-error" role="alert"><strong>{t("这份晶体暂时不能导入")}</strong><p>{t(error)}</p><p>{t("请在建模软件中修复后重新导出 OBJ。")}</p></div> : null}
          <aside className="crystal-import-scope"><strong>{t("新项目从原石开始")}</strong><p>{t("不预切台面或腰部，初始 CUT 为 0。重复与镜像控制切割方向，不会复制原石。切割后保留全部碎块。")}</p><p>{t("当前项目的已保存设计仍保留；如有未保存预览，切换前会再次提示。")}</p></aside>
        </div>
        <footer className="modal-actions asc-transfer-actions">
          <button type="button" className="secondary-button modal-button" onClick={onBack ?? onClose}>{onBack ? t("返回选择起点") : t("取消")}</button>
          <button type="button" className="primary-action modal-button" disabled={!result || reading} onClick={() => onImport(result.document)}>{t("以此晶体新建项目")}</button>
        </footer>
      </section>
    </div>
  );
}
