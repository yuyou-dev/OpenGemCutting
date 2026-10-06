import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./standalone.css";

createRoot(document.getElementById("root")).render(<App />);

const boot = document.getElementById("boot-screen");
const startedAt = performance.now();
Promise.all([document.fonts?.ready ?? Promise.resolve()]).then(() => {
  const wait = Math.max(0, 720 - (performance.now() - startedAt));
  setTimeout(() => {
    boot?.classList.add("is-leaving");
    setTimeout(() => boot?.remove(), 260);
  }, wait);
});
