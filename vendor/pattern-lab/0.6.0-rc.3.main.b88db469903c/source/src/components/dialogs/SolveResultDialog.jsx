import { Button } from '../controls.jsx';
import { Modal } from './Modal.jsx';

export function SolveResultDialog({ controller, snap }) {
  const solve = snap.solveResult;
  if (!solve) return null;
  return (
    <Modal
      controller={controller}
      title="共享节点联合求解"
      footer={
        <>
          <Button onClick={() => controller.downloadSolveResult()} label="下载求解结果" icon="download" />
          {solve.canReplace ? (
            <Button className="primary" onClick={() => controller.applySolvedCrown()} label="以求解冠部替换当前冠部" />
          ) : null}
        </>
      }
    >
      <pre className="json-view">{JSON.stringify(solve.body, null, 2)}</pre>
      {solve.canReplace ? (
        <p>求解通过且齿轮一致：可以替换当前冠部，亭部与腰部参数保持不变。</p>
      ) : (
        <p>未提供替换操作：求解未通过，或求解图齿轮与当前计划不一致。</p>
      )}
    </Modal>
  );
}
