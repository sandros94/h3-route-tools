import { describe, it, expect, beforeEach } from "vitest";
import { H3 } from "h3";
import { z } from "zod";

import { defineOpenAPI } from "../src/define-openapi.ts";
import { defineRoute } from "../src/route-handler.ts";
import { defineSchema } from "../src/define-schema.ts";
import type { OpenAPIDocument } from "../src/openapi.ts";

const info = { title: "Test API", version: "1.0.0" };

describe("defineOpenAPI — e2e", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  async function fetchDoc(path = "/openapi.json"): Promise<OpenAPIDocument> {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    return res.json();
  }

  it("serves a 3.1 document with info at the default path", async () => {
    app.register(defineOpenAPI({ info }));
    const doc = await fetchDoc();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual(info);
    expect(doc.paths).toEqual({});
  });

  it("serves at a custom path", async () => {
    app.register(defineOpenAPI({ info, path: "/docs.json" }));
    const doc = await fetchDoc("/docs.json");
    expect(doc.info.title).toBe("Test API");
  });

  it("includes routes bound after the plugin is registered", async () => {
    app.register(defineOpenAPI({ info }));
    app.register(
      defineRoute({
        route: "/users/:id",
        params: z.object({ id: z.string() }),
        get: { handler: () => ({}) },
      })
    );

    const doc = await fetchDoc();
    expect(doc.paths["/users/{id}"]?.get).toBeDefined();
    expect(doc.paths["/users/{id}"]?.parameters).toContainEqual(
      expect.objectContaining({ name: "id", in: "path", required: true })
    );
  });

  it("reflects route bindings lazily (doc built per request)", async () => {
    app.register(defineOpenAPI({ info }));
    expect((await fetchDoc()).paths).toEqual({});

    app.register(defineRoute({ route: "/late", get: { handler: () => "ok" } }));
    expect((await fetchDoc()).paths["/late"]).toBeDefined();
  });

  it("hoists $id schemas into components", async () => {
    const User = defineSchema("User", z.object({ id: z.string(), name: z.string() }));
    app.register(defineOpenAPI({ info }));
    app.register(
      defineRoute({
        route: "/users",
        post: { validate: { body: User }, handler: () => ({}) },
      })
    );

    const doc = await fetchDoc();
    expect(doc.components?.schemas?.["User"]).toBeDefined();
    expect(doc.paths["/users"]?.post?.requestBody?.content["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/User",
    });
  });

  it("still serves alongside the validated routes it documents", async () => {
    app.register(defineOpenAPI({ info }));
    app.register(
      defineRoute({
        route: "/echo",
        post: {
          validate: { body: z.object({ name: z.string() }) },
          handler: async (event) => await event.req.json(),
        },
      })
    );

    const ok = await app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(await ok.json()).toEqual({ name: "Alice" });

    const bad = await app.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(bad.status).toBe(400);

    const doc = await fetchDoc();
    expect(doc.paths["/echo"]?.post?.responses?.["400"]).toBeDefined();
  });

  it("does not register routes for docs when no plugin is mounted", async () => {
    app.register(defineRoute({ route: "/no-docs", get: { handler: () => "ok" } }));
    expect((await app.request("/no-docs")).status).toBe(200);
  });

  it("throws when info is incomplete", () => {
    expect(() => defineOpenAPI({ info: { title: "", version: "" } })).toThrow(TypeError);
  });

  it("serves independent documents for separate app instances", async () => {
    const a = new H3();
    a.register(defineOpenAPI({ info: { title: "Service A", version: "1.0.0" } }));
    a.register(defineRoute({ route: "/a-resource", get: { handler: () => "a" } }));

    const b = new H3();
    b.register(defineOpenAPI({ info: { title: "Service B", version: "2.0.0" } }));
    b.register(defineRoute({ route: "/b-resource", post: { handler: () => "b" } }));

    const docA: OpenAPIDocument = await (await a.request("/openapi.json")).json();
    const docB: OpenAPIDocument = await (await b.request("/openapi.json")).json();

    expect(docA.info.title).toBe("Service A");
    expect(docB.info.title).toBe("Service B");
    expect(Object.keys(docA.paths)).toEqual(["/a-resource"]);
    expect(Object.keys(docB.paths)).toEqual(["/b-resource"]);
    expect(docA.paths["/b-resource"]).toBeUndefined();
    expect(docB.paths["/a-resource"]).toBeUndefined();
  });
});
