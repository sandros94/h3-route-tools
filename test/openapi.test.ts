import { describe, it, expect } from "vitest";
import { z } from "zod";

import { defineRouteHandler } from "../src/route-handler.ts";
import { defineSchema } from "../src/define-schema.ts";
import type { RegisteredRoute } from "../src/registry.ts";
import {
  buildOpenAPIDocument,
  schemaToParameters,
  toOpenAPIOperation,
  toOpenAPIPath,
  toOpenAPIPathItem,
} from "../src/openapi.ts";

const info = { title: "Test API", version: "1.0.0" };

describe("toOpenAPIPath", () => {
  it("converts named params", () => {
    expect(toOpenAPIPath("/users/:id")).toBe("/users/{id}");
    expect(toOpenAPIPath("/a/:x/b/:y")).toBe("/a/{x}/b/{y}");
  });

  it("converts named wildcards", () => {
    expect(toOpenAPIPath("/files/**:rest")).toBe("/files/{rest}");
  });

  it("leaves plain paths unchanged", () => {
    expect(toOpenAPIPath("/users")).toBe("/users");
  });
});

describe("schemaToParameters", () => {
  it("decomposes an object schema into query parameters", () => {
    const params = schemaToParameters(z.object({ limit: z.string(), q: z.string().optional() }), {
      in: "query",
    });
    expect(params).toContainEqual(
      expect.objectContaining({ name: "limit", in: "query", required: true }),
    );
    expect(params).toContainEqual(
      expect.objectContaining({ name: "q", in: "query", required: false }),
    );
  });

  it("marks all path parameters required", () => {
    const params = schemaToParameters(z.object({ id: z.string().optional() }), { in: "path" });
    expect(params[0]).toMatchObject({ name: "id", in: "path", required: true });
  });

  it("returns no parameters for a non-object schema", () => {
    expect(schemaToParameters(z.string(), { in: "query" })).toEqual([]);
  });
});

