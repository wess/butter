// Static preview server for the info site. Run: bun site/serve.ts
const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4321);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const file = Bun.file(root + rel);
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`site on http://localhost:${port}`);
