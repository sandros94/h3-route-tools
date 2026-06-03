import { describe, it, expect, expectTypeOf, beforeEach } from "vitest";
import { H3 } from "h3";
import { z } from "zod";

import { defineRouteHandler, bindRouteHandler } from "../../src/internal/route-handler.ts";

/** Counts bytes off the raw stream chunk-by-chunk — never buffers the whole body. */
async function countBytes(body: ReadableStream<Uint8Array> | null): Promise<{ bytes: number }> {
  if (!body) return { bytes: 0 };
  let bytes = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
  }
  return { bytes };
}

describe("defineRouteHandler + bindRouteHandler — e2e", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  it("dispatches a simple GET", async () => {
    bindRouteHandler(app, {
      route: "/hello",
      handler: defineRouteHandler({ get: { handler: () => "hi" } }),
    });
    const res = await app.request("/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("self-dispatches multiple methods on one route", async () => {
    bindRouteHandler(app, {
      route: "/multi",
      handler: defineRouteHandler({
        get: { handler: () => "got" },
        post: { handler: () => "posted" },
      }),
    });
    expect(await (await app.request("/multi")).text()).toBe("got");
    expect(await (await app.request("/multi", { method: "POST" })).text()).toBe("posted");
  });

  it("can be mounted directly with app.all (no bindRouteHandler)", async () => {
    app.all("/direct", defineRouteHandler({ get: { handler: () => "direct" } }));
    expect(await (await app.request("/direct")).text()).toBe("direct");
  });

  it("exposes typed, coerced params via event.context.params and event.validated", async () => {
    bindRouteHandler(app, {
      route: "/items/:id",
      handler: defineRouteHandler({
        params: z.object({ id: z.coerce.number() }),
        get: {
          handler: (event) => ({
            ctx: event.context.params.id,
            bag: event.validated.params.id,
            doubled: event.context.params.id * 2,
          }),
        },
      }),
    });
    expect(await (await app.request("/items/21")).json()).toEqual({
      ctx: 21,
      bag: 21,
      doubled: 42,
    });
  });

  it("exposes coerced query via event.validated.query", async () => {
    bindRouteHandler(app, {
      route: "/search",
      handler: defineRouteHandler({
        get: {
          validate: { query: z.object({ limit: z.coerce.number() }) },
          handler: (event) => ({ limit: event.validated.query.limit }),
        },
      }),
    });
    expect(await (await app.request("/search?limit=10")).json()).toEqual({ limit: 10 });
    expect((await app.request("/search?limit=abc")).status).toBe(400);
  });

  it("validates JSON body lazily via event.req.json()", async () => {
    bindRouteHandler(app, {
      route: "/users",
      handler: defineRouteHandler({
        post: {
          validate: { body: z.object({ name: z.string() }) },
          handler: async (event) => ({ received: (await event.req.json()).name }),
        },
      }),
    });
    const ok = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(await ok.json()).toEqual({ received: "Alice" });

    const bad = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(bad.status).toBe(400);
  });

  it("enforces a media-type map (415 on mismatch)", async () => {
    bindRouteHandler(app, {
      route: "/strict",
      handler: defineRouteHandler({
        post: {
          validate: { body: { "application/json": z.object({ name: z.string() }) } },
          handler: async (event) => await event.req.json(),
        },
      }),
    });
    const wrong = await app.request("/strict", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "raw",
    });
    expect(wrong.status).toBe(415);
  });

  it("validates the response (500 on contract breach)", async () => {
    bindRouteHandler(app, {
      route: "/broken",
      handler: defineRouteHandler({
        get: {
          validate: { response: z.object({ id: z.string() }) },
          // @ts-expect-error: deliberately returns the wrong type to exercise the 500 path.
          handler: () => ({ id: 123 }),
        },
      }),
    });
    expect((await app.request("/broken")).status).toBe(500);
  });

  it("auto-answers HEAD from GET", async () => {
    bindRouteHandler(app, {
      route: "/page",
      handler: defineRouteHandler({ get: { handler: () => "body" } }),
    });
    const res = await app.request("/page", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("auto-answers OPTIONS with 204 + Allow", async () => {
    bindRouteHandler(app, {
      route: "/opt",
      handler: defineRouteHandler({ get: { handler: () => "g" }, post: { handler: () => "p" } }),
    });
    const res = await app.request("/opt", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    const allow = res.headers.get("Allow") ?? "";
    expect(allow).toContain("GET");
    expect(allow).toContain("POST");
    expect(allow).toContain("OPTIONS");
    expect(allow).toContain("HEAD");
  });

  it("returns 405 + Allow for an undeclared method", async () => {
    bindRouteHandler(app, {
      route: "/ro",
      handler: defineRouteHandler({ get: { handler: () => "g" } }),
    });
    const res = await app.request("/ro", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow") ?? "").toContain("GET");
  });

  it("opts out of auto-HEAD with head: false", async () => {
    bindRouteHandler(app, {
      route: "/nohead",
      handler: defineRouteHandler({ get: { handler: () => "g" }, head: false }),
    });
    expect((await app.request("/nohead", { method: "HEAD" })).status).toBe(405);
  });

  it("opts out of auto-OPTIONS with options: false", async () => {
    bindRouteHandler(app, {
      route: "/noopt",
      handler: defineRouteHandler({ get: { handler: () => "g" }, options: false }),
    });
    expect((await app.request("/noopt", { method: "OPTIONS" })).status).toBe(405);
  });

  it("applies route-level middleware", async () => {
    const calls: string[] = [];
    bindRouteHandler(app, {
      route: "/mw",
      handler: defineRouteHandler({
        middleware: [
          (_event, next) => {
            calls.push("mw");
            return next();
          },
        ],
        get: { handler: () => "ok" },
      }),
    });
    await app.request("/mw");
    expect(calls).toEqual(["mw"]);
  });

  it("custom onError customizes the validation failure status", async () => {
    bindRouteHandler(app, {
      route: "/custom-error",
      handler: defineRouteHandler(
        {
          post: {
            validate: { body: z.object({ name: z.string() }) },
            handler: async (event) => await event.req.json(),
          },
        },
        { onError: () => ({ status: 422, message: "Unprocessable" }) },
      ),
    });
    const res = await app.request("/custom-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(422);
  });

  // Streaming body: a declared content type is never buffered; the handler reads the raw stream.
  it("streams the body via event.req.body (never buffered)", async () => {
    bindRouteHandler(app, {
      route: "/upload",
      handler: defineRouteHandler({
        post: {
          validate: {
            stream: {
              "application/octet-stream": {
                type: "string",
                contentMediaType: "application/octet-stream",
              },
            },
          },
          handler: async (event) => {
            expectTypeOf(event.req.body).toEqualTypeOf<ReadableStream<
              Uint8Array<ArrayBuffer>
            > | null>();
            return countBytes(event.req.body);
          },
        },
      }),
    });
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: "hello world",
    });
    expect(await res.json()).toEqual({ bytes: 11 });
  });

  it("exposes the typed def + options on the returned handler", () => {
    const handler = defineRouteHandler({ get: { handler: () => "x" } }, { errors: false });
    expect(typeof handler).toBe("function");
    expect(handler["~routeDef"].get).toBeDefined();
    expect(handler["~options"].errors).toBe(false);
  });
});
