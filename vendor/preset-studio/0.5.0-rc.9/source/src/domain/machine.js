/** Fixed-axis manufacturing policy. Camera motion is deliberately outside this module.
 * Sources and the meaning of 'hardware' are recorded in docs/architecture/indexing-research.md.
 */
import { normalizeTransform, normalizePlane, deg, finite } from './math.js';
export const INDEX_TOLERANCE = 1e-7; // teeth; numerical equality, NOT a cutting tolerance
export const GEAR_CATALOG = Object.freeze([
    { teeth:32, kind:'hardware', sources:['ultratec','facetron','gemcad'], note:'厂商列售 / GemCad' },
    { teeth:64, kind:'hardware', sources:['ultratec','facetron','gemcad'], note:'厂商列售 / GemCad' },
    { teeth:72, kind:'hardware', sources:['ultratec','facetron','gemcad'], note:'厂商列售；含 9 次对称' },
    { teeth:77, kind:'hardware', sources:['ultratec','facetron'], note:'厂商列售；含 7、11 次对称' },
    { teeth:80, kind:'hardware', sources:['ultratec','facetron','gemcad'], note:'厂商列售；含 5 次对称' },
    { teeth:84, kind:'hardware', sources:['ultratec','facetron','gemcad'], note:'厂商列售；含 7 次对称' },
    { teeth:88, kind:'documented', sources:['facetron-overview','gemcad'], note:'GemCad / 厂商介绍页；购置需核对' },
    { teeth:96, kind:'hardware', sources:['ultratec','facetron','gemcad','gcs'], note:'常用分度盘' },
    { teeth:99, kind:'hardware', sources:['facetron'], note:'Facetron 列售；含 9、11 次对称' },
    { teeth:120, kind:'hardware', sources:['ultratec','facetron','gemcad'], note:'厂商列售 / GemCad' },
    { teeth:360, kind:'software', sources:['gemcad'], note:'GemCad 软件预设；硬件未核实' }
]);
export function validateGear(teeth) {
    if (!Number.isInteger(teeth) || teeth < 1 || teeth > 10000)
        throw new RangeError('分度盘齿数必须为 1–10000 的整数');
    return teeth;
}
export function normalizeMachineProfile(input = {}) {
    if(input.version !== undefined && input.version !== 1) throw new Error('未知机台配置版本');
    const teeth = validateGear(input.teeth ?? 96);
    if ((input.axis !== undefined && input.axis !== 'z') ||
        (input.integerOnly !== undefined && input.integerOnly !== true) ||
        (input.direction !== undefined && input.direction !== 'ccw'))
        throw new Error('本版固定 Z 轴、逆时针整数分度；不允许解锁或改轴');
    return { version:1, axis:'z', integerOnly:true, direction:'ccw', teeth };
}
export function rotationIndex(angle, teeth = 96) {
    validateGear(teeth); finite(angle, '旋转角');
    return angle * teeth / 360;
}
export function snapIndex(index, teeth = 96) {
    validateGear(teeth); finite(index, '齿号');
    return ((Math.round(index) % teeth) + teeth) % teeth;
}
/** Does not 'fix' illegal axis placement. Reject it at every data boundary. */
export function normalizeAxialTransform(input = {}, { teeth, snap = false } = {}) {
    const t = normalizeTransform(input);
    if (t.translation[0] !== 0 || t.translation[1] !== 0 || t.rotation[0] !== 0 || t.rotation[1] !== 0)
        throw new Error('加工轴已锁定：X/Y 位移和 X/Y 倾斜必须为 0；只允许沿 Z 升降、绕 Z 转动');
    if (teeth !== undefined) {
        const i = rotationIndex(t.rotation[2], teeth);
        if (!snap && Math.abs(i - Math.round(i)) > INDEX_TOLERANCE)
            throw new Error(`${t.rotation[2].toFixed(6)}° 产生非整数分度，不是 ${teeth} 分度的整齿旋转；请先重置旋转或选兼容分度，不会自动改变形状`);
        t.rotation[2] = snapIndex(i, teeth) * 360 / teeth;
    }
    return t;
}
/** Rotation lattice membership uses every plane, not just the declared symmetry. */
export function machineReport(planes, teeth = 96) {
    validateGear(teeth);
    const rows = planes.filter(p => p.role !== 'interface').map(raw => {
        const p = normalizePlane(raw), radial = Math.hypot(p.n[0], p.n[1]), axial = radial < 1e-10;
        const az = axial ? 0 : (deg(Math.atan2(p.n[1], p.n[0])) + 360) % 360;
        const index = az * teeth / 360, signedError = index - Math.round(index), nearest = snapIndex(index, teeth);
        return { id:p.id, tier:p.tier, axial, index, nearest, azimuth:az, angle:deg(Math.atan2(radial, Math.abs(p.n[2]))), errorDeg:Math.abs(signedError) * 360 / teeth, exact:axial || Math.abs(signedError) <= INDEX_TOLERANCE };
    });
    return { teeth, exact:rows.every(r => r.exact), incompatible:rows.filter(r => !r.exact).length,
        maxErrorDeg:Math.max(0, ...rows.map(r => r.errorDeg)),
        rmsErrorDeg:Math.sqrt(rows.reduce((s,r) => s + r.errorDeg*r.errorDeg,0) / Math.max(1,rows.length)), rows };
}
export function assertIntegerPlanes(planes, teeth = 96) {
    const report = machineReport(planes, teeth);
    if (!report.exact)
        throw new Error(`${teeth} 分度未通过：${report.incompatible} 面不是整数齿号，最大方位偏差 ${report.maxErrorDeg.toFixed(5)}°；请换兼容分度或显式整齿重构`);
    return report;
}
export function compatibleGears(planes, current = 96) {
    const candidates = [...new Set([...GEAR_CATALOG.map(g => g.teeth), current, 144, 180, 192, 240, 288, 480, 576, 720])].sort((a,b) => a-b);
    return candidates.filter(teeth => machineReport(planes, teeth).exact).map(teeth => ({
        ...(GEAR_CATALOG.find(g => g.teeth === teeth) || { teeth, kind:'custom', note:'计算候选；需具备对应硬件' }),
        exact:true
    }));
}
export function symmetryDivisors(teeth) {
    validateGear(teeth);
    return Array.from({length:Math.min(teeth,32)},(_,i)=>i+1).filter(n => teeth % n === 0);
}
/** Pull a world-space plane back into a fixed-axis instance's local coordinates. */
export function planeToAxialLocal(raw, transform) {
    const p = normalizePlane(raw), t = normalizeAxialTransform(transform), angle = -t.rotation[2]*Math.PI/180;
    const n = [Math.cos(angle)*p.n[0]-Math.sin(angle)*p.n[1],Math.sin(angle)*p.n[0]+Math.cos(angle)*p.n[1],p.n[2]].map((v,i)=>v*t.scale[i]);
    const length = Math.hypot(...n);
    return {...p,n:n.map(v=>v/length),d:(p.d-p.n[2]*t.translation[2])/length};
}
