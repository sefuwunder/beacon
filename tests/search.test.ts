// beacon — tests: FindAll parsing/objective + the HTTP API (stubbed network).
// Run with `bun test`. Nothing here touches the real web or real keys.

import { test, expect, beforeEach } from "bun:test";
import { buildObjective, parseEntities, runSearchJob } from "../src/search";
import { createSearch, getSearch, __resetDataDirForTests } from "../src/db";
import { setKey } from "../src/keys";

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const FINDALL_JSON = {
  entities: [
    { name: "Queen City Dental", url: "https://queencity.example.com", description: "Family practice." },
    { name: "No Site Co", url: "notaurl", description: "x" },
    { name: "", url: "https://noname.example.com", description: "dropped" },
    { name: "Queen City Dental", url: "https://queencity.example.com", description: "dup" },
  ],
};

beforeEach(() => { __resetDataDirForTests(); });

test("buildObjective anchors industry + location", () => {
  const o = buildObjective("dental clinics", "Madisonville");
  expect(o).toContain("dental clinics");
  expect(o).toContain("Madisonville");
});

test("parseEntities keeps shape, drops nameless/dups, clears bad urls, caps", () => {
  const cs = parseEntities(FINDALL_JSON, "dental", "Madisonville");
  expect(cs.map((c) => c.name)).toEqual(["Queen City Dental", "No Site Co"]);
  expect(cs[0].url).toBe("https://queencity.example.com");
  expect(cs[0].source).toBe("findall");
  expect(cs[0].industry).toBe("dental");
  expect(cs[1].url).toBe("");
  const many = { entities: Array.from({ length: 60 }, (_, i) => ({ name: `Co ${i}`, url: `https://c${i}.x` })) };
  expect(parseEntities(many, "d", "l").length).toBe(25);
  expect(parseEntities({}, "d", "l")).toEqual([]);
});

test("parseEntities passes through rich FindAll attributes, any key spelling", () => {
  const cs = parseEntities({
    entities: [{
      name: "GFFYN Network Solutions",
      url: "https://gffyn-network-solutions.com",
      description: "IT services firm.",
      "Primary Sector": "Business Services",
      "Primary Subsector": "IT Services",
      "Stage": "Unfunded",
      "Founded Year": "2014",
      "Location Country": "United States",
      "Location State": "Ohio",
      "Location City": "Cincinnati",
      "Acquisitions As Acquirer": "2",
    }, {
      name: "Snake Case Co",
      attributes: { primary_sector: "Retail", founded_year: "2001", location_city: "Dayton" },
    }],
  }, "d", "l");
  expect(cs[0]).toMatchObject({
    sector: "Business Services", subsector: "IT Services", stage: "Unfunded",
    founded_year: "2014", country: "United States", state: "Ohio", city: "Cincinnati",
    acquisitions: "2",
  });
  expect(cs[1].sector).toBe("Retail");
  expect(cs[1].founded_year).toBe("2001");
  expect(cs[1].city).toBe("Dayton");
  expect(cs[1].stage).toBe(""); // missing attributes come back as ""
});

test("runSearchJob without a key lands failed with a clear error", async () => {
  delete process.env.PARALLEL_API_KEY;
  const id = "t-" + Math.random().toString(36).slice(2);
  createSearch(id, "dental", "Madisonville");
  let fetched = false;
  runSearchJob(id, "dental", "Madisonville", (() => { fetched = true; throw new Error("nope"); }) as any);
  await new Promise((r) => setTimeout(r, 50));
  const row = getSearch(id)!;
  expect(row.status).toBe("failed");
  expect(row.error).toMatch(/api key/i);
  expect(fetched).toBe(false);
});

test("runSearchJob posts entity-search with x-api-key and persists companies", async () => {
  process.env.PARALLEL_API_KEY = "pk-test";
  delete process.env.PARALLEL_API_KEY; // env must not leak; use the kv store instead
  const id = "t-" + Math.random().toString(36).slice(2);
  createSearch(id, "dental", "Madisonville");
  setKey("PARALLEL_API_KEY", "kv-key");
  let sentHeaders: any = {}, sentBody: any = {};
  const stub = (url: string, init?: RequestInit) => {
    sentHeaders = (init as any)?.headers || {};
    sentBody = JSON.parse(String((init as any)?.body || "{}"));
    return Promise.resolve(jsonResponse(FINDALL_JSON));
  };
  runSearchJob(id, "dental", "Madisonville", stub as any);
  const deadline = Date.now() + 3000;
  for (;;) {
    const row = getSearch(id)!;
    if (row.status === "done") break;
    if (Date.now() > deadline) throw new Error("job never finished");
    await new Promise((r) => setTimeout(r, 25));
  }
  expect(sentHeaders["x-api-key"]).toBe("kv-key");
  expect(sentBody.entity_type).toBe("companies");
  expect(sentBody.match_limit).toBe(25);
  expect(sentBody.objective).toContain("dental");
  const row = getSearch(id)!;
  const companies = JSON.parse(row.companies_json);
  expect(companies.length).toBe(2);
  expect(companies[0].name).toBe("Queen City Dental");
  setKey("PARALLEL_API_KEY", "");
});
