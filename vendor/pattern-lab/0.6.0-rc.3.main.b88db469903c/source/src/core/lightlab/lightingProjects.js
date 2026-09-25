import { environmentPreset, LIGHT_PRESETS, OBSERVATION_PRESETS } from './presets.js';

export const PROJECT_STORAGE_KEY = 'suva.facet-pattern-lab.lightlab.lighting-projects.v1';
// Built-in preset descriptors; the user lighting library is no longer supported.
export const PROJECT_KIND = 'facet-96-lighting-project';
export const builtinProjects = () => [...LIGHT_PRESETS, ...OBSERVATION_PRESETS].map(p => ({
  kind: PROJECT_KIND, schemaVersion: 1, id: p.id, name: p.label, description: p.note,
  category: OBSERVATION_PRESETS.some(o => o.id === p.id) ? 'observation' : 'photography',
  builtin: true, environment: environmentPreset(p.id),
}));
