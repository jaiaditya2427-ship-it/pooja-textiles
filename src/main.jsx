import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(
  "/fashiontryon/poojatextiles/service-worker.js",
  {
    scope: "/fashiontryon/poojatextiles/",
  }
);
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
