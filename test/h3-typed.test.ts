import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";

import { H3Typed, type H3Routes } from "../src/h3-typed.ts";
import { defineRoute } from "../src/route-handler.ts";

// Chained construction: the same realistic resource as routes.test.ts, built via the class so the
// instance generic accumulates each contribution (the substrate H3Routes<typeof app> reads).
function makeApp() {
  return new H3Typed()
    .route({
      route: "/posts/:id",
      params: z.object({ id: z.coerce.number() }),
      get: {
        validate: { response: z.object({ id: z.number(), title: z.string() }) },
        handler: () => ({ id: 1, title: "hello" }),
      },
      post: {
        validate: {
          query: z.object({ draft: z.coerce.boolean() }),
          body: z.object({
            title: z.string(),
            tags: z.string().transform((s) => s.split(",")),
          }),
          response: z.object({ id: z.number() }),
        },
        handler: async (event) => {
          const body = await event.req.json();
          return { id: body.tags.length };
        },
      },
    })
    .route({ route: "/health", get: { handler: () => ({ ok: true }) } });
}

describe("H3Routes — the typed map accumulated through H3Typed.route()", () => {
  type App = H3Routes<ReturnType<typeof makeApp>>;

  it("keys every chained route by its string literal", () => {
    expectTypeOf<keyof App>().toEqualTypeOf<"/posts/:id" | "/health">();
  });

  it("exposes only each route's declared methods", () => {
    expectTypeOf<keyof App["/posts/:id"]>().toEqualTypeOf<"get" | "post">();
    expectTypeOf<keyof App["/health"]>().toEqualTypeOf<"get">();
  });

  it("carries body=input, params/query/response=output per endpoint", () => {
    expectTypeOf<App["/posts/:id"]["post"]["body"]>().toEqualTypeOf<{
      title: string;
      tags: string;
    }>();
    expectTypeOf<App["/posts/:id"]["post"]["params"]>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<App["/posts/:id"]["post"]["query"]>().toEqualTypeOf<{ draft: boolean }>();
    expectTypeOf<App["/posts/:id"]["get"]["response"]>().toEqualTypeOf<{
      id: number;
      title: string;
    }>();
  });

  it("composes different methods on the same path across chained calls (first-wins on dup)", () => {
    const app = new H3Typed()
      .route({ route: "/posts", get: { validate: { response: z.string() }, handler: () => "a" } })
      .route({ route: "/posts", post: { handler: () => ({ id: 1 }) } })
      .route({ route: "/posts", get: { handler: () => "shadowed" } });
    type R = H3Routes<typeof app>;
    expectTypeOf<keyof R["/posts"]>().toEqualTypeOf<"get" | "post">();
    // the first GET /posts wins
    expectTypeOf<R["/posts"]["get"]["response"]>().toEqualTypeOf<string>();
  });
});

describe("H3Routes — also reads a readonly RoutePlugin[] tuple (the register-style path)", () => {
  const posts = defineRoute({
    route: "/posts/:id",
    get: { validate: { response: z.object({ id: z.number() }) }, handler: () => ({ id: 1 }) },
  });
  const health = defineRoute({ route: "/health", get: { handler: () => ({ ok: true }) } });

  it("aggregates a tuple identically to InferRoutes", () => {
    type App = H3Routes<[typeof posts, typeof health]>;
    expectTypeOf<keyof App>().toEqualTypeOf<"/posts/:id" | "/health">();
    expectTypeOf<App["/posts/:id"]["get"]["response"]>().toEqualTypeOf<{ id: number }>();
  });

  it("reads a single plugin too", () => {
    type App = H3Routes<typeof posts>;
    expectTypeOf<keyof App>().toEqualTypeOf<"/posts/:id">();
  });
});

describe("H3Typed.register — a RoutePlugin accumulates into the instance generic too", () => {
  const posts = defineRoute({
    route: "/posts/:id",
    get: { validate: { response: z.object({ id: z.number() }) }, handler: () => ({ id: 1 }) },
  });

  it("folds a registered plugin's routes in, identically to .route()", () => {
    const app = new H3Typed()
      .register(posts)
      .route({ route: "/health", get: { handler: () => ({ ok: true }) } });

    type App = H3Routes<typeof app>;
    expectTypeOf<keyof App>().toEqualTypeOf<"/posts/:id" | "/health">();
    expectTypeOf<App["/posts/:id"]["get"]["response"]>().toEqualTypeOf<{ id: number }>();
  });

  it("composes a registered method with a .route() method on the same path (first-wins)", () => {
    const app = new H3Typed()
      .register(defineRoute({ route: "/x", get: { handler: () => "g" } }))
      .route({ route: "/x", post: { handler: () => "p" } });
    type App = H3Routes<typeof app>;
    expectTypeOf<keyof App["/x"]>().toEqualTypeOf<"get" | "post">();
  });

  it("mounts the registered plugin at runtime", async () => {
    const app = new H3Typed().register(posts);
    expect(await (await app.request("/posts/1")).json()).toEqual({ id: 1 });
  });
});

describe("H3Typed — runtime behavior (it is a real H3 app)", () => {
  it("dispatches each chained route's declared methods", async () => {
    const app = makeApp();

    expect(await (await app.request("/posts/1")).json()).toEqual({ id: 1, title: "hello" });
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });

    const post = await app.request("/posts/1?draft=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", tags: "a,b,c" }),
    });
    expect(await post.json()).toEqual({ id: 3 });
  });

  it("405s an undeclared method and unions Allow across methods on the path", async () => {
    const app = new H3Typed()
      .route({ route: "/dup", get: { handler: () => "g" } })
      .route({ route: "/dup", post: { handler: () => "p" } });

    const res = await app.request("/dup", { method: "DELETE" });
    expect(res.status).toBe(405);
    const allow = res.headers.get("Allow") ?? "";
    expect(allow).toContain("GET");
    expect(allow).toContain("POST");
  });

  it("validates the declared request body (400 on a contract breach)", async () => {
    const app = makeApp();
    const bad = await app.request("/posts/1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: 42 }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("H3Typed — openapi config serves a document built from the chained routes", () => {
  it("serves /openapi.json covering routes added before and after the openapi route", async () => {
    const app = new H3Typed({ openapi: { info: { title: "T", version: "1.0.0" } } }).route({
      route: "/posts/:id",
      get: { validate: { response: z.object({ id: z.number() }) }, handler: () => ({ id: 1 }) },
    });

    const doc = await (await app.request("/openapi.json")).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "T", version: "1.0.0" });
    expect(Object.keys(doc.paths)).toContain("/posts/{id}");
  });

  it("honors a custom document path", async () => {
    const app = new H3Typed({
      openapi: { info: { title: "T", version: "1.0.0" }, path: "/docs.json" },
    });
    expect((await app.request("/docs.json")).status).toBe(200);
  });
});
