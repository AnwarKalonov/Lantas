import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LantasProvider } from "./lib/store";
import "./styles.css";
import "./styles-el.css";
import "./styles-skills.css";
import "./styles-ide.css";
import "./styles-workbench.css";
import "./styles-studio.css";
import "./styles-activity.css";
import "./styles-chat.css";
import "./styles-code.css";
import "./styles-permissions.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LantasProvider>
      <App />
    </LantasProvider>
  </StrictMode>,
);
