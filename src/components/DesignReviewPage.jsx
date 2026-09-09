import { useEffect, useMemo, useState } from "react";
import { IconArrowLeft, IconDownload, IconExternalLink, IconFileDescription } from "@tabler/icons-react";
import { importFacetingJSON, exportFacetingJSON } from "../domain/faceting.js";
import { createStockSolid } from "../domain/stockGeometry.js";
import { assertDocumentImportBudget } from "../domain/importBudget.js";
import { buildConstructionStages } from "../domain/constructionHistory.js";
import { projectTechnicalPreview } from "../domain/technicalPreview.js";
import { downloadBlob } from "../utils/download.js";
import { safeFileStem } from "../utils/format.js";
import { RepositoryLink } from "./RepositoryLink.jsx";
import "./DesignReviewPage.css";

const views = {top:"顶视",bottom:"底视",side:"侧视",isometric:"轴测"};
function ReviewDrawing({ solid, view }) {
  const p = useMemo(()=>projectTechnicalPreview(solid,view,{width:600,height:500,padding:24}),[solid,view]);
  return <svg viewBox="0 0 600 500" role="img" aria-label={`当前模型${views[view]}图`}><path d={p.edges.map(([a,b])=>`M${p.points[a].x},${p.points[a].y}L${p.points[b].x},${p.points[b].y}`).join(" ")} fill="none" stroke="#343936" strokeWidth=".9" vectorEffect="non-scaling-stroke"/></svg>;
}
function ReferenceDrawing({ reference, view, base }) {
  const crop = reference?.views?.[view];
  if (!reference) return <div className="review-missing">未提供参考图<br/><small>模型视图仍可完整检查。</small></div>;
  const src = new URL(reference.file,base);
  if(src.origin !== window.location.origin) throw new Error("参考图须与试作文件位于同一站点。");
  if(!crop) return <div className="review-reference-original"><img src={src.href} alt="用户提供的完整参考图"/><p>此方向没有独立参考视图，显示原图供参考，不作等尺度对照。</p></div>;
  const scale = Math.min(552/crop.width,452/crop.height);
  return <svg viewBox="0 0 600 500" role="img" aria-label={`原始参考${views[view]}图`}><svg x={(600-crop.width*scale)/2} y={(500-crop.height*scale)/2} width={crop.width*scale} height={crop.height*scale} viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}><image href={src.href} width={reference.width} height={reference.height}/></svg></svg>;
}

export function DesignReviewPage({ manifestPath }) {
  const [data,setData]=useState(null),[error,setError]=useState(""),[view,setView]=useState("top");
  useEffect(()=>{
    const controller=new AbortController();
    (async()=>{
      try {
        const base=new URL(manifestPath,window.location.href);
        if(base.origin!==window.location.origin) throw new Error("试作文件须位于当前工作台站点。");
        const response=await fetch(base,{signal:controller.signal});
        if(!response.ok)throw new Error("未找到试作文件，请核对地址或重新生成审阅页。");
        const manifest=await response.json();
        if(manifest.format!=="facet-design-review-v1")throw new Error("此文件不是受支持的琢型试作资料。");
        assertDocumentImportBudget(manifest.document);
        const doc=importFacetingJSON(JSON.stringify(manifest.document));
        const stages=buildConstructionStages(doc),solid=stages.at(-1)?.afterSolid ?? createStockSolid(doc.stock);
        if(!solid)throw new Error("试作需要至少一个已保存的切割图层。");
        if(!controller.signal.aborted)setData({...manifest,document:doc,stages,solid,base});
      }catch(e){if(!controller.signal.aborted)setError(e.message);}
    })();
    return()=>controller.abort();
  },[manifestPath]);
  const home=import.meta.env.BASE_URL;
  return <main className="design-review-page">
    <header className="review-header"><a className="review-brand" href={home}><img src={`${home}brand/logo-header.webp`} alt=""/><span><strong>切磨工作台</strong><small>SUVA · FACET 96</small></span></a><nav><a href={home}><IconArrowLeft size={16}/>返回工作台</a><RepositoryLink/></nav></header>
    {error?<section className="review-error" role="alert"><h1>无法打开试作</h1><p>{error}</p><a href={home}>返回工作台</a></section>:!data?<p className="review-loading" role="status">正在读取试作与真实几何…</p>:<>
      <section className="review-heading"><div><span className="review-eyebrow">DESIGN STUDY / 琢型试作</span><h1>{data.document.name}</h1><p>{data.intent || "对照参考，检查每一圈面棱与造型比例。"}</p></div><button className="review-download" onClick={()=>downloadBlob(new Blob([exportFacetingJSON(data.document)],{type:"application/json"}),`${safeFileStem(data.document.name)}.json`)}><IconDownload size={18}/>下载可编辑 JSON</button></section>
      <section className="review-summary" aria-label="试作概要"><span><b>{data.solid.faces.filter(f=>data.document.facets.some(g=>g.id===(f.facetId??f.id))).length}</b> 表面片</span><span><b>{data.stages.length}</b> 参数组</span><span><b>{data.stages.filter(s=>s.construction?.status==="valid").length}</b> 有效 Meet 组</span><span className="review-status">试作 · 待设计师判断</span></section>
      <div className="review-viewbar"><div role="tablist" aria-label="对照观察方向">{Object.entries(views).map(([key,label])=><button key={key} role="tab" aria-selected={view===key} onClick={()=>setView(key)}>{label}</button>)}</div><span>{data.reference?.views?.[view]?"保持原图比例 · 轮廓对照":"同一保存实体 · 真实正交投影"}</span></div>
      <section className="review-comparison"><article><header><span>01 / REFERENCE</span><h2>参考 · {views[view]}</h2></header><ReferenceDrawing reference={data.reference} view={view} base={data.base}/></article><article><header><span>02 / MODEL</span><h2>模型 · {views[view]}</h2></header><ReviewDrawing solid={data.solid} view={view}/></article></section>
      <section className="review-notes"><div><h2><IconFileDescription size={18}/>设计说明与观察条件</h2><p>{data.notes || "未提供额外说明；请结合参考判断比例与连接关系。"}</p><p>视图从同一份已保存 JSON 生成。工程检查不等于审美评价；仿真不代表实际切磨或光学收益。</p></div><div><h2>继续设计</h2><ol><li>下载 JSON，在工作台新项目中从“文件”导入。</li><li>选择对应参数组试调，检查相邻阶梯与 Meet 来源。</li><li>保留新版本，与本次试作在同一观察条件下比较。</li></ol><a href={home}><IconExternalLink size={15}/>打开切磨工作台</a></div></section>
    </>}
  </main>;
}
