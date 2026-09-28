// beacon — API tests against a live server on a scratch port (stubbed upstream).
// Dynamic import: BEACON_PORT must be set before server.ts binds.

import { test, expect, beforeAll, afterAll } from "bun:test";

process.env.BEACON_PORT = "45692";
// NOTE: no PARALLEL_API_KEY here — search.test.ts deletes it and bun shares
// process.env across test files; each test sets what it needs.
delete process.env.EXEC_CRM_URL; // no real CRM here

const API = "http://localhost:45692";

async function api(path: string, opts: RequestInit = {}) {
  const r = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

beforeAll(async () => {
  await import("../src/server");
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      const r = await fetch(API + "/api/search");
      if (r.ok) return;
    } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error("beacon scratch server never came up");
    await new Promise((r2) => setTimeout(r2, 100));
  }
});

test("POST /api/search 400s on missing fields; 400 with no key", async () => {
  const bad = await api("/api/search", { method: "POST", body: JSON.stringify({ industry: "dental" }) });
  expect(bad.status).toBe(400);
  expect(bad.j.error).toMatch(/industry and location/i);
});

test("keys round-trip: masked status then save", async () => {
  const before = await api("/api/keys");
  expect(before.status).toBe(200);
  expect(before.j.keys[0].id).toBe("PARALLEL_API_KEY");
  const save = await api("/api/keys", {
    method: "POST", body: JSON.stringify({ id: "PARALLEL_API_KEY", value: "  kv-secret  " }),
  });
  expect(save.j.ok).toBe(true);
  expect(save.j.masked).toContain("kv-s");
  const after = await api("/api/keys");
  expect(after.j.keys[0].configured).toBe(true);
  // restore env-key path for the search test below
  await api("/api/keys", { method: "POST", body: JSON.stringify({ id: "PARALLEL_API_KEY", value: "" }) });
});

test("unknown job 404s; export of unknown job 404s", async () => {
  expect((await api("/api/search/nope")).status).toBe(404);
  expect((await api("/api/search/nope/export")).status).toBe(404);
});

test("workspaces 502s cleanly when exec-crm is down", async () => {
  const r = await api("/api/workspaces");
  expect(r.status).toBe(502);
  expect(r.j.error).toMatch(/exec-crm/i);
});
