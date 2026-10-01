import { compilePlan, validatePlan } from './patternPlan.js';

/** External analytic plans use complete halfspaces and an implicit horizontal
 * table. Normalize those conventions without flattening parametric bevels or
 * moving surface overrides into a second source of material truth. */
export function normalizeAnalyticPlan(document) {
  const source = document?.kind === 'facet-analytic-session'
    ? { ...document.plan, optics: document.optics ?? document.plan?.optics } : document;
  const plan = validatePlan(source);
  if(!source.bevelResult&&!source.recovery)plan.recovery={originalInput:structuredClone(document),reason:'legacy-plan-migration'};
  const external = document?.kind === 'facet-analytic-session'
    || (plan.metadata?.experimental === true && typeof plan.metadata.preset === 'string');
  if (!external) return plan;
  plan.bevel = { enabled: false, shoulderMm: 0.014, alpha: 0.28, ...plan.bevel };
  if (!plan.planes.some(p => p.table)) {
    plan.planes = plan.planes.map(p => Math.hypot(p.normal[0], p.normal[1]) < 1e-10 && p.normal[2] > 0
      ? { ...p, table: true } : p);
  }
  plan.metadata = { ...plan.metadata, geometryEnvelope: 'analytic-halfspaces-v1' };
  const compiled = compilePlan(plan);
  if (!compiled.audit.passed) throw new Error(`ANALYTIC_IMPORT_AUDIT: ${compiled.audit.errors.join(', ')}`);
  return { ...compiled.plan, mmPerUnit: compiled.audit.mmPerUnit };
}
