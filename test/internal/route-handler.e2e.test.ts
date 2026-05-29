import { describe, it, expect, beforeEach } from "vitest";
import { H3 } from "h3";
import { z } from "zod";

import { defineRouteHandler, bindRouteHandler } from "../../src/internal/route-handler.ts";

describe("defineRouteHandler + bindRouteHandler — e2e", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  it("registers a simple GET with no validation", async () => {
    const handler = defineRouteHandler({
      get: { handler: () => "hello" },
    });
    bindRouteHandler(app, { route: "/hello", handler });

    const res = await app.request("/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("registers multiple methods on one route", async () => {
    const handler = defineRouteHandler({
      get: { handler: () => "got" },
      post: { handler: () => "posted" },
    });
    bindRouteHandler(app, { route: "/multi", handler });

    expect(await (await app.request("/multi")).text()).toBe("got");
    expect(await (await app.request("/multi", { method: "POST" })).text()).toBe("posted");
  });

  it("validates and exposes typed params", async () => {
    const handler = defineRouteHandler({
      params: z.object({ id: z.coerce.number() }),
      get: {
        handler: (event) => {
          const id = event.context.params.id;
          return { id, doubled: id * 2 };
        },
      },
    });
    bindRouteHandler(app, { route: "/items/:id", handler });

    const res = await app.request("/items/21");
    expect(await res.json()).toEqual({ id: 21, doubled: 42 });
  });

  it("validates JSON body and returns 400 on failure", async () => {
    const handler = defineRouteHandler({
      post: {
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => {
          const body = await event.req.json();
          return { received: body.name };
        },
      },
    });
    bindRouteHandler(app, { route: "/users", handler });

    const ok = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: "Alice" });

    const bad = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(bad.status).toBe(400);
  });

  it("validates query and returns 400 on failure", async () => {
    const handler = defineRouteHandler({
      get: {
        validate: { query: z.object({ limit: z.string().regex(/^\d+$/) }).loose() },
        handler: (event) => ({ limit: event.url.searchParams.get("limit") }),
      },
    });
    bindRouteHandler(app, { route: "/search", handler });

    expect((await app.request("/search?limit=10")).status).toBe(200);
    expect((await app.request("/search?limit=abc")).status).toBe(400);
  });

  it("enforces a media-type map and returns 415 on mismatch", async () => {
    const handler = defineRouteHandler({
      post: {
        validate: {
          body: { "application/json": z.object({ name: z.string() }) },
        },
        handler: async (event) => {
          const body = await event.req.json();
          return { name: body.name };
        },
      },
    });
    bindRouteHandler(app, { route: "/strict", handler });

    const ok = await app.request("/strict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bob" }),
    });
    expect(ok.status).toBe(200);

    const wrong = await app.request("/strict", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "raw",
    });
    expect(wrong.status).toBe(415);
  });

  it("validates response (bare schema) and returns 500 on handler contract breach", async () => {
    const handler = defineRouteHandler({
      get: {
        validate: { response: z.object({ id: z.string() }) },
        // @ts-expect-error: deliberately returns a number where the response schema requires a
        // string, to exercise the runtime 500 contract-breach path.
        handler: () => ({ id: 123 }),
      },
    });
    bindRouteHandler(app, { route: "/broken", handler });

    const res = await app.request("/broken");
    expect(res.status).toBe(500);
  });

  it("validates response against the matching status-code map entry", async () => {
    const handler = defineRouteHandler({
      get: {
        validate: {
          response: {
            200: z.object({ ok: z.literal(true) }),
          },
        },
        handler: () => ({ ok: true as const }),
      },
    });
    bindRouteHandler(app, { route: "/coded", handler });

    const res = await app.request("/coded");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("applies route-level middleware", async () => {
    const calls: string[] = [];
    const handler = defineRouteHandler({
      middleware: [
        (_event, next) => {
          calls.push("mw");
          return next();
        },
      ],
      get: { handler: () => "ok" },
    });
    bindRouteHandler(app, { route: "/mw", handler });

    await app.request("/mw");
    expect(calls).toEqual(["mw"]);
  });

  it("custom onError customizes the validation failure status", async () => {
    const handler = defineRouteHandler(
      {
        post: {
          validate: { body: z.object({ name: z.string() }) },
          handler: async (event) => await event.req.json(),
        },
      },
      {
        onError: () => ({ status: 422, message: "Unprocessable" }),
      },
    );
    bindRouteHandler(app, { route: "/custom-error", handler });

    const res = await app.request("/custom-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(422);
  });

  it("exposes the original def on the handler", () => {
    const def = {
      get: { handler: () => "x" },
    };
    const handler = defineRouteHandler(def);
    expect(handler["~routeDef"]).toBe(def);
    expect(Object.keys(handler["~handlers"])).toEqual(["get"]);
  });
});
