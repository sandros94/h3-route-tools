import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { generateRoutesDts, writeRoutesDts } from "../src/codegen.ts";
import { app as zodApp } from "./fixtures/codegen-app-zod.ts";
import { app as valibotApp } from "./fixtures/codegen-app-valibot.ts";

const zodRoutes = { file: "test/fixtures/codegen-routes-zod.ts", typeName: "AppRoutes" };
const valibotRoutes = { file: "test/fixtures/codegen-routes-valibot.ts", typeName: "AppRoutes" };

// The two fixtures are the same app authored with different Standard Schema libraries — proving both the
// validation layer and the codegen are schema-library-agnostic. Run the full dispatch suite against each:
// a fixture must be genuinely runnable before its generated types are worth trusting.
describe.each([
  ["zod", zodApp],
  ["valibot", valibotApp],
])("codegen fixture app (%s) — real & runnable", (_lib, app) => {
  it("GET /posts/:id returns the validated response (Date, enum, nested, array)", async () => {
    const res = await app.request("/posts/7");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 7,
      title: "Hello",
      when: "1970-01-01T00:00:00.000Z",
      status: "published",
      author: { name: "Ada" },
      tags: ["a", "b"],
    });
  });

  it("POST /posts/:id runs the body transform (input ≠ output)", async () => {
    const res = await app.request("/posts/2?draft=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", tags: "a,b,c" }),
    });
    expect(await res.json()).toEqual({ id: 2, tagCount: 3 });
  });

  it("GET /users/:id dispatches both status-mapped responses (200 | 404)", async () => {
    const ok = await app.request("/users/5", { headers: { authorization: "Bearer x" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: 5, name: "Ada" });

    const nf = await app.request("/users/0", { headers: { authorization: "Bearer x" } });
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: "not_found" });
  });

  it("GET /users/:id 400s when the validated header is missing", async () => {
    expect((await app.request("/users/5")).status).toBe(400);
  });

  it("DELETE /posts/:id (no request body) returns its validated response", async () => {
    const res = await app.request("/posts/3", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });

  it("GET /health", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });
});

describe("codegen output — generateRoutesDts / writeRoutesDts", () => {
  const out = `${tmpdir()}/h3tr-codegen.d.ts`;
  let zodDts: string;
  let valibotDts: string;
  let written: string;

  beforeAll(async () => {
    // The two flatten passes are the slow part. The TypeScript compiler API is synchronous CPU work, so
    // they serialize within this worker regardless of structure; vitest parallelizes this whole file
    // against the rest of the suite. generateRoutesDts owns the zod contract; writeRoutesDts additionally
    // exercises the file write on the valibot app.
    zodDts = await generateRoutesDts(zodRoutes);
    valibotDts = await writeRoutesDts({ ...valibotRoutes, outFile: out });
    written = await readFile(out, "utf8");
  });
  afterAll(async () => {
    await rm(out, { force: true });
  });

  it("matches the snapshot (regression guard for the whole flattened contract)", () => {
    expect(zodDts).toMatchSnapshot();
  });

  it("is self-contained and faithful to schema input/output + status maps", () => {
    expect(zodDts).not.toContain("import("); // no leaked module references
    expect(zodDts).not.toContain("ZodObject"); // schema types fully resolved
    expect(zodDts).toContain("when: Date"); // built-in preserved
    expect(zodDts).toContain("tags: string[]"); // GET response (output)
    expect(zodDts).toContain("headers: { authorization: string;"); // validated headers
    // POST body is the schema INPUT (tags pre-transform: string, not string[])
    expect(zodDts).toMatch(/body:\s*\{\s*title:\s*string;\s*tags:\s*string;\s*\}/);
    // multi-response → a union
    expect(zodDts).toContain('{ id: number; name: string; } | { error: "not_found"; }');
    // GET carries no body; DELETE declares no schema so it surfaces `body: unknown`. Exactly two bodies
    // in the doc: POST (typed) + DELETE (unknown).
    expect((zodDts.match(/\bbody:/g) ?? []).length).toBe(2);
    expect(zodDts).toContain("body: unknown");
    expect(zodDts).toContain("deleted: boolean");
  });

  it("writeRoutesDts writes the returned source to disk, under the exported name", () => {
    expect(written).toBe(valibotDts);
    expect(valibotDts.startsWith("export type AppRoutes = {")).toBe(true); // exportAs defaults to typeName
  });

  it("flattens zod and valibot to the same contract (reads Standard Schema types, not the library)", () => {
    expect(valibotDts).toBe(zodDts);
  });
});
