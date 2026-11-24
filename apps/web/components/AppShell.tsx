import type { ReactNode } from "react";
import NavRail from "./NavRail";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <NavRail />
      <main className="app-main" id="main">
        {children}
      </main>
    </div>
  );
}
