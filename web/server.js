// Serves the built app and a health endpoint that reports the built revision,
// so a deploy can be checked against the intended commit.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT || 4173);
const revision = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.REVISION || "local").slice(0, 7);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, revision }));
    return;
  }
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(root, "index.html");
  }
  try {
    const body = await readFile(file);
    const cache = file.includes(`${join("dist", "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": cache });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`vestry web on :${port} (revision ${revision})`));
