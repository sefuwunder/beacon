// beacon — db: SQLite stores for search jobs and API keys.
// data/ is gitignored; created on boot.

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

export const DATA_DIR = new URL("../data/", import.meta.url).pathname;

let _db: Database | null = null;

/** Test hook: reset the data dir binding (see AGENTS.md lesson on bun file-order). */
export function __resetDataDirForTests() { _db = null; }

export function db(): Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DATA_DIR + "beacon.db");
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
      id TEXT PRIMARY KEY,
      industry TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      progress_json TEXT NOT NULL DEFAULT '{"done":0,"total":2,"current":"starting"}',
      companies_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);
  return _db;
}

export interface SearchRow {
  id: string; industry: string; location: string; status: string;
  progress_json: string; companies_json: string; warnings_json: string;
  error: string | null; created_at: number; updated_at: number;
}

export function createSearch(id: string, industry: string, location: string): void {
  const now = Date.now();
  db().prepare(
    `INSERT INTO searches (id, industry, location, status, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?)`
  ).run(id, industry, location, now, now);
}

export function updateSearch(id: string, patch: Partial<Pick<SearchRow,
  "status" | "progress_json" | "companies_json" | "warnings_json" | "error">>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  sets.push("updated_at = ?");
  vals.push(Date.now(), id);
  db().prepare(`UPDATE searches SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function getSearch(id: string): SearchRow | null {
  return (db().query("SELECT * FROM searches WHERE id = ?").get(id) as SearchRow) ?? null;
}

export function listSearches(limit = 30): SearchRow[] {
  return db().query("SELECT * FROM searches ORDER BY created_at DESC LIMIT ?").all(limit) as SearchRow[];
}

export function companyCount(row: SearchRow): number {
  try {
    const arr = JSON.parse(row.companies_json);
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
}

export function kvGet(k: string): string {
  const r = db().query("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | null;
  return r?.v ?? "";
}

export function kvSet(k: string, v: string): void {
  db().prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}
