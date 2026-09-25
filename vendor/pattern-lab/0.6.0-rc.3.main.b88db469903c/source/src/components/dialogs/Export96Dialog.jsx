import { Button } from '../controls.jsx';
import { Modal } from './Modal.jsx';

export function Export96Dialog({ controller, snap }) {
  const warnings = snap.compiled?.audit.warnings ?? [];
  return (
    <Modal
      controller={controller}
      title="导出前确认"
      footer={
        <>
          <Button onClick={() => controller.closeModal()} label="取消" />
          <Button className="primary" onClick={() => controller.confirmExport96()} label="确认提示并导出" />
        </>
      }
    >
      <p>几何将以公共平面文档导出，保留 {snap.plan.machine.teeth} 齿读数和完整工序。</p>
      {warnings.length ? (
        <ul className="warning-list">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : (
        <p>本次编译没有警告。</p>
      )}
      <p>
        几何检查不是工艺认证。主项目可读几何与表面元数据；磨砂渲染由宿主能力决定。
        小数索引保持精确，不自动取整；受影响工序的失效关联会保留来源说明。
      </p>
    </Modal>
  );
}
