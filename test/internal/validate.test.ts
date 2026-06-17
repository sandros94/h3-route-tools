import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { HTTPError } from "h3";
import type { ServerRequest } from "srvx";

import { validateBody, validateData, validateResponse } from "../../src/internal/validate.ts";

function makeRequest(init: {
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
}): ServerRequest {
  const headers = new Headers(init.headers);
  if (init.contentType) headers.set("content-type", init.contentType);
  return new Request("http://test/", { method: "POST", headers, body: init.body });
}

describe("validateData", () => {
  it("validates with a standard-schema schema", async () => {
    await expect(validateData({ id: "abc" }, z.object({ id: z.string() }))).resolves.toEqual({
      id: "abc",
    });
  });

  it("throws a 400 HTTPError on schema failure", async () => {
    await expect(validateData({ id: 42 }, z.object({ id: z.string() }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("supports predicate-style validate functions", async () => {
    await expect(validateData({ ok: 1 }, () => true)).resolves.toEqual({ ok: 1 });
    await expect(validateData({ ok: 1 }, () => false)).rejects.toMatchObject({ status: 400 });
    await expect(validateData("x", (d) => `${String(d)}!`)).resolves.toBe("x!");
  });

  it("invokes onError to customize the thrown details", async () => {
    await expect(
      validateData({ id: 42 }, z.object({ id: z.string() }), {
        onError: () => ({ status: 422, message: "Custom" }),
      })
    ).rejects.toMatchObject({ status: 422, message: "Custom" });
  });

  it("supports async schemas", async () => {
    const schema = z.object({ id: z.string() }).refine(async () => true);
    await expect(validateData({ id: "abc" }, schema)).resolves.toEqual({ id: "abc" });
  });
});

describe("validateBody — bare schema (lazy, JSON-only)", () => {
  const schema = z.object({ name: z.string() });

  it("validates .json() lazily and returns the value", async () => {
    const req = validateBody(
      makeRequest({ body: JSON.stringify({ name: "Alice" }), contentType: "application/json" }),
      { body: schema }
    );
    await expect(req.json()).resolves.toEqual({ name: "Alice" });
  });

  it("throws 400 when the payload fails validation", async () => {
    const req = validateBody(
      makeRequest({ body: JSON.stringify({ name: 42 }), contentType: "application/json" }),
      { body: schema }
    );
    await expect(req.json()).rejects.toMatchObject({ status: 400 });
  });

  it("passes other parser methods through unvalidated", async () => {
    const req = validateBody(makeRequest({ body: "raw", contentType: "text/plain" }), {
      body: schema,
    });
    await expect(req.text()).resolves.toBe("raw");
  });
});

describe("validateBody — media-type map (strict)", () => {
  const json = z.object({ name: z.string() });

  it("matches application/json and validates", async () => {
    const req = validateBody(
      makeRequest({ body: JSON.stringify({ name: "Bob" }), contentType: "application/json" }),
      { body: { "application/json": json } }
    );
    await expect(req.json()).resolves.toEqual({ name: "Bob" });
  });

  it("throws 415 when Content-Type matches no declared key", () => {
    expect(() =>
      validateBody(makeRequest({ contentType: "text/csv" }), {
        body: { "application/json": json },
      })
    ).toThrow(/Unsupported Media Type|415/i);
  });

  it("matches against a parameterized content-type", async () => {
    const req = validateBody(
      makeRequest({
        body: JSON.stringify({ name: "Dan" }),
        contentType: "application/json; charset=utf-8",
      }),
      { body: { "application/json": json } }
    );
    await expect(req.json()).resolves.toEqual({ name: "Dan" });
  });
});

describe("validateBody — streaming entries (never buffered)", () => {
  it("returns the raw request for an undocumented stream entry so the handler reads event.req.body", () => {
    const req = makeRequest({ contentType: "application/octet-stream" });
    expect(validateBody(req, { stream: { "application/octet-stream": true } })).toBe(req);
  });

  it("returns the raw request for a documented stream entry", () => {
    // NDJSON: streamed raw, but each line is a describable JSON record.
    const req = makeRequest({ contentType: "application/x-ndjson" });
    expect(
      validateBody(req, {
        stream: {
          "application/x-ndjson": { type: "object", properties: { id: { type: "string" } } },
        },
      })
    ).toBe(req);
  });

  it("still 415s when a streaming content-type isn't declared", () => {
    expect(() =>
      validateBody(makeRequest({ contentType: "text/csv" }), {
        stream: { "application/octet-stream": true },
      })
    ).toThrow(/415|Unsupported/i);
  });

  it("validates a sibling body content-type while streaming another", async () => {
    const json = z.object({ name: z.string() });
    const streamed = makeRequest({ contentType: "application/octet-stream" });
    expect(
      validateBody(streamed, {
        body: { "application/json": json },
        stream: { "application/octet-stream": true },
      })
    ).toBe(streamed);

    const validated = validateBody(
      makeRequest({ body: JSON.stringify({ name: "Zoe" }), contentType: "application/json" }),
      { body: { "application/json": json }, stream: { "application/octet-stream": true } }
    );
    await expect(validated.json()).resolves.toEqual({ name: "Zoe" });
  });
});

describe("validateBody — valibot (no JSON Schema)", () => {
  it("validates correctly when the schema lacks ~standard.jsonSchema", async () => {
    const req = validateBody(
      makeRequest({ body: JSON.stringify({ name: "Eve" }), contentType: "application/json" }),
      { body: v.object({ name: v.string() }) }
    );
    await expect(req.json()).resolves.toEqual({ name: "Eve" });
  });
});

describe("validateResponse", () => {
  it("returns the validated value on success", async () => {
    await expect(validateResponse({ id: "abc" }, z.object({ id: z.string() }))).resolves.toEqual({
      id: "abc",
    });
  });

  it("throws a 500 HTTPError on response failure", async () => {
    await expect(validateResponse({ id: 42 }, z.object({ id: z.string() }))).rejects.toMatchObject({
      status: 500,
    });
  });

  it("passes a custom error builder through, still enforcing 500", async () => {
    await expect(
      validateResponse({ id: 42 }, z.object({ id: z.string() }), {
        // The builder is pre-resolved (source + event already bound at the route layer); 500 is forced.
        onError: () => ({ status: 503, message: "down" }),
      })
    ).rejects.toMatchObject({ status: 500, message: "down" });
  });

  it("throws HTTPError instances", async () => {
    await expect(validateResponse({ id: 42 }, z.object({ id: z.string() }))).rejects.toBeInstanceOf(
      HTTPError
    );
  });
});
