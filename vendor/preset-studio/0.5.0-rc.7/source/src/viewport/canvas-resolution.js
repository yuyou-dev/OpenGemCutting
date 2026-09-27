/** CSS coordinates and backing-store pixels are deliberately separate.
 * Controls always hit-test in CSS pixels, including fractional browser zoom.
 * A pixel budget guards unusually large external monitors without changing layout.
 */
export function canvasMetrics(width, height, { dpr = globalThis.devicePixelRatio || 1, minRatio = 1, maxRatio = 4, maxPixels = 16000000 } = {}) {
    if (![width, height].every(Number.isFinite) || width < 0 || height < 0) throw new TypeError('Invalid canvas CSS size');
    const ratio = Math.min(maxRatio, Math.max(minRatio, Number.isFinite(dpr) && dpr > 0 ? dpr : 1));
    const limited = Math.min(ratio, Math.sqrt(maxPixels / Math.max(1, width * height)));
    const pixelWidth = Math.max(1, Math.floor(width * limited));
    const pixelHeight = Math.max(1, Math.floor(height * limited));
    return { width, height, pixelWidth, pixelHeight, scaleX: pixelWidth / Math.max(width, 1), scaleY: pixelHeight / Math.max(height, 1) };
}
export function resizeCanvas(canvas, rect, options) {
    const m = canvasMetrics(rect.width, rect.height, options);
    // Assigning even the SAME width resets a canvas context. Only resize when needed.
    if (canvas.width !== m.pixelWidth) canvas.width = m.pixelWidth;
    if (canvas.height !== m.pixelHeight) canvas.height = m.pixelHeight;
    return m;
}
export function cssCanvasContext(canvas, metrics) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(metrics.scaleX, 0, 0, metrics.scaleY, 0, 0);
    ctx.clearRect(0, 0, metrics.width, metrics.height);
    return ctx;
}
/** Re-arm matchMedia after a density change (e.g. moving to a Retina monitor).
 * ResizeObserver alone does not fire when DPR changes without a CSS-size change.
 */
export function watchPixelDensity(redraw, win = globalThis.window) {
    if (!win) return () => {};
    let query, disposed = false, lastDpr = win.devicePixelRatio || 1;
    const unbind = () => query?.removeEventListener?.('change', changed);
    const bind = () => { unbind(); query = win.matchMedia?.(`(resolution: ${win.devicePixelRatio || 1}dppx)`); query?.addEventListener?.('change', changed); };
    function changed() { if (disposed) return; lastDpr = win.devicePixelRatio || 1; bind(); redraw(); }
    bind();
    win.addEventListener('resize', changed);
    win.visualViewport?.addEventListener('resize', changed);
    // Some browser/embedded-window transitions update DPR but omit media/resize events.
    // Poll only this scalar, not geometry or pixels; idle canvases are never repainted.
    const timer = win.setInterval?.(() => {
        if (!win.document?.hidden && (win.devicePixelRatio || 1) !== lastDpr) changed();
    }, 750);
    return () => { disposed = true; unbind(); win.removeEventListener('resize', changed); win.visualViewport?.removeEventListener('resize', changed); if (timer !== undefined) win.clearInterval?.(timer); };
}
