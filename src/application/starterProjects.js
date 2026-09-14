import { projectDesign } from './projectDesign.js';

// Two contrasting, curated 96-index designs; retain their original names and provenance.
export const STARTER_PRESET_IDS = [
  '100626-pc-08-024-columbia-willamette',
  '100058-pc-07-001c-square-emerald-1-4',
];

export async function loadStarterProjects(library) {
  const catalog = await library.list();
  return Promise.all(STARTER_PRESET_IDS.map((presetId) => {
    const preset = catalog.find((item) => item.id === presetId);
    return projectDesign({ presetId, name: preset?.name }, library);
  }));
}
