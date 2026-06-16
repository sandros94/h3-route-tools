import { describe, it, expect } from "vitest";
import { H3 } from "h3";
import { z } from "zod";

import { H3Typed } from "../src/h3-typed.ts";
import { defineRoute } from "../src/route-handler.ts";

// Behaviour-level oracle: assertions target the observable HTTP response (status + body), so an
// internal redesign that preserves behaviour keeps these green — they don't bias toward the wiring.

const body = z.object({ name: z.string() });
const params = z.object({ id: z.coerce.number() });

function jsonPost(url: string, payload: unknown): Request {
  return new Request(`http://test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("validation errors — default response is unchanged (the pinned oracle)", () => {
  const app = new H3Typed().route({
    route: "/posts/:id",
    params,
    get: {
      validate: { response: z.object({ id: z.number() }) },
      handler: () => ({ id: 1 }),
    },
    post: {
      validate: { body, response: z.object({ ok: z.number() }) },
      handler: async (event) => {
        await event.req.json();
        return { wrong: true } as unknown as { ok: number };
      },
    },
  });

  it("a bad param is a 400 carrying the schema issues (consistent with every other source)", async () => {
    const res = await app.request("/posts/abc");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({
      status: 400,
      statusText: "Validation failed",
      message: "Validation failed",
      data: { message: "Validation failed" },
    });
    expect(Array.isArray(json.data.issues)).toBe(true);
    expect(json.data.issues.length).toBeGreaterThan(0);
  });

  it("a bad body is a 400 carrying the schema issues", async () => {
    const res = await app.request(jsonPost("/posts/1", { name: 42 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({
      status: 400,
      statusText: "Validation failed",
      message: "Validation failed",
      data: { message: "Validation failed" },
    });
    expect(Array.isArray(json.data.issues)).toBe(true);
    expect(json.data.issues.length).toBeGreaterThan(0);
  });

  it("a bad response is a 500 carrying the schema issues", async () => {
    const res = await app.request(jsonPost("/posts/1", { name: "ok" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toMatchObject({
      status: 500,
      statusText: "Response validation failed",
      message: "Response validation failed",
      data: { message: "Validation failed" },
    });
    expect(json.data.issues.length).toBeGreaterThan(0);
  });
});

describe("validation errors — the cascade (method → route → app)", () => {
  it("a route-level onValidationError shapes every source", async () => {
    const app = new H3Typed().route({
      route: "/p/:id",
      params,
      onValidationError: ({ source }) => ({ status: 422, message: `bad ${source}` }),
      post: { validate: { body }, handler: async (e) => await e.req.json() },
    });
    const paramFail = await app.request(jsonPost("/p/abc", { name: "ok" }));
    expect(paramFail.status).toBe(422);
    expect((await paramFail.json()).message).toBe("bad params");

    const bodyFail = await app.request(jsonPost("/p/1", { name: 42 }));
    expect(bodyFail.status).toBe(422);
    expect((await bodyFail.json()).message).toBe("bad body");
  });

  it("a method-level onValidationError overrides the route-level one", async () => {
    const app = new H3Typed().route({
      route: "/p/:id",
      params,
      onValidationError: () => ({ status: 422, message: "route" }),
      post: {
        validate: { body },
        onValidationError: () => ({ status: 418, message: "teapot" }),
        handler: async (e) => await e.req.json(),
      },
    });
    const res = await app.request(jsonPost("/p/1", { name: 42 }));
    expect(res.status).toBe(418);
    expect((await res.json()).message).toBe("teapot");
  });

  it("the app-level onValidationError is the default, overridden by a route's own hook", async () => {
    const app = new H3Typed({ onValidationError: () => ({ status: 422, message: "app" }) })
      .route({
        route: "/a/:id",
        params,
        get: { handler: () => ({ ok: true }) },
      })
      .route({
        route: "/b/:id",
        params,
        onValidationError: () => ({ status: 418, message: "route" }),
        get: { handler: () => ({ ok: true }) },
      });

    const fromApp = await app.request("/a/abc");
    expect(fromApp.status).toBe(422);
    expect((await fromApp.json()).message).toBe("app");

    const fromRoute = await app.request("/b/abc");
    expect(fromRoute.status).toBe(418);
    expect((await fromRoute.json()).message).toBe("route");
  });
});

describe("validation errors — the event is available to the hook", () => {
  it("shapes the error from a request header", async () => {
    const app = new H3Typed().route({
      route: "/p/:id",
      params,
      onValidationError: ({ event, issues }) => ({
        status: 400,
        message: "Validation failed",
        data: { trace: event.req.headers.get("x-trace"), issues },
      }),
      get: { handler: () => ({ ok: true }) },
    });
    const res = await app.request(
      new Request("http://test/p/abc", { headers: { "x-trace": "abc-123" } }),
    );
    expect((await res.json()).data.trace).toBe("abc-123");
  });
});

describe("validation errors — returning nothing falls back to the default", () => {
  it("a void return yields the default 400 envelope", async () => {
    const app = new H3Typed().route({
      route: "/p/:id",
      params,
      // Only shape body failures; a param failure returns undefined → default applies.
      onValidationError: ({ source }) => (source === "body" ? { status: 422 } : undefined),
      get: { handler: () => ({ ok: true }) },
    });
    const res = await app.request("/p/abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      status: 400,
      message: "Validation failed",
      data: { message: "Validation failed" },
    });
  });
});

describe("validation errors — a response failure carries source 'response' and stays 500", () => {
  it("keeps the custom message but forces 500", async () => {
    const app = new H3Typed().route({
      route: "/p/:id",
      params,
      get: {
        validate: { response: z.object({ ok: z.number() }) },
        onValidationError: ({ source }) => ({ status: 503, message: `from ${source}` }),
        handler: () => ({ wrong: true }) as unknown as { ok: number },
      },
    });
    const res = await app.request("/p/1");
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe("from response");
  });
});

describe("validation errors — defineRoute carries the route-level onValidationError", () => {
  it("shapes the failure on a plain h3 app", async () => {
    const app = new H3();
    app.register(
      defineRoute({
        route: "/p/:id",
        params,
        onValidationError: ({ source }) => ({ status: 422, message: source }),
        get: { handler: () => ({ ok: true }) },
      }),
    );
    const res = await app.request("/p/abc");
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe("params");
  });
});
