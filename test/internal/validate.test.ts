import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { HTTPError } from "h3";
import type { ServerRequest } from "srvx";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  validateData,
  syncValidate,
  validateBody,
  validateHeaders,
  validateQuery,
  validateParams,
  validateResponse,
} from "../../src/internal/validate.ts";

function makeRequest(init: {
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
}): ServerRequest {
  const headers = new Headers(init.headers);
  if (init.contentType) headers.set("content-type", init.contentType);
  return new Request("http://test/", {
    method: "POST",
    headers,
    body: init.body,
  });
}

describe("validateData", () => {
  it("validates with a standard-schema schema", async () => {
    const schema = z.object({ id: z.string() });
    await expect(validateData({ id: "abc" }, schema)).resolves.toEqual({ id: "abc" });
  });

  it("throws a 400 HTTPError on schema failure", async () => {
    const schema = z.object({ id: z.string() });
    await expect(validateData({ id: 42 }, schema)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("supports predicate-style validate function (true)", async () => {
    await expect(validateData({ ok: 1 }, () => true)).resolves.toEqual({ ok: 1 });
  });

  it("supports predicate-style validate function (false → 400)", async () => {
    await expect(validateData({ ok: 1 }, () => false)).rejects.toMatchObject({ status: 400 });
  });

  it("supports predicate-style validate returning transformed value", async () => {
    await expect(validateData("x", (d) => `${String(d)}!`)).resolves.toBe("x!");
  });

  it("invokes onError to customize the thrown details", async () => {
    const schema = z.object({ id: z.string() });
    await expect(
      validateData({ id: 42 }, schema, {
        onError: () => ({ status: 422, message: "Custom" }),
      }),
    ).rejects.toMatchObject({ status: 422, message: "Custom" });
  });
});

describe("syncValidate", () => {
  it("returns the parsed value on success", () => {
    const schema = z.object({ id: z.string() });
    expect(syncValidate("params", { id: "abc" }, schema)).toEqual({ id: "abc" });
  });

  it("throws on async validation", () => {
    const asyncSchema: StandardSchemaV1<unknown, Record<string, unknown>> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async () => ({ value: {} }),
      },
    };
    expect(() => syncValidate("query", {}, asyncSchema)).toThrow(TypeError);
  });

  it("passes _source through onError", () => {
    const schema = z.object({ id: z.string() });
    expect(() =>
      syncValidate("query", { id: 42 }, schema, {
        onError: (r) => ({
          status: 400,
          message: `failed: ${r._source}`,
        }),
      }),
    ).toThrow(/failed: query/);
  });
});

describe("validateParams", () => {
  it("returns the validated params shape", () => {
    const schema = z.object({ id: z.string() });
    expect(validateParams({ id: "abc" }, schema)).toEqual({ id: "abc" });
  });

  it("handles undefined params input", () => {
    const schema = z.object({}).strict();
    expect(validateParams(undefined, schema)).toEqual({});
  });
});

describe("validateHeaders", () => {
  it("mutates req.headers in place with validated values", () => {
    const req = makeRequest({ headers: { "x-id": "abc" } });
    const schema = z.object({ "x-id": z.string() }).loose();
    validateHeaders(req, schema);
    expect(req.headers.get("x-id")).toBe("abc");
  });

  it("throws 400 on invalid headers", () => {
    const req = makeRequest({ headers: { "x-id": "abc" } });
    const schema = z.object({ "x-id": z.string().regex(/^\d+$/) }).loose();
    expect(() => validateHeaders(req, schema)).toThrow(HTTPError);
  });
});

describe("validateQuery", () => {
  it("mutates url.searchParams in place with validated values", () => {
    const url = new URL("http://x/?id=abc");
    const schema = z.object({ id: z.string() }).loose();
    const out = validateQuery(url, schema);
    expect(out.searchParams.get("id")).toBe("abc");
  });

  it("throws 400 on invalid query", () => {
    const url = new URL("http://x/?id=abc");
    const schema = z.object({ id: z.string().regex(/^\d+$/) }).loose();
    expect(() => validateQuery(url, schema)).toThrow(HTTPError);
  });
});

describe("validateBody — bare schema (JSON-only)", () => {
  const schema = z.object({ name: z.string() });

  it("validates .json() against the schema and returns the value", async () => {
    const req = makeRequest({
      body: JSON.stringify({ name: "Alice" }),
      contentType: "application/json",
    });
    const wrapped = validateBody(req, schema);
    await expect(wrapped.json()).resolves.toEqual({ name: "Alice" });
  });

  it("throws 400 on .json() when payload fails validation", async () => {
    const req = makeRequest({
      body: JSON.stringify({ name: 42 }),
      contentType: "application/json",
    });
    const wrapped = validateBody(req, schema);
    await expect(wrapped.json()).rejects.toMatchObject({ status: 400 });
  });

  it("passes other parser methods through unvalidated", async () => {
    const req = makeRequest({
      body: "raw text",
      contentType: "text/plain",
    });
    const wrapped = validateBody(req, schema);
    await expect(wrapped.text()).resolves.toBe("raw text");
  });

  it("forwards non-parser properties (e.g. headers)", () => {
    const req = makeRequest({ contentType: "application/json", headers: { "x-h": "v" } });
    const wrapped = validateBody(req, schema);
    expect(wrapped.headers.get("x-h")).toBe("v");
  });
});

describe("validateBody — media-type map (strict)", () => {
  const json = z.object({ name: z.string() });
  const formText = z.object({ name: z.string() });

  it("matches application/json and validates .json()", async () => {
    const req = makeRequest({
      body: JSON.stringify({ name: "Bob" }),
      contentType: "application/json",
    });
    const wrapped = validateBody(req, { "application/json": json });
    await expect(wrapped.json()).resolves.toEqual({ name: "Bob" });
  });

  it("matches application/x-www-form-urlencoded and validates .formData()", async () => {
    const form = new URLSearchParams({ name: "Carol" });
    const req = makeRequest({
      body: form.toString(),
      contentType: "application/x-www-form-urlencoded",
    });
    const wrapped = validateBody(req, { "application/x-www-form-urlencoded": formText });
    // @ts-expect-error: the wrapped parser returns the validated plain object at runtime,
    // but `ServerRequest.formData()` is statically typed as `Promise<FormData>`.
    const data: { name: string } = await wrapped.formData();
    expect(data.name).toBe("Carol");
  });

  it("throws 415 when Content-Type matches no declared key", () => {
    const req = makeRequest({ contentType: "text/csv" });
    expect(() =>
      validateBody(req, {
        "application/json": json,
        "multipart/form-data": json,
      }),
    ).toThrow(/Unsupported Media Type|415/i);
  });

  it("throws 415 when Content-Type is missing", () => {
    const req = makeRequest({});
    expect(() => validateBody(req, { "application/json": json })).toThrow(HTTPError);
  });

  it("matches declared key against parameterized content-type", async () => {
    const req = makeRequest({
      body: JSON.stringify({ name: "Dan" }),
      contentType: "application/json; charset=utf-8",
    });
    const wrapped = validateBody(req, { "application/json": json });
    await expect(wrapped.json()).resolves.toEqual({ name: "Dan" });
  });
});

describe("validateResponse", () => {
  it("returns the validated value on success", async () => {
    const schema = z.object({ id: z.string() });
    await expect(validateResponse({ id: "abc" }, schema)).resolves.toEqual({ id: "abc" });
  });

  it("throws a 500 HTTPError on response failure", async () => {
    const schema = z.object({ id: z.string() });
    await expect(validateResponse({ id: 42 }, schema)).rejects.toMatchObject({ status: 500 });
  });

  it("invokes onError with _source 'response'", async () => {
    const schema = z.object({ id: z.string() });
    await expect(
      validateResponse({ id: 42 }, schema, {
        onError: (r) => ({
          status: 500,
          message: `failed: ${r._source}`,
        }),
      }),
    ).rejects.toMatchObject({ status: 500, message: /failed: response/ });
  });
});

describe("validateBody — valibot (no JSON Schema)", () => {
  it("still validates correctly when the schema lacks ~standard.jsonSchema", async () => {
    const schema = v.object({ name: v.string() });
    const req = makeRequest({
      body: JSON.stringify({ name: "Eve" }),
      contentType: "application/json",
    });
    const wrapped = validateBody(req, schema);
    await expect(wrapped.json()).resolves.toEqual({ name: "Eve" });
  });
});
