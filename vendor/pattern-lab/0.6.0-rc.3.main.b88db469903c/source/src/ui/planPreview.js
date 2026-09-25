/** DOM-free SVG-ready crown preview for project cards: compile the plan,
 * keep crown-visible faces and project them into a square viewBox. */

import { compilePlan } from '../core/application/patternPlan.js';
import { planLayout, projectPlan, planSidePredicate } from './planView.js';

export function previewPolygons(plan, size = 200) {
  try {
    const compiled = compilePlan(plan);
    if (!compiled.audit.passed) return { ok: false };
    const visible = planSidePredicate('crown');
    const layout = planLayout(size, size);
    const polygons = compiled.faces
      .filter(visible)
      .map((face) => face.points.map((p) => projectPlan(layout, p)));
    return { ok: true, polygons, teeth: compiled.plan.machine.teeth, viewBox: size };
  } catch {
    return { ok: false };
  }
}
