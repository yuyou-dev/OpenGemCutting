import { Button } from '../controls.jsx';
import { Modal } from './Modal.jsx';

export function AuditDialog({ controller, snap }) {
  return (
    <Modal controller={controller} title="几何与工艺诊断" large>
      <p>
        当前编译的完整审计输出。几何检查不是工艺认证；警告必须由切磨者逐条核对。
      </p>
      {snap.metrics ? <dl className="inspection-metrics">{[['有效切面',snap.metrics.effective],['磨砂切面',snap.metrics.frosted],['最短棱',`${snap.metrics.minEdge} mm`],['机台平面误差',snap.metrics.residual]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
      <Button icon="download" label="导出切磨参数 CSV" onClick={() => controller.exportCutCSV()} />
      <h3>完整诊断记录</h3><pre className="json-view">{JSON.stringify(snap.compiled?.audit ?? null, null, 2)}</pre>
    </Modal>
  );
}
