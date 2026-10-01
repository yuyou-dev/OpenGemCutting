import brandLogo from '../assets/logo-header.webp';
import { useEffect, useRef } from 'react';
import pkg from '../../package.json';
import { Button, Icon, IconButton } from './controls.jsx';

export function TopRail({ controller, snap, onBackHome, hostActions, presentation }) {
  const menu = useRef(null);
  const embedded = presentation?.layout === 'embedded';
  const moduleResult = !hostActions || presentation?.resultAction !== 'host';

  useEffect(() => {
    function dismiss(e) {
      if (menu.current && !menu.current.contains(e.target)) menu.current.open = false;
    }
    function onKey(e) {
      if (e.key === 'Escape' && menu.current) menu.current.open = false;
    }
    const target=menu.current?.closest('.facet-pattern-lab');
    target?.addEventListener('pointerdown', dismiss);
    target?.addEventListener('keydown', onKey);
    return () => {
      target?.removeEventListener('pointerdown', dismiss);
      target?.removeEventListener('keydown', onKey);
    };
  }, []);

  function run(action) {
    menu.current.open = false;
    action();
  }

  return (
    <header className={`header rail workspace-header${embedded ? ' embedded-rail' : ''}`}>
      {!embedded && <div className="header-left">
        {onBackHome?<IconButton icon="left" label="返回首页" onClick={onBackHome} />:null}
        <button className="brand" onClick={() => controller.openModal('help')} title="关于图案实验室">
          <span className="brand-mark"><img src={brandLogo} alt="" width={30} height={30} /></span>
          <span className="brand-text">
            <span className="brand-title"><strong>图案实验室</strong><em>Alpha</em></span>
            <small>SUVA · FACET 96 专业版</small>
          </span>
        </button>
        <span className="lab-version">{pkg.version}</span><span className="document-name" title={snap.plan.name}>{snap.plan.name}</span>
        {!hostActions?<details className="file-menu" ref={menu}>
          <summary>文件 <Icon name="chevron" size={14} /></summary>
          <div className="file-menu-content">
            <button type="button" onClick={() => run(() => controller.savePlan())}><Icon name="download" />下载计划 JSON</button>
            {snap.hasRecovery?<button type="button" onClick={()=>run(()=>controller.saveRecovery())}><Icon name="download" />下载迁移前数据</button>:null}
            <button type="button" onClick={() => run(() => controller.exportCutCSV())}><Icon name="download" />导出切磨参数 CSV</button>
          </div>
        </details>:null}
      </div>}
      <nav className="workspace-nav" aria-label="工作区切换">
        {[['design', '图案设计', 'edit'], ['comparison', '光学对比', 'photo']].map(([id, label, icon]) => (
          <button key={id} type="button" aria-pressed={snap.workspace === id}
            className={snap.workspace === id ? 'active' : ''} onClick={() => controller.setWorkspace(id)}>
            <Icon name={icon} size={16} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="header-actions">{snap.workspace === 'design' && <IconButton className="mobile-only" icon="settings" label="打开设计设置" onClick={() => controller.openDrawer('left')} />}<IconButton icon="help" label="操作帮助" onClick={() => controller.openModal('help')} />
        <IconButton onClick={() => controller.undo()} icon="undo" label="撤销" disabled={!snap.canUndo} />
        <IconButton onClick={() => controller.redo()} icon="redo" label="重做" disabled={!snap.canRedo} />
        {!embedded && <span className="save-status" title={hostActions?"实验稿保存由宿主提供的持久化接口完成":"设计自动保存到本机浏览器；文件菜单可另存为 JSON"}>{snap.saveStatus}</span>}
        {moduleResult && <span className="separator" />}
        {moduleResult && <Button onClick={() => hostActions?hostActions.returnResult().catch(error=>controller.reportError(`返回失败：${error.message}`)):controller.requestExport96()} label={hostActions?"返回候选结果":"导出 Facet 文档"} icon="download" className="primary" title={snap.export96Title} disabled={snap.export96Disabled} />}
        {snap.workspace === 'design' && <IconButton className="mobile-only" icon="settings" label="打开属性面板" onClick={() => controller.openDrawer('right')} />}
      </div>
    </header>
  );
}
