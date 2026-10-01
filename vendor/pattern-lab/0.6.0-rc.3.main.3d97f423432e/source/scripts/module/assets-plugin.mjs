// Both entry points use the same font files under module-owned CSS family names.
export function labFonts() {
  return { name: 'pattern-lab-font-families', enforce: 'pre', transform(code, id) {
    if (!id.includes('/@fontsource') || !id.endsWith('.css')) return;
    return code.replaceAll('Noto Sans SC Variable', 'Facet Pattern Lab Sans')
      .replaceAll('IBM Plex Mono', 'Facet Pattern Lab Mono');
  } };
}
