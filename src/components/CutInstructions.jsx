import { t } from '../i18n/locale.js';
import { displayIndex } from "../domain/faceting.js";

/**
 * Cutting instructions by region (pavilion, girdle, crown): one row per
 * machining setting of every layer that still has final facets. Shared by
 * the parameter drawer and the bottom information strip.
 */
export function CutInstructions({ groups, compact = false }) {
  return (
    <div className={`generated-indices${compact ? " is-compact" : ""}`}>
      <div className="generated-instructions-heading">
        <strong>{t("切割指令")}</strong>
        <span>INSTRUCTIONS</span>
      </div>
      {[
        [t("亭部"), groups.pavilion],
        [t("腰部"), groups.girdle],
        [t("冠部"), groups.crown],
      ].map(([title, rows]) => (
        <section className="generated-instruction-group" key={title}>
          <h3>{t(title)}</h3>
          <div className={`generated-instruction-list${rows.length === 0 ? " is-empty" : ""}`} aria-label={t("{0}切割指令", [t(title)])}>
            {rows.map((row) => (
              <div
                className={`generated-instruction-row${row.active ? " is-active" : ""}${row.hidden ? " is-hidden" : ""}`}
                key={row.id}
              >
                <strong className="generated-instruction-prefix" title={t("{0} 齿", [row.indexTeeth ?? 96])}>{t(row.prefix)}</strong>
                <span className="generated-instruction-angle">{Number(row.angle).toFixed(2)}</span>
                <span className="generated-instruction-indexes" title={t("{0} 齿分度", [row.indexTeeth ?? 96])}>
                  {row.indices.map((value) => String(displayIndex(value, row.indexTeeth ?? 96)).padStart(2, "0")).join("-")}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
