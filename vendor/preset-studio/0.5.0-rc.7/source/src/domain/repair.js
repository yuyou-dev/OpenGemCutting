/** Explicit, audited approximation; never silently used by scale or gear changes.
 * Locks azimuth to nearest tooth, keeps each affinely transformed inclination,
 * then fits plane offsets to its transformed face vertices in least squares.
 * This is not a global meet-preserving solver. Residuals and topology are reported.
 */
import { clone, dot, rad, transformPlane, transformPoint, signedVolume, boundingBox, uniquePoints } from './math.js';
import { validateMesh } from './io.js';
import { componentPreview } from './generators.js';
import { geometryStats, topologySignature } from './geometry.js';
import { normalizeAxialTransform, machineReport, validateGear } from './machine.js';
export function rebuildIntegerComponent(component, transform, teeth = 96) {
    validateGear(teeth);
    const t = normalizeAxialTransform(transform), placement = { translation:[0,0,t.translation[2]], rotation:[0,0,0], scale:[1,1,1] };
    const linear = { ...t, translation:[0,0,0] }, sourcePreview = componentPreview(component);
    if (!sourcePreview.length || sourcePreview.some(f => f.role === 'stock'))
        throw new Error('无法重构未闭合的组件；请补齐腰口侧面与顶部边界');
    const targetPolys = sourcePreview.map(f => ({ ...f, v:f.v.map(v => transformPoint(v, linear)) }));
    const sourcePlanes = component.planes.map(p => transformPlane(p, linear)), before = machineReport(sourcePlanes, teeth);
    const residuals = [], candidate = clone(component);
    delete candidate.recipe; delete candidate.unresolvedRecipe;
    candidate.family = 'custom';
    candidate.planes = sourcePlanes.map((p,i) => {
        const row = before.rows[i];
        if (!row) throw new Error('重构只接受真实工序平面，不接受预览封口面');
        const radial = Math.hypot(p.n[0],p.n[1]), theta = rad(row.nearest * 360 / teeth);
        const n = row.exact ? p.n.slice() : [radial*Math.cos(theta),radial*Math.sin(theta),p.n[2]];
        const face = targetPolys.find(f => f.id === p.id);
        // Inactive retained instructions have no boundary vertices: use footpoint.
        const anchors = face?.v || [p.n.map(v => v*p.d)];
        const d = row.exact ? p.d : anchors.reduce((s,v) => s+dot(n,v),0) / anchors.length;
        const errors = anchors.map(v => Math.abs(dot(n,v)-d));
        residuals.push({id:p.id, active:!!face, azimuthDeltaDeg:row.errorDeg, maxPlaneResidual:Math.max(...errors), rmsPlaneResidual:Math.sqrt(errors.reduce((s,x)=>s+x*x,0)/errors.length)});
        return {...p,n,d};
    });
    const afterPolys = componentPreview(candidate), stats = geometryStats(afterPolys,candidate.planes);
    const oldActive = new Set(targetPolys.filter(f=>f.role!=='interface').map(f=>f.id));
    const afterActive = new Set(afterPolys.filter(f=>f.role!=='interface').map(f=>f.id));
    const lost = [...oldActive].filter(id=>!afterActive.has(id));
    let meshError=null;try{validateMesh(afterPolys);}catch(e){meshError=e.message;}
    const beforeVolume = signedVolume(targetPolys), afterVolume = signedVolume(afterPolys);
    const beforeBox = boundingBox(targetPolys), afterBox = boundingBox(afterPolys);
    // Incidence changes detect split/merged meet vertices even if counts coincide.
    const incidentSignature = (polys, planes) => uniquePoints(polys.flatMap(f=>f.v)).map(v =>
        planes.filter(p => Math.abs(dot(p.n,v)-p.d)<2e-6).map(p=>p.id).sort().join('|')
    ).sort().join('\n');
    const incidenceChanged = incidentSignature(targetPolys,sourcePlanes) !== incidentSignature(afterPolys,candidate.planes);
    const report = { teeth, method:'nearest-azimuth-centroid-plane-fit-v1', changedPlanes:before.incompatible,
        maxAzimuthDeltaDeg:before.maxErrorDeg,
        maxPlaneResidual:Math.max(0,...residuals.filter(r=>r.active).map(r=>r.maxPlaneResidual)),
        beforeVolume, afterVolume, relativeVolumeChange:beforeVolume ? afterVolume/beforeVolume-1 : null,
        beforeSize:beforeBox.size, afterSize:afterBox.size,
        meshValid:!meshError, meshError, lostFaces:lost, topologyChanged:incidenceChanged, beforeTopology:topologySignature(targetPolys), afterTopology:topologySignature(afterPolys), residuals,
        safe:!meshError && afterVolume>1e-9 && lost.length===0 && !afterPolys.some(f=>f.role==='stock') && machineReport(candidate.planes,teeth).exact
    };
    candidate.provenance = { type:'explicit-integer-reconstruction', license:component.provenance?.license || 'unspecified', derivedFrom:component.id, method:report.method };
    candidate.reconstruction = { teeth, sourceName:component.name, changedPlanes:report.changedPlanes, maxAzimuthDeltaDeg:report.maxAzimuthDeltaDeg, maxPlaneResidual:report.maxPlaneResidual, topologyChanged:report.topologyChanged };
    candidate.notes = '用户确认的整齿近似重构。保持齿号，不保证原交点、长宽比或拓扑不变；原状态可撤销。';
    return {component:candidate,transform:placement,report,targetPolys,polys:afterPolys};
}
