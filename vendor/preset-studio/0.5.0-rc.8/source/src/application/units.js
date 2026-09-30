/** Native geometry stays in the host's coordinates; never infer millimeters. */
export function modelUnits(model) {
    const native = model.nativeDocument;
    const scale = native?.metadata?.physicalScale?.millimetersPerModelUnit ?? native?.stock?.source?.millimetersPerModelUnit;
    return { label: native ? 'u' : 'R', description: native
        ? Number.isFinite(scale) && scale > 0 ? `1 模型单位（u）= ${scale} mm；来源坐标与切深参考保持不变。` : 'u 为来源模型单位，尚未标定实际尺寸。'
        : 'R 为归一化参考半径。' };
}
