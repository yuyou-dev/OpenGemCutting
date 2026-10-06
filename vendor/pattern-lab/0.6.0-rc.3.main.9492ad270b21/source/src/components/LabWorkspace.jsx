import { useSyncExternalStore } from 'react';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../styles.css';
import { TopRail } from './TopRail.jsx';
import { ParametersPanel } from './ParametersPanel.jsx';
import { PlanStage } from './PlanStage.jsx';
import { InspectionPanel } from './InspectionPanel.jsx';
import { StatusFooter } from './StatusFooter.jsx';
import { ModalHost } from './dialogs/index.jsx';
import { OpticalComparison } from './OpticalComparison.jsx';

export function LabWorkspace({ controller, onBackHome, hostActions, presentation }) {
  const snap=useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  return (
    <>
      <TopRail controller={controller} snap={snap} onBackHome={onBackHome} hostActions={hostActions} presentation={presentation} />
      {snap.workspace === 'comparison' ? <OpticalComparison controller={controller} snap={snap} /> : <main id="design-workspace" className="layout">
        <ParametersPanel controller={controller} snap={snap} />
        <PlanStage controller={controller} snap={snap} />
        <InspectionPanel controller={controller} snap={snap} />
      </main>}
      <StatusFooter controller={controller} snap={snap} />
      <div className={`drawer-backdrop${snap.drawerOpen ? ' open' : ''}`} onClick={() => controller.closeDrawers()} />
      <ModalHost controller={controller} snap={snap} />
    </>
  );
}
