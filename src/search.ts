// beacon — business-entity search via Parallel's FindAll API.
// One natural-language objective (industry + location) → structured company
// entities. Business data only: companies, never personal data.

import { resolveKey } from "./keys";
import { updateSearch } from "./db";

export const BEACON_UA = "beacon/1.0 (business entity search)";
export const FINDALL_URL =
  process.env.BEACON_FINDALL_URL || "https://api.parallel.ai/v1beta/findall/entity-search";
export const FINDALL_LIMIT = 25;
const FINDALL_TIMEOUT_MS = 60000;

export interface BeaconCompany {
  name: string;
  description: string;
  url: string;
  industry: string;
  location: string;
  source: "findall";
  // Rich FindAll attributes — empty string when the entity didn't report them.
  sector: string;
  subsector: string;
  stage: string;
  founded_year: string;
  country: string;
  state: string;
  city: string;
  acquisitions: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function buildObjective(industry: string, location: string): string {
  return `Companies in the "${industry.trim()}" industry located in or serving ` +
    `${location.trim()} — established businesses with a public web presence.`;
}

/** Defensive parse: non-empty name required; URL optional but must be http(s).
 *  Rich attributes are read from several possible key spellings — FindAll
 *  field naming varies, so we try snake_case, Title Case, and a nested
 *  `attributes` object. Everything missing comes back as "". */
export function parseEntities(j: any, industry: string, location: string, cap = FINDALL_LIMIT): BeaconCompany[] {
  const arr = Array.isArray(j?.entities) ? j.entities : [];
  const out: BeaconCompany[] = [];
  const seen = new Set<string>();
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const name = String(e.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const rawUrl = String(e.url || "").trim();
    out.push({
      name: name.slice(0, 90),
      description: String(e.description || "").trim().slice(0, 300),
      url: /^https?:\/\//i.test(rawUrl) ? rawUrl : "",
      industry: industry.trim(),
      location: location.trim(),
      source: "findall",
      sector: pick(e, "primary_sector", "Primary Sector", "sector", "Sector"),
      subsector: pick(e, "primary_subsector", "Primary Subsector", "subsector", "Subsector"),
      stage: pick(e, "stage", "Stage", "funding_stage", "Funding Stage"),
      founded_year: pick(e, "founded_year", "Founded Year", "founded", "Founded", "founding_year"),
      country: pick(e, "location_country", "Location Country", "country", "Country"),
      state: pick(e, "location_state", "Location State", "state", "State"),
      city: pick(e, "location_city", "Location City", "city", "City"),
      acquisitions: pick(e, "acquisitions_as_acquirer", "Acquisitions As Acquirer", "acquisitions", "Acquisitions"),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** First non-empty string found under any of the given keys (or attributes.<key>). */
function pick(e: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = e?.[k] ?? e?.attributes?.[k];
    if (v != null && String(v).trim()) return String(v).trim().slice(0, 120);
  }
  return "";
}

export async function findallSearch(
  objective: string, key: string, fetchImpl: FetchFn = fetch,
): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FINDALL_TIMEOUT_MS);
  try {
    const r = await fetchImpl(FINDALL_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": BEACON_UA,
        "x-api-key": key,
      },
      body: JSON.stringify({ entity_type: "companies", objective, match_limit: FINDALL_LIMIT }),
    });
    if (r.status === 401) throw new Error("invalid Parallel API key (HTTP 401) — check the Keys screen");
    if (r.status === 402) throw new Error("Parallel quota exhausted (HTTP 402) — see platform.parallel.ai");
    if (r.status === 429) throw new Error("Parallel rate-limited (HTTP 429) — try again shortly");
    if (!r.ok) throw new Error(`Parallel FindAll HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const running = new Set<string>();

/**
 * Run a search job in the background. Never throws: terminal states are
 * persisted on the row (done / failed), so a poller always gets an answer.
 */
export function runSearchJob(
  id: string, industry: string, location: string,
  fetchImpl: FetchFn = fetch,
): void {
  if (running.has(id)) return;
  running.add(id);
  (async () => {
    try {
      const key = resolveKey("PARALLEL_API_KEY");
      if (!key) throw new Error("no Parallel API key — add one on the Keys screen");
      updateSearch(id, {
        progress_json: JSON.stringify({ done: 1, total: 2, current: "searching FindAll" }),
      });
      const j = await findallSearch(buildObjective(industry, location), key, fetchImpl);
      const companies = parseEntities(j, industry, location);
      updateSearch(id, {
        status: "done",
        progress_json: JSON.stringify({ done: 2, total: 2, current: "" }),
        companies_json: JSON.stringify(companies),
      });
    } catch (e: any) {
      updateSearch(id, {
        status: "failed",
        progress_json: JSON.stringify({ done: 2, total: 2, current: "" }),
        error: String(e?.message || e).slice(0, 300),
      });
    } finally {
      running.delete(id);
    }
  })();
}
