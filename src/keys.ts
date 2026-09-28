// beacon — keys: PARALLEL_API_KEY resolution.
// Entered on the Keys screen (never in chat); env var wins for headless use.

import { kvGet, kvSet } from "./db";

export const KEY_DEFS = [
  {
    id: "PARALLEL_API_KEY",
    name: "Parallel",
    benefit: "powers business-entity search via the FindAll API (natural-language company discovery)",
    signup: "https://platform.parallel.ai",
    signupLabel: "API key at platform.parallel.ai",
  },
];

/** env first, then the Keys-screen store. */
export function resolveKey(id: string): string {
  const env = (process.env[id] || "").trim();
  if (env) return env;
  return (kvGet("key:" + id) || "").trim();
}

export function maskedKey(id: string): string {
  const v = resolveKey(id);
  if (!v) return "";
  if (v.length <= 8) return "••••••••";
  return v.slice(0, 4) + "••••" + v.slice(-4);
}

export function setKey(id: string, value: string): void {
  kvSet("key:" + id, (value || "").trim());
}
