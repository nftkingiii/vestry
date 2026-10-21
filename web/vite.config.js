import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

let revision = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "";
if (!revision) {
  try {
    revision = execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    revision = "local";
  }
}
revision = revision.slice(0, 7);

/// Static hosts have no server route, so the build writes health.json with the revision
/// it was built from; a deploy can then be checked against the intended commit.
const healthFile = {
  name: "health-file",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "health.json", source: JSON.stringify({ ok: true, revision, builtAt: new Date().toISOString() }) });
  },
};

export default defineConfig({
  plugins: [react(), healthFile],
  define: { __REVISION__: JSON.stringify(revision) },
});
