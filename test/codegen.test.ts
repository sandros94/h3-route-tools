import { describe, it, expect } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { generateRoutesDts, writeRoutesDts } from "../src/codegen.ts";
import { app } from "./fixtures/codegen-app.ts";

const opts = {
  file: "test/fixtures/codegen-routes.ts",
  typeName: "AppRoutes",
  tsconfig: "tsconfig.json",
};

// Prove the fixture is a real, working app before trusting the generated types — otherwise the
// snapshot could bless a fake. Every assertion exercises a feature the snapshot then captures.
describe("codegen fixture app — real & runnable", () => {
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

  it("GET /health", async () => {
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
  });
});

describe("generateRoutesDts — flattened, self-contained contract", () => {
  // One compiler pass, shared across assertions.
  const dts = generateRoutesDts(opts);

  it("matches the snapshot (regression guard for the whole flattened type)", () => {
    expect(dts).toMatchSnapshot();
  });

  it("is self-contained and faithful to schema input/output + status maps", () => {
    expect(dts).not.toContain("import(");
    expect(dts).not.toContain("ZodObject");
    expect(dts).toContain("when: Date"); // built-in preserved
    expect(dts).toContain("tags: string[]"); // GET response (output)
    expect(dts).toContain("headers: { authorization: string;"); // validated headers
    // POST body is the schema INPUT (tags pre-transform: string, not string[])
    expect(dts).toMatch(/body:\s*\{\s*title:\s*string;\s*tags:\s*string;\s*\}/);
    // multi-response → a union
    expect(dts).toContain('{ id: number; name: string; } | { error: "not_found"; }');
  });
});

describe("writeRoutesDts", () => {
  it("writes the .d.ts under a custom export name and returns it", async () => {
    const out = `${tmpdir()}/h3tr-api.d.ts`;
    try {
      const dts = await writeRoutesDts({ ...opts, exportAs: "MyApi", outFile: out });
      expect(dts.startsWith("export type MyApi = {")).toBe(true);
      expect(await readFile(out, "utf8")).toBe(dts);
    } finally {
      await rm(out, { force: true });
    }
  });
});
