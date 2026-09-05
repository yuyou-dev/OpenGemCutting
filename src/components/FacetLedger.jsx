import { useRef } from "react";
import { useDialogFocus } from "./useDialogFocus.js";
import { IconChevronRight, IconCube, IconEye, IconEyeOff, IconX } from "@tabler/icons-react";
import { FACET_REGION_LABELS, displayIndex } from "../domain/faceting.js";

const REGION_LABEL = {
  ...FACET_REGION_LABELS,
  rough: "初始",
};

export function FacetLedger({
  operations,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onToggleVisibility,
  canSelectLayers = true,
  canMutateStack = true,
  onClose,
}) {
  const panelRef = useRef(null);
  useDialogFocus(panelRef, onClose);
  const rows = [
    {
      id: "rough-cube",
      label: "S0 毛坯立方体",
      region: "rough",
      industryAngleDeg: 90,
      signedBeta: 0,
      depth: 0,
      indices: [],
      visible: true,
      status: "历史基体",
    },
    ...operations.filter((operation) => operation.effectiveCount > 0),
  ];

  return (
    <section ref={panelRef} tabIndex={-1} className="facet-ledger" aria-labelledby="ledger-title">
      <div className="ledger-heading">
        <h2 id="ledger-title">刻面表（当前 {operations.reduce((sum, item) => sum + item.effectiveCount, 0)} 个最终有效面）</h2>
        <div className="ledger-heading-actions">
          <span>逐面参数保留在 JSON 中</span>
          {onClose ? (
            <button type="button" className="row-icon-button" aria-label="关闭刻面表" onClick={onClose}>
              <IconX size={19} stroke={1.8} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="ledger-table-wrap">
        <table>
          <thead>
            <tr>
              <th>组 / 面</th>
              <th>行业角</th>
              <th>几何 β</th>
              <th>深度</th>
              <th>索引</th>
              <th>状态</th>
              <th><span className="sr-only">显示</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedId === row.id;
              const hovered = hoveredId === row.id;
              return (
                <tr
                  key={row.id}
                  className={[selected ? "is-selected" : "", hovered ? "is-hovered" : ""].filter(Boolean).join(" ")}
                  onMouseEnter={() => onHover?.(row.id)}
                  onMouseLeave={() => onHover?.(null)}
                >
                  <td>
                    <button type="button" className="ledger-row-button" onClick={() => onSelect(row.id)} disabled={row.id === "rough-cube" || !canSelectLayers}>
                      {row.id === "rough-cube" ? <IconCube size={16} stroke={1.6} /> : <IconChevronRight size={15} stroke={1.8} />}
                      <strong>{row.label}</strong>
                    </button>
                  </td>
                  <td className="mono-cell">{row.industryAngleDeg.toFixed(2)}°</td>
                  <td className="mono-cell">{row.signedBeta > 0 ? "+" : ""}{row.signedBeta.toFixed(2)}°</td>
                  <td className="mono-cell">{row.depth ? row.depth.toFixed(3) : "—"}</td>
                  <td className="indices-cell">{(row.effectiveIndices ?? row.indices).length ? (row.effectiveIndices ?? row.indices).map((value) => String(displayIndex(value)).padStart(2, "0")).join(" ") : "—"}</td>
                  <td>{row.status || REGION_LABEL[row.region]}</td>
                  <td>
                    <button
                      type="button"
                      className="row-icon-button"
                      aria-label={row.visible === false ? `显示 ${row.label}` : `隐藏 ${row.label}`}
                      onClick={() => onToggleVisibility(row.id)}
                      disabled={row.id === "rough-cube" || !canMutateStack}
                    >
                      {row.visible === false ? <IconEyeOff size={17} stroke={1.7} /> : <IconEye size={17} stroke={1.7} />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
