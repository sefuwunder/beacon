# Beacon

Business-entity search — a mobile-first, single-purpose tool for finding
companies by industry and territory. Natural-language search powered by
[Parallel's FindAll API](https://docs.parallel.ai/findall-api/findall-quickstart)
(`entity_type: "companies"`). Companies only: no people, no personal data.

Bundles with the home stack:

| app | role |
|---|---|
| **Milton** (port 3009) | `beacon prospect <industry> in <location>` starts a search here instead of Meridian; `BEACON_URL` env (default `http://localhost:3012`) |
| **exec-crm** (port 3001) | "Send to exec-crm" creates a company + contact per result in the chosen workspace (`EXEC_CRM_URL` env) |
| **R.A.O.** (port 3010) | link out to Beacon for prospecting from the field |

## Run

```bash
cd beacon
bun src/server.ts        # http://localhost:3012 (BEACON_PORT to change)
```

`bun test` — 8 tests, all network-stubbed.

## Keys

Enter the Parallel key on the in-app Keys screen (top-right key icon) —
never in chat. Or set `PARALLEL_API_KEY` in the environment (env wins).

## API

- `POST /api/search` `{ industry, location }` → `201 { job_id, status }`
  (400 when fields are missing or no Parallel key is configured)
- `GET /api/search` → `{ jobs: [...] }` recent searches
- `GET /api/search/:id` → `{ id, industry, location, status, progress, error, companies[], warnings[] }`
  — poll until `status` is `done` or `failed`
- `GET /api/search/:id/export?format=csv|json` — download results
- `GET /api/keys` / `POST /api/keys` — masked key status / save
- `GET /api/workspaces` — exec-crm workspaces (502 when exec-crm is down)
- `POST /api/search/:id/send-to-crm` `{ workspace_id, selected?: string[] }`
  → `{ created, skipped, workspace }`; re-sending is a safe no-op
  (same-name companies reused, same-name contacts skipped)

The `/api/search` shape is deliberately Meridian-`/api/prospect`-compatible,
so Milton's prospect flow points here with no translation layer.

## Design

Bun + zero dependencies + SQLite. `data/` is gitignored and created on boot.
