/** Per-project persistence adapter for labController: reads and writes the
 * plan body of a patternProjects record, keeping name/updatedAt in sync. */
import { readProject, saveProject } from '../core/application/patternProjects.js';

export function projectPersistence(id) {
  return {
    load: () => readProject(undefined, id)?.plan ?? null,
    recover: () => readProject(undefined,id)?.recovery?.originalPlan??null,
    save(plan) {
      const record = readProject(undefined, id);
      if (!record) return;
      saveProject(undefined, {
        ...record,
        recovery: record.recovery??{originalPlan:structuredClone(record.plan)},
        plan,
        name: plan.name ?? record.name,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
