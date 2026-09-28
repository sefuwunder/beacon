// beacon — HTTP server. Bun + zero deps. Serves the UI and the JSON API.
// Business-entity search only: POST /api/search { industry, location }.

import { createSearch, getSearch, listSearches, companyCount } from "./db";
import { runSearchJob, type BeaconCompany } from "./search";
import { KEY_DEFS, maskedKey, resolveKey, setKey } from "./keys";
import { listWorkspaces, sendToCrm } from "./crm";

const PORT = Number(process.env.BEACON_PORT || 3012);
const PUB = new URL("../public/", import.meta.url).pathname;

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

async function readBody(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

function fullJob(id: string) {
  const r = getSearch(id);
  if (!r) return null;
  let companies: BeaconCompany[] = [];
  let warnings: string[] = [];
  let progress = { done: 0, total: 2, current: "" };
  try { const c = JSON.parse(r.companies_json); if (Array.isArray(c)) companies = c; } catch { /* keep */ }
  try { const w = JSON.parse(r.warnings_json); if (Array.isArray(w)) warnings = w; } catch { /* keep */ }
  try { const p = JSON.parse(r.progress_json); if (p && typeof p === "object") progress = p; } catch { /* keep */ }
  return {
    id: r.id, industry: r.industry, location: r.location, status: r.status,
    progress, error: r.error, companies, warnings,
    nodes: [], // Milton-compat: beacon has no graph
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

function csv(companies: BeaconCompany[]): string {
  const q = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["name", "description", "url", "industry", "location", "source"]];
  for (const c of companies) rows.push([c.name, c.description, c.url, c.industry, c.location, c.source]);
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // ---- static ----
    if (method === "GET" && (path === "/" || !path.startsWith("/api/"))) {
      const file = path === "/" ? "index.html" : path.slice(1).split("?")[0];
      if (file.includes("..")) return new Response("bad path", { status: 400 });
      const f = Bun.file(PUB + file);
      if (await f.exists()) return new Response(f);
      const idx = Bun.file(PUB + "index.html");
      return new Response(idx);
    }

    // ---- keys ----
    if (path === "/api/keys" && method === "GET") {
      return json({
        keys: KEY_DEFS.map((k) => ({
          ...k,
          configured: Boolean(resolveKey(k.id)),
          masked: maskedKey(k.id),
        })),
      });
    }
    if (path === "/api/keys" && method === "POST") {
      const b = await readBody(req);
      const def = KEY_DEFS.find((k) => k.id === b.id);
      if (!def) return json({ error: "unknown key id" }, 400);
      setKey(def.id, String(b.value || ""));
      return json({ ok: true, configured: Boolean(resolveKey(def.id)), masked: maskedKey(def.id) });
    }

    // ---- searches ----
    if (path === "/api/search" && method === "POST") {
      const b = await readBody(req);
      const industry = String(b.industry || "").trim();
      const location = String(b.location || "").trim();
      if (!industry || !location)
        return json({ error: "industry and location are both required" }, 400);
      if (!resolveKey("PARALLEL_API_KEY"))
        return json({ error: "no Parallel API key — add one on the Keys screen first" }, 400);
      const id = crypto.randomUUID();
      createSearch(id, industry, location);
      runSearchJob(id, industry, location); // background — never awaited
      return json({ job_id: id, status: "running" }, 201);
    }
    if (path === "/api/search" && method === "GET") {
      return json({
        jobs: listSearches().map((r) => ({
          id: r.id, industry: r.industry, location: r.location,
          status: r.status, company_count: companyCount(r), created_at: r.created_at,
        })),
      });
    }
    const jobId = path.match(/^\/api\/search\/([^/]+)$/)?.[1];
    if (jobId && method === "GET") {
      const job = fullJob(decodeURIComponent(jobId));
      if (!job) return json({ error: "unknown search" }, 404);
      return json(job);
    }
    const exportId = path.match(/^\/api\/search\/([^/]+)\/export$/)?.[1];
    if (exportId && method === "GET") {
      const job = fullJob(decodeURIComponent(exportId));
      if (!job) return json({ error: "unknown search" }, 404);
      const fmt = (url.searchParams.get("format") || "csv").toLowerCase();
      if (fmt === "json") {
        return new Response(JSON.stringify(job.companies, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="beacon-${job.id.slice(0, 8)}.json"`,
          },
        });
      }
      return new Response(csv(job.companies), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="beacon-${job.id.slice(0, 8)}.csv"`,
        },
      });
    }

    // ---- exec-crm bundle ----
    if (path === "/api/workspaces" && method === "GET") {
      try {
        return json({ workspaces: await listWorkspaces() });
      } catch (e: any) {
        return json({ error: `can't reach exec-crm: ${String(e?.message || e).slice(0, 160)}` }, 502);
      }
    }
    const sendId = path.match(/^\/api\/search\/([^/]+)\/send-to-crm$/)?.[1];
    if (sendId && method === "POST") {
      const job = fullJob(decodeURIComponent(sendId));
      if (!job) return json({ error: "unknown search" }, 404);
      if (job.status !== "done") return json({ error: `search is ${job.status} — nothing to send yet` }, 409);
      const b = await readBody(req);
      const wsId = Number(b.workspace_id);
      if (!wsId) return json({ error: "workspace_id is required" }, 400);
      const selected: string[] | null = Array.isArray(b.selected) ? b.selected.map(String) : null;
      const companies = selected
        ? job.companies.filter((c) => selected.includes(c.name))
        : job.companies;
      if (!companies.length) return json({ error: "no companies selected" }, 400);
      try {
        const r = await sendToCrm(companies, wsId);
        return json({ ok: true, ...r });
      } catch (e: any) {
        return json({ error: String(e?.message || e).slice(0, 200) }, 502);
      }
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`beacon on http://localhost:${server.port}`);
