import { RenderBoundary } from "./components/RenderBoundary.jsx";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { DesignReviewPage } from "./components/DesignReviewPage.jsx";
import { App } from "./App.jsx";
import "./styles.css";

const reviewPath = new URLSearchParams(window.location.search).get("review");
createRoot(document.getElementById("root")).render(<RenderBoundary>{reviewPath ? <DesignReviewPage manifestPath={reviewPath} /> : <App />}</RenderBoundary>);

const bootScreen = document.getElementById("boot-screen");
if (bootScreen) {
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
