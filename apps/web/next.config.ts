import path from "node:path";
import type { NextConfig } from "next";

// T-0 (LST-281) scaffold config. Keep empty on purpose: semantic theme
// tokens land in T-1, the shell/nav in T-2, route handlers in T-3/T-19.
const nextConfig: NextConfig = {
  // The app workspace root is the repo root (npm workspaces). Pinned
  // explicitly so Next never mis-detects a neighbouring checkout's lockfile.
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
