import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(<App />);

// Hide splash screen after app has mounted and a short delay
function hideSplash() {
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  splash.classList.add("splash-out");
  splash.addEventListener(
    "transitionend",
    () => {
      splash.remove();
    },
    { once: true }
  );
}

// Give React a moment to paint, then fade out splash
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    setTimeout(hideSplash, 500);
  });
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