describe("toOpenAPIOperation", () => {
  it("emits a JSON requestBody for a bare body schema", () => {
    const op = toOpenAPIOperation({ validate: { body: z.object({ name: z.string() }) } });
    expect(op.requestBody?.content["application/json"]?.schema).toMatchObject({ type: "object" });
    expect(op.requestBody?.required).toBe(true);
  });

  it("emits one content entry per media type for a body map", () => {
    const op = toOpenAPIOperation({
      validate: {
        body: {
          "application/json": z.object({ a: z.string() }),
          "application/x-www-form-urlencoded": z.object({ b: z.string() }),
        },
      },
    });
    expect(Object.keys(op.requestBody?.content ?? {})).toEqual([
      "application/json",
      "application/x-www-form-urlencoded",
    ]);
  });

  it("emits an empty media-type object for an undocumented request stream entry", () => {
    const op = toOpenAPIOperation({ stream: { body: { "application/octet-stream": true } } });
    expect(op.requestBody?.content["application/octet-stream"]).toEqual({});
  });

  it("emits the supplied JSON Schema for a documented request stream entry", () => {
    // NDJSON upload: the stream is raw (never buffered), but each line is a JSON record we can describe.
    const op = toOpenAPIOperation({
      stream: {
        body: {
          "application/x-ndjson": { type: "object", properties: { id: { type: "string" } } },
        },
      },
    });
    expect(op.requestBody?.content["application/x-ndjson"]?.schema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });

  it("merges validated body and streamed content types in one requestBody", () => {
    const op = toOpenAPIOperation({
      validate: { body: { "application/json": z.object({ name: z.string() }) } },
      stream: { body: { "application/octet-stream": true } },
    });
    expect(Object.keys(op.requestBody?.content ?? {})).toEqual([
      "application/json",
      "application/octet-stream",
    ]);
  });

  it("auto-registers 415 for a request stream slot", () => {
    const op = toOpenAPIOperation({ stream: { body: { "application/octet-stream": true } } });
    expect(op.responses?.["415"]).toBeDefined();
  });

  it("documents a streamed response under its status + media type", () => {
    const op = toOpenAPIOperation({
      stream: {
        response: {
          200: {
            "text/event-stream": { type: "object", properties: { tick: { type: "number" } } },
          },
        },
      },
    });
    expect(op.responses?.["200"]?.content?.["text/event-stream"]?.schema).toEqual({
      type: "object",
      properties: { tick: { type: "number" } },
    });
  });

  it("merges a validated and a streamed content type under the same status", () => {
    const op = toOpenAPIOperation({
      validate: { response: { 200: z.object({ id: z.string() }) } },
      stream: { response: { 200: { "text/event-stream": true } } },
    });
    const content = op.responses?.["200"]?.content ?? {};
    expect(Object.keys(content)).toEqual(["application/json", "text/event-stream"]);
    expect(content["text/event-stream"]).toEqual({});
  });

  it("does not auto-register a 500 for a doc-only streamed response", () => {
    const op = toOpenAPIOperation({
      stream: { response: { 200: { "text/event-stream": true } } },
    });
    expect(op.responses?.["500"]).toBeUndefined();
  });

  it("maps a bare response schema to a 200", () => {
    const op = toOpenAPIOperation({ validate: { response: z.object({ ok: z.boolean() }) } });
    expect(op.responses?.["200"]?.content?.["application/json"]?.schema).toMatchObject({
      type: "object",
    });
  });

  it("maps a status-code response map per code", () => {
    const op = toOpenAPIOperation({
      validate: {
        response: { 200: z.object({ ok: z.boolean() }), 404: z.object({ error: z.string() }) },
      },
    });
    expect(op.responses?.["200"]).toBeDefined();
    expect(op.responses?.["404"]).toBeDefined();
  });

  it("auto-registers 400 when any request validation is present", () => {
    const op = toOpenAPIOperation({ validate: { body: z.object({ name: z.string() }) } });
    expect(op.responses?.["400"]).toBeDefined();
  });

  it("auto-registers 415 only for a media-type body map", () => {
    const bare = toOpenAPIOperation({ validate: { body: z.object({ name: z.string() }) } });
    expect(bare.responses?.["415"]).toBeUndefined();
    const mapped = toOpenAPIOperation({
      validate: { body: { "application/json": z.object({ name: z.string() }) } },
    });
    expect(mapped.responses?.["415"]).toBeDefined();
  });

  it("auto-registers 500 when response validation is present", () => {
    const op = toOpenAPIOperation({ validate: { response: z.object({ ok: z.boolean() }) } });
    expect(op.responses?.["500"]).toBeDefined();
  });

  it("auto-registers 400 from route-level params alone", () => {
    const op = toOpenAPIOperation({}, { hasRouteParams: true });
    expect(op.responses?.["400"]).toBeDefined();
  });

  it("disables all auto-errors when errors is false", () => {
    const op = toOpenAPIOperation(
      {
        validate: { body: z.object({ name: z.string() }), response: z.object({ ok: z.boolean() }) },
      },
      { errors: false },
    );
    expect(op.responses?.["400"]).toBeUndefined();
    expect(op.responses?.["500"]).toBeUndefined();
  });

  it("does not override an explicitly declared status with an auto-error", () => {
    const custom = z.object({ custom: z.string() });
    const op = toOpenAPIOperation({
      validate: { body: z.object({ name: z.string() }), response: { 400: custom } },
    });
    expect(op.responses?.["400"]?.content?.["application/json"]?.schema).toMatchObject({
      type: "object",
      properties: { custom: expect.anything() },
    });
  });

  it("pulls operation metadata from meta.openapi", () => {
    const op = toOpenAPIOperation({
      meta: { openapi: { summary: "List", tags: ["users"], operationId: "listUsers" } },
    });
    expect(op).toMatchObject({ summary: "List", tags: ["users"], operationId: "listUsers" });
  });
});

describe("toOpenAPIPathItem", () => {
  it("emits path-level parameters from route params and one operation per method", () => {
    const handler = defineRouteHandler({
      params: z.object({ id: z.string() }),
      get: { handler: () => ({}) },
      post: { validate: { body: z.object({ name: z.string() }) }, handler: () => ({}) },
    });
    const item = toOpenAPIPathItem(handler);
    expect(item.parameters).toContainEqual(
      expect.objectContaining({ name: "id", in: "path", required: true }),
    );
    expect(item.get).toBeDefined();
    expect(item.post?.requestBody).toBeDefined();
  });

  it("respects the route handler's own errors option", () => {
    const handler = defineRouteHandler(
      { post: { validate: { body: z.object({ name: z.string() }) }, handler: () => ({}) } },
      { errors: false },
    );
    const item = toOpenAPIPathItem(handler);
    expect(item.post?.responses?.["400"]).toBeUndefined();
  });

  it("does not emit operations for auto HEAD/OPTIONS", () => {
    const item = toOpenAPIPathItem(defineRouteHandler({ get: { handler: () => "g" } }));
    expect(item.get).toBeDefined();
    expect(item.head).toBeUndefined();
    expect(item.options).toBeUndefined();
  });

  it("does not emit operations for head: false / options: false", () => {
    const item = toOpenAPIPathItem(
      defineRouteHandler({ get: { handler: () => "g" }, head: false, options: false }),
    );
    expect(item.head).toBeUndefined();
    expect(item.options).toBeUndefined();
  });

  it("emits an explicitly declared options operation", () => {
    const item = toOpenAPIPathItem(
      defineRouteHandler({
        get: { handler: () => "g" },
        options: { meta: { openapi: { summary: "Custom preflight" } }, handler: () => null },
      }),
    );
    expect(item.options).toBeDefined();
    expect(item.options?.summary).toBe("Custom preflight");
  });
});

describe("buildOpenAPIDocument", () => {
  function routes(...entries: RegisteredRoute[]): RegisteredRoute[] {
    return entries;
  }

  it("produces a 3.1 document with info and converted paths", () => {
    const handler = defineRouteHandler({ get: { handler: () => "ok" } });
    const doc = buildOpenAPIDocument({
      info,
      routes: routes({ route: "/users/:id", handler }),
    });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual(info);
    expect(doc.paths["/users/{id}"]?.get).toBeDefined();
  });

  it("omits components when no $id schemas are present", () => {
    const handler = defineRouteHandler({ get: { handler: () => "ok" } });
    const doc = buildOpenAPIDocument({ info, routes: routes({ route: "/x", handler }) });
    expect(doc.components).toBeUndefined();
  });

  it("hoists $id schemas into components and references them", () => {
    const User = defineSchema("User", z.object({ id: z.string(), name: z.string() }));
    const handler = defineRouteHandler({
      post: { validate: { body: User, response: User }, handler: () => ({ id: "1", name: "a" }) },
    });
    const doc = buildOpenAPIDocument({ info, routes: routes({ route: "/users", handler }) });

    expect(doc.components?.schemas?.["User"]).toMatchObject({ $id: "User", type: "object" });
    const op = doc.paths["/users"]?.post;
    expect(op?.requestBody?.content["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/User",
    });
    expect(op?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/User",
    });
  });

  it("hoists the auto-registered error envelope into components", () => {
    const handler = defineRouteHandler({
      post: { validate: { body: z.object({ name: z.string() }) }, handler: () => ({}) },
    });
    const doc = buildOpenAPIDocument({ info, routes: routes({ route: "/users", handler }) });
    expect(doc.components?.schemas?.["ValidationError"]).toBeDefined();
    expect(
      doc.paths["/users"]?.post?.responses?.["400"]?.content?.["application/json"]?.schema,
    ).toEqual({ $ref: "#/components/schemas/ValidationError" });
  });

  it("merges multiple bindings on the same path", () => {
    const getH = defineRouteHandler({ get: { handler: () => "g" } });
    const postH = defineRouteHandler({ post: { handler: () => "p" } });
    const doc = buildOpenAPIDocument({
      info,
      routes: routes({ route: "/x", handler: getH }, { route: "/x", handler: postH }),
    });
    expect(doc.paths["/x"]?.get).toBeDefined();
    expect(doc.paths["/x"]?.post).toBeDefined();
  });
});
