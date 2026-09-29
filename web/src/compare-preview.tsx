import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WellComparePanel } from "./components/well-compare";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <WellComparePanel />
    </StrictMode>,
  );
}
