import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ScreenOverlay } from "./components/ScreenOverlay";
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
import "./styles-polish.css";
import "./styles-compare.css";
import "./styles-reui.css";
import "./styles-screen.css";

// The transparent pointing layer is its own window; it renders nothing but a
// canvas and never mounts the app, so it cannot capture or send anything.
const overlay =
  (window as unknown as { __lantasOverlay?: boolean }).__lantasOverlay === true ||
  new URLSearchParams(window.location.search).get("overlay") === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {overlay ? (
      <ScreenOverlay />
    ) : (
      <LantasProvider>
        <App />
      </LantasProvider>
    )}
  </StrictMode>,
);
