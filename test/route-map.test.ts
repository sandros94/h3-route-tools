import { describe, it, expect, expectTypeOf } from "vitest";
import { H3 } from "h3";
import { z } from "zod";

import { defineRoute, defineRouteHandler } from "../src/route-handler.ts";
import {
  mountRoutes,
  type InferRoutes,
  type InferRouteMap,
  type InferMethods,
} from "../src/routes.ts";
import { H3Typed } from "../src/h3-typed.ts";

// The grouping form a module author exports: route string → a route-free handler. POST has an input
// transform so request input differs from validated output, mirroring routes.test.ts.
const routes = {
  "/posts/:id": defineRouteHandler({
    params: z.object({ id: z.coerce.number() }),
    get: {
      validate: { response: z.object({ id: z.number(), title: z.string() }) },
      handler: () => ({ id: 1, title: "hello" }),
    },
    post: {
      validate: {
        query: z.object({ draft: z.coerce.boolean() }),
        body: z.object({ title: z.string(), tags: z.string().transform((s) => s.split(",")) }),
        response: z.object({ id: z.number() }),
      },
      handler: async (event) => {
        const body = await event.req.json();
        return { id: body.tags.length };
      },
    },
  }),
  "/health": defineRouteHandler({ get: { handler: () => ({ ok: true }) } }),
};

describe("InferRoutes — aggregating a route-map object", () => {
  type Map = InferRoutes<typeof routes>;

  it("keys by each map route literal, exposing only declared methods", () => {
    expectTypeOf<keyof Map>().toEqualTypeOf<"/posts/:id" | "/health">();
    expectTypeOf<keyof Map["/posts/:id"]>().toEqualTypeOf<"get" | "post">();
    expectTypeOf<keyof Map["/health"]>().toEqualTypeOf<"get">();
  });

  it("carries body=input, params/query/response=output", () => {
    expectTypeOf<Map["/posts/:id"]["post"]["body"]>().toEqualTypeOf<{
      title: string;
      tags: string;
    }>();
    expectTypeOf<Map["/posts/:id"]["post"]["params"]>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<Map["/posts/:id"]["post"]["query"]>().toEqualTypeOf<{ draft: boolean }>();
    expectTypeOf<Map["/posts/:id"]["get"]["response"]>().toEqualTypeOf<{
      id: number;
      title: string;
    }>();
  });

  it("leaves a body-less method's body unknown", () => {
    expectTypeOf<Map["/health"]["get"]["body"]>().toBeUnknown();
  });

  it("InferRouteMap is the same as the InferRoutes object branch", () => {
    expectTypeOf<InferRouteMap<typeof routes>>().toEqualTypeOf<InferRoutes<typeof routes>>();
  });

  it("rejects a non-handler value in the map at the call site", () => {
    // @ts-expect-error — `42` is not a route handler; the RouteMap bound makes this a compile error.
    type _N = InferRoutes<{ "/x": 42 }>;
    expectTypeOf<[_N]>().toBeArray();
  });
});

describe("InferMethods — the per-method map of a single route", () => {
  it("reads a defineRouteHandler handler's methods", () => {
    const handler = defineRouteHandler({
      params: z.object({ id: z.coerce.number() }),
      get: { validate: { response: z.object({ id: z.number() }) }, handler: () => ({ id: 1 }) },
      post: { validate: { body: z.object({ title: z.string() }) }, handler: () => ({ id: 1 }) },
    });
    type M = InferMethods<typeof handler>;
    expectTypeOf<keyof M>().toEqualTypeOf<"get" | "post">();
    expectTypeOf<M["get"]["response"]>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<M["post"]["body"]>().toEqualTypeOf<{ title: string }>();
  });

  it("reads a single defineRoute plugin's one route's methods", () => {
    const plugin = defineRoute({
      route: "/posts/:id",
      get: { validate: { response: z.object({ id: z.number() }) }, handler: () => ({ id: 1 }) },
    });
    type M = InferMethods<typeof plugin>;
    expectTypeOf<keyof M>().toEqualTypeOf<"get">();
    expectTypeOf<M["get"]["response"]>().toEqualTypeOf<{ id: number }>();
  });
});

describe("mountRoutes — runtime", () => {
  it("registers every route in the map and dispatches their methods", async () => {
    const app = new H3();
    app.register(mountRoutes(routes));

    expect(await (await app.request("/posts/1")).json()).toEqual({ id: 1, title: "hello" });
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });

    const post = await app.request("/posts/1?draft=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", tags: "a,b,c" }),
    });
    expect(await post.json()).toEqual({ id: 3 });
  });

  it("405s an undeclared method and 400s a bad body", async () => {
    const app = new H3();
    app.register(mountRoutes(routes));
    expect((await app.request("/health", { method: "DELETE" })).status).toBe(405);
    const bad = await app.request("/posts/1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: 42 }),
    });
    expect(bad.status).toBe(400);
  });

  it("composes with another plugin adding a different method on a shared path", async () => {
    const app = new H3();
    app.register(mountRoutes({ "/x": defineRouteHandler({ get: { handler: () => "g" } }) }));
    app.register(mountRoutes({ "/x": defineRouteHandler({ post: { handler: () => "p" } }) }));

    expect(await (await app.request("/x")).text()).toBe("g");
    expect(await (await app.request("/x", { method: "POST" })).text()).toBe("p");
  });
});

describe("mountRoutes — typed plugin folds into H3Typed.register", () => {
  it("accumulates the map's routes into the instance generic", () => {
    const app = new H3Typed().register(mountRoutes(routes));
    type App = InferRoutes<typeof app>;
    expectTypeOf<keyof App>().toEqualTypeOf<"/posts/:id" | "/health">();
    expectTypeOf<App["/posts/:id"]["get"]["response"]>().toEqualTypeOf<{
      id: number;
      title: string;
    }>();
  });
});
