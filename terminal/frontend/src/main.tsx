import React from "react";
import ReactDOM from "react-dom/client";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./styles.css";
import App from "./App";
import AuthGate from "./components/AuthGate";
import { WorkspaceProvider } from "./lib/workspace";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </AuthGate>
  </React.StrictMode>,
);
