import { describe, it, expect, expectTypeOf, beforeEach } from "vitest";
import { H3 } from "h3";
import { z } from "zod";

import { defineRouteHandler, defineRoute } from "../src/route-handler.ts";

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

describe("defineRoute — e2e", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  it("dispatches a simple GET", async () => {
    app.register(defineRoute({ route: "/hello", get: { handler: () => "hi" } }));
    const res = await app.request("/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("self-dispatches multiple methods on one route", async () => {
    app.register(
      defineRoute({
        route: "/multi",
        get: { handler: () => "got" },
        post: { handler: () => "posted" },
      })
    );
    expect(await (await app.request("/multi")).text()).toBe("got");
    expect(await (await app.request("/multi", { method: "POST" })).text()).toBe("posted");
  });

  it("can be mounted directly with app.all (no defineRoute)", async () => {
    app.all("/direct", defineRouteHandler({ get: { handler: () => "direct" } }));
    expect(await (await app.request("/direct")).text()).toBe("direct");
  });

  /*
    The migration-bridge contract: a bare defineRouteHandler is a drop-in for defineEventHandler
    BECAUSE it self-dispatches. Mounted in a method-agnostic slot (app.all / app.use / a non
    method-locked Nitro file), the single handler serves every declared method itself.
  */
  it("drop-in: one app.all mount serves all declared methods + 405/OPTIONS", async () => {
    app.all(
      "/u",
      defineRouteHandler({
        get: { handler: () => "got" },
        post: { handler: () => "posted" },
      })
    );
    expect(await (await app.request("/u")).text()).toBe("got");
    expect(await (await app.request("/u", { method: "POST" })).text()).toBe("posted");
    expect((await app.request("/u", { method: "DELETE" })).status).toBe(405);
    expect((await app.request("/u", { method: "OPTIONS" })).status).toBe(204);
  });

  /*
    Known footgun (to be flagged by the Nitro dev plugin's method-lock check): a MULTI-method handler
    in a SINGLE-method slot — app.get(...) or a `*.get.ts` file — only ever receives that one method;
    the others never reach the self-dispatcher and 404. Pinned so this stays a loud, intended break.
  */
  it("footgun: a multi-method handler under app.get leaves the other methods unreachable (404)", async () => {
    app.get(
      "/u",
      defineRouteHandler({
        get: { handler: () => "got" },
        post: { handler: () => "posted" },
      })
    );
    expect(await (await app.request("/u")).text()).toBe("got");
    expect((await app.request("/u", { method: "POST" })).status).toBe(404);
    expect((await app.request("/u", { method: "OPTIONS" })).status).toBe(404);
  });

  it("exposes typed, coerced params via event.context.params and event.validated", async () => {
    app.register(
      defineRoute({
        route: "/items/:id",
        params: z.object({ id: z.coerce.number() }),
        get: {
          handler: (event) => ({
            ctx: event.context.params.id,
            bag: event.validated.params.id,
            doubled: event.context.params.id * 2,
          }),
        },
      })
    );
    expect(await (await app.request("/items/21")).json()).toEqual({
      ctx: 21,
      bag: 21,
      doubled: 42,
    });
  });

  it("exposes coerced query via event.validated.query", async () => {
    app.register(
      defineRoute({
        route: "/search",
        get: {
          validate: { query: z.object({ limit: z.coerce.number() }) },
          handler: (event) => ({ limit: event.validated.query.limit }),
        },
      })
    );
    expect(await (await app.request("/search?limit=10")).json()).toEqual({ limit: 10 });
    expect((await app.request("/search?limit=abc")).status).toBe(400);
  });

  it("validates JSON body lazily via event.req.json()", async () => {
    app.register(
      defineRoute({
        route: "/users",
        post: {
          validate: { body: z.object({ name: z.string() }) },
          handler: async (event) => ({ received: (await event.req.json()).name }),
        },
      })
    );
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

  it("reads + validates a DELETE request body", async () => {
    app.register(
      defineRoute({
        route: "/res/:id",
        params: z.object({ id: z.coerce.number() }),
        delete: {
          validate: {
            body: z.object({ reason: z.string() }),
            response: z.object({ deleted: z.number(), reason: z.string() }),
          },
          handler: async (event) => ({
            deleted: event.validated.params.id,
            reason: (await event.req.json()).reason,
          }),
        },
      })
    );
    const ok = await app.request("/res/9", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "cleanup" }),
    });
    expect(await ok.json()).toEqual({ deleted: 9, reason: "cleanup" });

    const bad = await app.request("/res/9", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: 42 }),
    });
    expect(bad.status).toBe(400);
  });

  it("reads + validates a declared OPTIONS body (overrides auto-OPTIONS)", async () => {
    app.register(
      defineRoute({
        route: "/probe",
        options: {
          validate: {
            body: z.object({ probe: z.string() }),
            response: z.object({ echoed: z.string() }),
          },
          handler: async (event) => ({ echoed: (await event.req.json()).probe }),
        },
      })
    );
    const res = await app.request("/probe", {
      method: "OPTIONS",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ probe: "hi" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echoed: "hi" });
  });

  it("enforces a media-type map (415 on mismatch)", async () => {
    app.register(
      defineRoute({
        route: "/strict",
        post: {
          validate: { body: { "application/json": z.object({ name: z.string() }) } },
          handler: async (event) => await event.req.json(),
        },
      })
    );
    const wrong = await app.request("/strict", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "raw",
    });
    expect(wrong.status).toBe(415);
  });

  it("validates the response (500 on contract breach)", async () => {
    app.register(
      defineRoute({
        route: "/broken",
        get: {
          validate: { response: z.object({ id: z.string() }) },
          // @ts-expect-error: deliberately returns the wrong type to exercise the 500 path.
          handler: () => ({ id: 123 }),
        },
      })
    );
    expect((await app.request("/broken")).status).toBe(500);
  });

  it("auto-answers HEAD from GET", async () => {
    app.register(defineRoute({ route: "/page", get: { handler: () => "body" } }));
    const res = await app.request("/page", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("auto-answers OPTIONS with 204 + Allow", async () => {
    app.register(
      defineRoute({ route: "/opt", get: { handler: () => "g" }, post: { handler: () => "p" } })
    );
    const res = await app.request("/opt", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    const allow = res.headers.get("Allow") ?? "";
    expect(allow).toContain("GET");
    expect(allow).toContain("POST");
    expect(allow).toContain("OPTIONS");
    expect(allow).toContain("HEAD");
  });

  it("returns 405 + Allow for an undeclared method", async () => {
    app.register(defineRoute({ route: "/ro", get: { handler: () => "g" } }));
    const res = await app.request("/ro", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow") ?? "").toContain("GET");
  });

  it("opts out of auto-HEAD with head: false", async () => {
    app.register(defineRoute({ route: "/nohead", get: { handler: () => "g" }, head: false }));
    expect((await app.request("/nohead", { method: "HEAD" })).status).toBe(405);
  });

  it("opts out of auto-OPTIONS with options: false", async () => {
    app.register(defineRoute({ route: "/noopt", get: { handler: () => "g" }, options: false }));
    expect((await app.request("/noopt", { method: "OPTIONS" })).status).toBe(405);
  });

  it("applies route-level middleware", async () => {
    const calls: string[] = [];
    app.register(
      defineRoute({
        route: "/mw",
        middleware: [
          (_event, next) => {
            calls.push("mw");
            return next();
          },
        ],
        get: { handler: () => "ok" },
      })
    );
    await app.request("/mw");
    expect(calls).toEqual(["mw"]);
  });

  it("custom onValidationError customizes the validation failure status", async () => {
    app.register(
      defineRoute({
        route: "/custom-error",
        onValidationError: () => ({ status: 422, message: "Unprocessable" }),
        post: {
          validate: { body: z.object({ name: z.string() }) },
          handler: async (event) => await event.req.json(),
        },
      })
    );
    const res = await app.request("/custom-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(422);
  });

  // Streaming body: a declared content type is never buffered; the handler reads the raw stream.
  it("streams the body via event.req.body (never buffered)", async () => {
    app.register(
      defineRoute({
        route: "/upload",
        post: {
          // Raw binary upload: undocumented payload — the content-type key is all the spec needs.
          stream: { body: { "application/octet-stream": true } },
          handler: async (event) => {
            expectTypeOf(event.req.body).toEqualTypeOf<ReadableStream<
              Uint8Array<ArrayBuffer>
            > | null>();
            return countBytes(event.req.body);
          },
        },
      })
    );
    const res = await app.request("/upload", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: "hello world",
    });
    expect(await res.json()).toEqual({ bytes: 11 });
  });

  // Streamed response: a status declared under stream.response is doc-only — passed through, never validated.
  it("passes a streamed response through without validation", async () => {
    app.register(
      defineRoute({
        route: "/events",
        get: {
          stream: { response: { 200: { "text/event-stream": true } } },
          handler: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
                controller.close();
              },
            }),
        },
      })
    );
    const res = await app.request("/events");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("data: hi");
  });

  it("throws 500 when a schema-validated status is answered with a stream (no silent drift)", async () => {
    app.register(
      defineRoute({
        route: "/bad-stream",
        get: {
          validate: { response: z.object({ id: z.string() }) },
          // @ts-expect-error: a ReadableStream can't satisfy the declared object response schema.
          handler: () => new ReadableStream(),
        },
      })
    );
    expect((await app.request("/bad-stream")).status).toBe(500);
  });

  it("exposes the typed def + options on the handler built by defineRouteHandler", () => {
    const handler = defineRouteHandler({ get: { handler: () => "x" } }, { errors: false });
    expect(typeof handler).toBe("function");
    expect(handler["~routeDef"].get).toBeDefined();
    expect(handler["~options"].errors).toBe(false);
  });
});
