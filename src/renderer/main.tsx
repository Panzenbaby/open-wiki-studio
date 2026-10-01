import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
// Geist + Geist Mono (SIL OFL 1.1), bundled locally — the CSP allows no
// remote fonts. Imported before brand.css, which refers to these families.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/brand.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root element missing");
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);