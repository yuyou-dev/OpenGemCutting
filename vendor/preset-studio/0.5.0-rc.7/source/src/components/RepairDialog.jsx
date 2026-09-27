import { useEffect, useRef } from 'react';
import { Modal } from './Modal.jsx';
import { ParameterViewport } from '../viewport/viewport.js';

/** Reconstruction candidate comparison: dashed exact target vs solid integer candidate. */
export function RepairDialog({ store, dialog }) {
    const canvasRef = useRef(null);
    useEffect(() => {
        const pv = new ParameterViewport(canvasRef.current);
        pv.setData(dialog.result.polys, dialog.result.targetPolys);
        return () => pv.destroy();
    }, [dialog]);
    return <Modal title={dialog.scope === 'all' ? '整套冠亭 · 整齿重构预览' : '当前组件 · 整齿重构预览'} confirmText="接受近似重构" confirmDisabled={!dialog.safeResult} onClose={store.closeDialog} onConfirm={() => store.acceptRepair()}>
        <p>这不是无损缩放。将方位吸附到 {dialog.teeth} 的整数齿，保持目标倾角，再拟合平面偏移；可能改变交点、长宽比和拓扑。确认后转为自定义几何。</p>
        <div className="ps-repair-preview-wrap"><canvas ref={canvasRef} aria-label="整齿重构对比线框" /></div>
        <div className="ps-repair-legend">灰色虚线：精确目标 · 实线：整齿候选（当前件）</div>
        <div className="ps-repair-measures">
            <span>改向平面 <b>{dialog.changed}</b></span>
            <span>最大方位改动 <b>{dialog.maxAngle.toFixed(5)}°</b></span>
            <span>最大目标面残差 <b>{dialog.maxResidual.toFixed(6)} R</b></span>
            <span>当前件体积变化 <b>{(dialog.volumeChange * 100).toFixed(3)}%</b></span>
            <span>原有显露面消失 <b>{dialog.lostFaces}</b></span>
            <span>交点连接变化 <b>{dialog.topologyChanged ? '有，需检查' : '未检测到'}</b></span>
        </div>
        <p>{dialog.safeResult ? '请比较线框与残差，确认接受近似结果；原几何保存在撤销历史中。' : '候选未通过完整性检查，已禁止接受。请改用其他分度或调整形变比例。'}</p>
    </Modal>;
}
