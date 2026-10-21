import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

let revision = process.env.RAILWAY_GIT_COMMIT_SHA || "";
if (!revision) {
  try {
    revision = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    revision = "local";
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __REVISION__: JSON.stringify(revision.slice(0, 7)) },
});
