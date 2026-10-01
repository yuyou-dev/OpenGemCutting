export function StatusFooter({ controller, snap }) {
  return (
    <footer className="footer">
      <div className="footer-left">
        <span className="footer-mode">精准编辑 · 实时检视</span>
        <span>{snap.footerState}</span>
      </div>
      <button className="diagnostics-link" onClick={() => controller.openModal('audit')}>检查详情 ↗</button><div className="footer-right">
        <span>{snap.compiled.audit.mmPerUnit===null?'毫米尺度未标定':'坐标单位：mm'}</span>
        <span className="footer-disclaimer">所有计算与文件均在本机处理</span>
      </div>
    </footer>
  );
}
