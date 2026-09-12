import { t } from '../i18n/locale.js';
import { Component } from "react";

export class RenderBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("视图渲染失败", error); }
  render() {
    if (this.props.hidden && this.state.failed) return null;
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return <section className="render-recovery" role="alert"><h2>{t("这个视图暂时无法显示")}</h2><p>{this.props.onExport ? t("已提交的设计仍保留。请先下载 JSON，再重试打开；当前未提交预览无法恢复。") : t("已保存的本机项目不会被清除。重试后可从主页打开；当前未保存内容可能无法恢复。")}</p>{this.props.onExport && <button onClick={this.props.onExport}>{t("导出已提交 JSON")}</button>}{this.props.onHome && <button onClick={this.props.onHome}>{t("返回项目主页")}</button>}<button onClick={()=>{ this.props.onRetry?.(); this.setState({failed:false}); }}>{t("重试显示")}</button></section>;
  }
}
