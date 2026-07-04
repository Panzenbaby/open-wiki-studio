import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/brand.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root element missing");
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);