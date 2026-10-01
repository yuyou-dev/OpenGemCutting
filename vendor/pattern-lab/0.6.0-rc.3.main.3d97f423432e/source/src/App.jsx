import { useEffect, useMemo, useState } from 'react';
import { createLabController } from './state/labController.js';
import { projectPersistence } from './state/projectPersistence.js';
import { HomePage } from './components/HomePage.jsx';
import { LabWorkspace } from './components/LabWorkspace.jsx';

export default function App() {
  const [screen, setScreen] = useState('home');
  const [projectId, setProjectId] = useState(null);

  const openProject = (id) => {
    setProjectId(id);
    setScreen('lab');
  };

  if (screen === 'home') {
    return <div className="facet-pattern-lab standalone"><HomePage onOpen={openProject} onCreated={openProject} /></div>;
  }
  return <div className="facet-pattern-lab standalone"><LabScreen projectId={projectId} onBackHome={() => setScreen('home')} /></div>;
}

function LabScreen({ projectId, onBackHome }) {
  const {controller,error}=useMemo(()=>{
    try{return {controller:createLabController({persistence:projectPersistence(projectId)})};}
    catch(error){return {error:error.message};}
  },[projectId]);

  useEffect(() => {
    if(!controller)return;
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  if(error)return <section className="home"><h1>工程未打开</h1><p>{error}</p><p>原始工程记录保持不变。请保留来源文件或恢复备份后重试。</p><button onClick={onBackHome}>返回首页</button></section>;
  return <LabWorkspace controller={controller} onBackHome={onBackHome} />;
}
