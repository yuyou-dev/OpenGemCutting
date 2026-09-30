import './meet-audit.css';
import { useMemo } from 'react';
import { inspectMeetpoints } from '../application/meetInspection.js';
import { t } from '../i18n/locale.js';
import { Modal } from './Modal.jsx';

const reasons = {
  'active-concave-cuts': '此设计含启用的凹切，暂不支持交点检查。未用凹切前的实体代替成品。',
  'no-effective-cuts': '当前没有可检查的有效 CUT。请先保存切割。',
  'empty-or-zero-width': '当前实体为空或没有有效宽度，无法检查交点。',
};

export function MeetAuditDialog({ document, onClose }) {
  const r = useMemo(() => inspectMeetpoints(document), [document]);
  return <Modal title={t('交点检查')} className="meet-audit-dialog" onClose={onClose} closeLabel={t('返回工作台')}>
    <p>{t('检查完整已保存设计，包含临时隐藏层；未保存的预览不参与。')}</p>
    <p>{t('这些是待观察的候选，不是错误判决，不会阻止保存或交付。请结合刻面布局判断，零候选也不代表造型或光学合格。')}</p>
    {r.status === 'unsupported' ? <p role="status">{t(reasons[r.reason])}</p> : <>
      <dl className="meet-audit-metrics">
        {[
          ['相邻交点候选', r.nearMisses], ['短棱候选', r.splitMeets],
          ['小刻面候选', r.slivers], ['有效 CUT 面', r.facets],
          ['台面转角', r.tableCorners], ['多面交点占比', `${Math.round(r.multiMeetShare * 100)}%`],
          ['冠侧腰线高差', r.girdleSpread.crown ?? t('无分面腰')], ['亭侧腰线高差', r.girdleSpread.pavilion ?? t('无分面腰')],
          ['原胚壁面片', r.rawGirdlePieces], ['原胚壁冠侧高差', r.rawWallSpread.crown],
          ['原胚壁亭侧高差', r.rawWallSpread.pavilion],
        ].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}
      </dl>
      <p>{t('距离按成品 X 向宽度 W 归一；0.1% W 是分析聚类容差。相邻点小于 1% W、短棱小于 12% W，仅用于提示复查。')}</p>
      {r.worst.length + r.splitList.length + r.sliverList.length > 0 ? <>
        <h3>{t('优先观察这些位置')}</h3>
        <ul className="meet-audit-candidates">
          {r.worst.map((item, i) => <li key={`near-${i}`}>{t('相邻交点候选')} · {item.ofW} W · {item.facets}</li>)}
          {r.splitList.map((item, i) => <li key={`split-${i}`}>{t('短棱候选')} · {item.ofW} W · {item.ridge}</li>)}
          {r.sliverList.map((item, i) => <li key={`small-${i}`}>{t('小刻面候选')} · {item.facet} · {t('同类中位面积的 {0}%', [Math.round(item.ofMedian * 100)])}</li>)}
        </ul>
        <p>{t('列表仅显示部分候选。返回对应图层检查真实棱与设计意图，再决定是否修改。')}</p>
      </> : <p role="status">{t('本次未发现距离或面积候选，仍需目视核对腰线、底胚壁和整体造型。')}</p>}
    </>}
  </Modal>;
}
