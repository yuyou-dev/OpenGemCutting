import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { App } from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);

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
