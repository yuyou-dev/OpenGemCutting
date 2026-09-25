import { createPattern } from '../core/application/patternPlan.js';
import { importEditor96 } from '../core/application/import96.js';
import { normalizeAnalyticPlan } from '../core/application/importAnalytic.js';
import { makeProject, saveProject, readProject } from '../core/application/patternProjects.js';
import { previewPolygons } from '../ui/planPreview.js';

export { listProjects, renameProject, duplicateProject, deleteProject, migrateLegacyProject } from '../core/application/patternProjects.js';

export const PROJECT_TEMPLATES = [
  { id: 'eight', label: '八向 · 96 齿', teeth: 96, symmetry: 8, name: '八向图案' },
  { id: 'nine', label: '九向 · 99 齿', teeth: 99, symmetry: 9, name: '九向图案' },
  { id: 'twelve', label: '十二向 · 360 齿', teeth: 360, symmetry: 12, name: '十二向图案' },
  { id: 'five', label: '五向 · 120 齿', teeth: 120, symmetry: 5, name: '五向图案' },
];

export function projectPreview(id) {
  const record = readProject(undefined, id);
  return record ? previewPolygons(record.plan) : { ok: false };
}

export function generateProjectPlan(template, density, sizeMm) {
  const { teeth, symmetry } = PROJECT_TEMPLATES.find(t => t.id === template);
  return createPattern({ teeth, symmetry, density, sizeMm });
}

export async function readPresetPlan(preset) {
  const response = await fetch(`/facet96-presets/${preset.document}`);
  if (!response.ok) throw new Error(`预设文件读取失败：${response.status}`);
  return importEditor96(await response.json());
}

export async function readProjectFile(file) {
  if (file.size > 5e6) throw new Error('JSON 超过 5 MB。');
  const data = JSON.parse(await file.text());
  if (data.kind === 'facet-projection-graph') throw new Error('约束图不是琢型计划，不能作为新建工程的来源。');
  return data.kind === 'facet-96-document' ? importEditor96(data) : normalizeAnalyticPlan(data);
}

export function createProject(plan, name) {
  return saveProject(undefined, makeProject(plan, { name }));
}
