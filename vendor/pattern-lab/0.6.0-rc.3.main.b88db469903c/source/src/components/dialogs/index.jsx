import { ScaleDialog } from './ScaleDialog.jsx';
import { EditResultDialog } from './EditResultDialog.jsx';
import { HelpDialog } from './HelpDialog.jsx';
import { AuditDialog } from './AuditDialog.jsx';
import { Export96Dialog } from './Export96Dialog.jsx';
import { SolveResultDialog } from './SolveResultDialog.jsx';

export function ModalHost({ controller, snap }) {
  if (!snap.modal) return null;
  switch (snap.modal.kind) {
    case 'scale': return <ScaleDialog controller={controller} snap={snap} />;
    case 'edit-review':
    case 'edit-details':
      return <EditResultDialog controller={controller} snap={snap} />;
    case 'help':
      return <HelpDialog controller={controller} />;
    case 'audit':
      return <AuditDialog controller={controller} snap={snap} />;
    case 'export96':
      return <Export96Dialog controller={controller} snap={snap} />;
    case 'solve-result':
      return <SolveResultDialog controller={controller} snap={snap} />;
    default:
      return null;
  }
}
