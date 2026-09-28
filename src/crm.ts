// beacon — exec-crm client: send search results into a workspace as
// companies + contacts. exec-crm is a trusted self-hosted sibling (no API
// key); workspace scoping rides the ?workspace= query param, same as Milton.

import type { BeaconCompany } from "./search";

export const CRM_BASE =
  (process.env.EXEC_CRM_URL || "http://localhost:3001").replace(/\/+$/, "");

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

async function crm<T>(path: string, init: RequestInit = {}, fetchImpl: FetchFn = fetch): Promise<T> {
  const r = await fetchImpl(CRM_BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = JSON.stringify(await r.json()); } catch { /* keep */ }
    throw new Error(`exec-crm ${r.status}: ${String(detail).slice(0, 160)}`);
  }
  return (await r.json()) as T;
}

export interface CrmWorkspace { id: number; name: string }

export async function listWorkspaces(fetchImpl: FetchFn = fetch): Promise<CrmWorkspace[]> {
  const j = await crm<any>("/api/workspaces", {}, fetchImpl);
  const arr = Array.isArray(j?.workspaces) ? j.workspaces : Array.isArray(j) ? j : [];
  return arr.map((w: any) => ({ id: Number(w.id), name: String(w.name || "Untitled") }));
}

async function existingCompanyId(ws: number, name: string, fetchImpl: FetchFn): Promise<number | null> {
  const j = await crm<any>(`/api/companies?workspace=${ws}`, {}, fetchImpl);
  const arr = Array.isArray(j?.companies) ? j.companies : Array.isArray(j) ? j : [];
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = arr.find((c: any) => String(c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") === norm);
  return hit ? Number(hit.id) : null;
}

async function existingContact(ws: number, name: string, fetchImpl: FetchFn): Promise<boolean> {
  const j = await crm<any>(`/api/contacts?workspace=${ws}`, {}, fetchImpl);
  const arr = Array.isArray(j?.contacts) ? j.contacts : Array.isArray(j) ? j : [];
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return arr.some((c: any) => String(c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") === norm);
}

export interface SendResult { created: number; skipped: number; workspace: string }

/**
 * Create a company + contact per BeaconCompany in the workspace.
 * Existing same-name companies are reused, same-name contacts skipped —
 * a second send of the same search is a no-op.
 */
export async function sendToCrm(
  companies: BeaconCompany[], workspaceId: number, fetchImpl: FetchFn = fetch,
): Promise<SendResult> {
  const wss = await listWorkspaces(fetchImpl);
  const ws = wss.find((w) => w.id === workspaceId);
  if (!ws) throw new Error(`workspace ${workspaceId} not found in exec-crm`);
  let created = 0, skipped = 0;
  for (const c of companies) {
    if (await existingContact(workspaceId, c.name, fetchImpl)) { skipped++; continue; }
    let companyId = await existingCompanyId(workspaceId, c.name, fetchImpl);
    if (companyId == null) {
      const j = await crm<any>(`/api/companies?workspace=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify({
          name: c.name,
          industry: c.industry,
          website: domainOf(c.url),
        }),
      }, fetchImpl);
      companyId = Number(j?.company?.id ?? j?.id);
      if (!companyId) throw new Error(`exec-crm did not return a company id for ${c.name}`);
    }
    await crm(`/api/contacts?workspace=${workspaceId}`, {
      method: "POST",
      body: JSON.stringify({ name: c.name, company_id: companyId, title: c.location }),
    }, fetchImpl);
    created++;
  }
  return { created, skipped, workspace: ws.name };
}

function domainOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch { return ""; }
}
