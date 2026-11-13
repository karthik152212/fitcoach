import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import "./theme/tokens.css";
import "./theme/base.css";
import "./shell/shell.css";
import "./components/controls.css";
import "./anatomy/anatomy.css";
import "./screens/screens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
