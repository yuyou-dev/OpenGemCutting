import { initializeLocale, getLocale, subscribeLocale, t } from './i18n/locale.js';
import { RenderBoundary } from "./components/RenderBoundary.jsx";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { DesignReviewPage } from "./components/DesignReviewPage.jsx";
import { App } from "./App.jsx";
import "./styles.css";

initializeLocale({ browserLanguages: navigator.languages });
const updatePageLanguage = () => { document.documentElement.lang = getLocale(); document.title = t('切磨工作台') + ' · Facet 96'; };
subscribeLocale(updatePageLanguage);
updatePageLanguage();
const reviewPath = new URLSearchParams(window.location.search).get("review");
createRoot(document.getElementById("root")).render(<RenderBoundary>{reviewPath ? <DesignReviewPage manifestPath={reviewPath} /> : <App />}</RenderBoundary>);

const bootScreen = document.getElementById("boot-screen");
if (bootScreen) {
  bootScreen.setAttribute('aria-label', t('切磨工作台正在加载'));
  document.getElementById('boot-title').textContent = t('切磨工作台');
  document.getElementById('boot-product').textContent = t('SUVA · FACET 96 专业版');
  document.getElementById('boot-status').textContent = t('正在校准 96 齿工作区');
  const minimumDisplay = new Promise((resolve) => window.setTimeout(resolve, 720));
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  const pageReady = document.readyState === "complete"
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));

  Promise.all([minimumDisplay, fontsReady, pageReady]).then(() => {
    bootScreen.classList.add("is-leaving");
    window.setTimeout(() => bootScreen.remove(), 240);
  });
}
