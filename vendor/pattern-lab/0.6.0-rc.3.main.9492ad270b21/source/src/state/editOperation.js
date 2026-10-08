import { compilePlan } from '../core/application/patternPlan.js';
import { applyPlanEdit } from '../core/application/planEdit.js';
import { applyAnalyticEdit } from '../core/application/analyticEdit.js';
import { dissolveGroup } from '../core/application/groups.js';

export function solveEdit({ plan, op, settings }, compiled = compilePlan(plan)) {
  if(compiled.audit.mmPerUnit===null)return {error:'PHYSICAL_SCALE_REQUIRED',message:'来源缺少毫米尺度，请先在整体属性标定。'};
  if (settings.mode !== 'fixed') return applyAnalyticEdit(plan, compiled, op, {
    ...settings, relax: true, topology: settings.mode === 'topology',
  });
  const result = applyPlanEdit(plan, compiled, op, settings);
  if (result.error || result.unchanged) return result;
  let next = { ...plan, planes: result.planes };
  const groups = new Set(result.affectedIds.map(id => plan.planes.find(p => p.id === id)?.group).filter(Boolean));
  for (const group of groups) next = dissolveGroup(next, group);
  return { ...result, plan: next, previewCompiled: compilePlan(next) };
}
