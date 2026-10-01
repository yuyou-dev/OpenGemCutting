/** Shared catalog fetch for the Facet 96 preset library; used by the
 * new-project dialog so the import entry lives outside the editor. */
export async function fetchPresetCatalog() {
  const response = await fetch('/facet96-presets/catalog.json');
  if (!response.ok) throw new Error(`预设目录读取失败：${response.status}`);
  return response.json();
}
