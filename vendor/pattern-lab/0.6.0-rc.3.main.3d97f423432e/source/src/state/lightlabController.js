import { INITIAL_RENDER, RENDER_CHOICES, RENDER_RANGES, renderSettings } from '../core/lightlab/renderSettings.js';
import { LightLabRenderer } from '../render/lightlab/renderer.js';
import { absorptionRGB } from '../ui/materials.js';
import { environmentPreset } from '../core/lightlab/presets.js';
import { validateEnvironment } from '../core/lightlab/environment.js';
import { builtinProjects, PROJECT_STORAGE_KEY } from '../core/lightlab/lightingProjects.js';
import { domeMarks, domeAngles } from '../ui/lightDome.js';

export const LIGHTLAB_STORAGE_KEY = 'suva.facet-pattern-lab.lightlab.session.v1';
const DISPLAY_RENDER_KEYS = new Set(['exposure', 'toneMapping', 'denoise']);

/** Comparison state stays separate from geometry history. The GPU instance
 * exists only while its host canvas is mounted in the comparison workspace.
 * Lighting is view-only plus dome dragging: no light add/remove, no user
 * preset library — the ten builtins are the only projects. */
export function createLightlabController({ getScene, getMaterial, getCamera, notify, download, storage = globalThis.localStorage, createRenderer = (kind, canvas, progress) => new LightLabRenderer(canvas, progress) }) {
  let environment = environmentPreset('studio');
  let render = { ...INITIAL_RENDER };
  let allPolished = false, paused = false, visible = false;
  let selectedLightId = environment.lights[0]?.id ?? null, hemisphere = 'upper';
  let libraryError = '', drag = null;
  let progress = '等待预览';
  let liveReady = false;
  let lastScene = null, lastMaterialKey = '', lastCameraKey = '';
  const canvases = {}, renderers = {}, viewports = {};
  const builtins = builtinProjects();

  // The user lighting library was removed; drop its leftover storage key.
  try { storage?.removeItem(PROJECT_STORAGE_KEY); } catch {}

  try {
    const saved = JSON.parse(storage?.getItem(LIGHTLAB_STORAGE_KEY));
    if (saved) {
      environment = validateEnvironment(saved.environment);
      render = renderSettings(render, saved.render ?? {});
      allPolished = !!saved.allPolished;
      focusLight(environment.lights[0]);
    }
  } catch {}

  const selectedLight = () => environment.lights.find(light => light.id === selectedLightId) ?? null;

  function focusLight(light) {
    selectedLightId = light?.id ?? null;
    hemisphere = light?.elevation < 0 ? 'lower' : 'upper';
  }

  function getSnapshot() {
    return { environment, render, renderChoices: RENDER_CHOICES, renderRanges: RENDER_RANGES, allPolished, paused, selectedLightId, selectedLight: selectedLight(), hemisphere,
      domeMarks: domeMarks(environment, selectedLightId, hemisphere), projects: builtins, activeProjectId: environment.projectId, libraryError,
      progress, liveReady, materialLabel: getMaterial().label,
    };
  }

  function persist() {
    try { storage?.setItem(LIGHTLAB_STORAGE_KEY, JSON.stringify({ environment, render, allPolished })); } catch {}
  }

  function onProgress(kind, info) {
    if (kind !== 'lightlab') return;
    const text = info.error ?? `${info.sample} / ${info.target} spp · ${info.width} × ${info.height}`;
    progress = text;
    liveReady = !info.error && info.sample > 0;
    notify();
  }

  function attachCanvas(kind, canvas) {
    if (canvases[kind] === canvas && (kind === 'export' || !visible || renderers[kind])) return;
    renderers[kind]?.dispose();
    delete renderers[kind];
    if (!canvas) {
      delete canvases[kind];
      if (kind === 'lightlab') liveReady = false;
      return;
    }
    canvases[kind] = canvas;
    if (kind === 'export' || !visible) return;
    try {
      renderers[kind] = createRenderer(kind, canvas, info => onProgress(kind, info));
      resize(kind);
      updateLive();
    } catch (error) {
      renderers[kind]?.dispose();
      delete renderers[kind];
      onProgress(kind, { error: `无法建立光学预览：${error.message}` });
    }
  }

  function resize(kind) {
    const renderer = renderers[kind], size = viewports[kind];
    if (!renderer || !size) return;
    const [width, height] = size;
    renderer.setSize(Math.round(render.resolution * width / height), render.resolution);
  }

  function setViewport(kind, width, height) {
    if (!(width > 0 && height > 0)) return;
    if (viewports[kind]?.[0] === width && viewports[kind]?.[1] === height) return;
    viewports[kind] = [width, height];
    resize(kind);
    updateLive();
  }

  function updateLive(interactive = false) {
    const renderer = renderers.lightlab;
    if (!visible || !renderer || !getScene()) return;
    const material = getMaterial();
    renderer.setScene(getScene());
    renderer.setInteractive(interactive);
    renderer.setCamera(getCamera(...(viewports.lightlab ?? [400, 400])));
    renderer.setOptions({ ...render, ior: material.ior, sigma: absorptionRGB(material), dispersion: material.dispersion, environment, allPolished });
    if (!paused) renderer.start(interactive ? 2 : render.targetSamples);
    else renderer.stop();
  }

  function syncModel() {
    if (!visible) return;
    const scene = getScene(), materialKey = JSON.stringify(getMaterial());
    if (scene === lastScene && materialKey === lastMaterialKey) return;
    lastScene = scene; lastMaterialKey = materialKey;
    updateLive();
  }

  function cameraChanged(interactive = false) {
    if (!visible) return;
    const key = JSON.stringify(getCamera(...(viewports.lightlab ?? [400, 400])));
    if (interactive && key === lastCameraKey) return;
    lastCameraKey = key;
    updateLive(interactive);
  }

  function setVisible(next) {
    visible = !!next;
    if (!visible) {
      for (const renderer of Object.values(renderers)) renderer.stop();
      cancelLightDrag();
    } else {
      for (const [kind, canvas] of Object.entries(canvases)) attachCanvas(kind, canvas);
      lastScene = null; syncModel();
    }
  }

  function changeEnvironment(next, interactive = false) {
    try {
      environment = validateEnvironment(next);
      if (!selectedLight()) focusLight(environment.lights[0]);
      libraryError = '';
      if (!interactive) persist();
      updateLive(interactive);
      notify();
      return true;
    } catch (error) { libraryError = error.message; notify(); return false; }
  }

  function setLight(patch) {
    if (!selectedLight()) return;
    changeEnvironment({ ...environment, lights: environment.lights.map(light => light.id === selectedLightId ? { ...light, ...patch, id: light.id } : light) }, !!drag);
  }
  function selectLight(id) {
    const light = environment.lights.find(light => light.id === id);
    if (!light) return;
    focusLight(light);
    notify();
  }
  function toggleLight(id) {
    changeEnvironment({ ...environment, lights: environment.lights.map(light => light.id === id ? { ...light, enabled: !light.enabled } : light) });
  }
  function soloLight(id) { changeEnvironment({ ...environment, solo: environment.solo === id ? null : id }); }
  function beginLightDrag(id) {
    if (!environment.lights.some(light => light.id === id)) return false;
    selectedLightId = id; drag = environment; notify(); return true;
  }
  function dragLightTo(x, y) {
    if (!drag) return;
    setLight(domeAngles(x, y, environment.rotation, hemisphere));
  }
  function endLightDrag() { if (!drag) return; drag = null; persist(); updateLive(); notify(); }
  function cancelLightDrag() { if (!drag) return; const original = drag; drag = null; changeEnvironment(original); }
  function nudgeLight(id, dx, dy) {
    selectLight(id);
    const light = selectedLight();
    if (light) setLight({ azimuth: ((light.azimuth + dx) % 360 + 360) % 360, elevation: Math.min(90, Math.max(-90, light.elevation + dy)) });
  }

  function loadProject(id) {
    const project = builtins.find(p => p.id === id);
    if (!project) return;
    focusLight(project.environment.lights[0]);
    return changeEnvironment({ ...structuredClone(project.environment), projectId: project.id, projectName: project.name, solo: null });
  }

  function setRender(patch) {
    const next = renderSettings(render, patch), resizeNeeded = next.resolution !== render.resolution;
    const changed = Object.keys(next).filter(key => next[key] !== render[key]);
    if (!changed.length) return;
    render = next;
    if (resizeNeeded) resize('lightlab');
    persist();
    if (changed.every(key => DISPLAY_RENDER_KEYS.has(key))) {
      if (visible) renderers.lightlab?.setOptions(Object.fromEntries(changed.map(key => [key, render[key]])));
    } else updateLive();
    notify();
  }
  function setAllPolished(value) { allPolished = !!value; persist(); updateLive(); notify(); }
  function setPaused(value) {
    paused = !!value;
    if (paused) Object.values(renderers).forEach(renderer => renderer.stop());
    else if (visible) renderers.lightlab?.start(render.targetSamples);
    notify();
  }
  function savePNG() {
    const output = canvases.export, source = canvases.lightlab;
    if (!output || !source || !liveReady) return;
    output.width = source.width; output.height = source.height + 42;
    const context = output.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height);
    context.fillStyle = '#111111'; context.font = '16px sans-serif';
    context.fillText(`图案实验室 · 光学验证 · ${allPolished ? '全抛光' : '当前表面'}`, 16, 27);
    context.drawImage(source, 0, 42, source.width, source.height);
    output.toBlob(blob => { if (blob) download('facet-lightlab.png', blob, 'image/png'); }, 'image/png');
  }

  function dispose() {
    visible = false;
    Object.values(renderers).forEach(renderer => renderer.dispose());
    for (const key of Object.keys(renderers)) delete renderers[key];
    for (const key of Object.keys(canvases)) delete canvases[key];
  }

  return {
    getSnapshot, attachCanvas, setViewport, setVisible, syncModel, cameraChanged, dispose,
    savePNG, setRender, setAllPolished, setPaused,
    selectLight, toggleLight, soloLight, setLight,
    setHemisphere(value) { hemisphere = value === 'lower' ? 'lower' : 'upper'; notify(); },
    beginLightDrag, dragLightTo, endLightDrag, cancelLightDrag, nudgeLight,
    loadProject,
  };
}
