import { describe, it, expect, expectTypeOf } from "vitest";
import { H3 } from "h3";
import { z } from "zod";

import { defineRoute } from "../src/route-handler.ts";
import { harvestRoutes } from "../src/registry.ts";
import type { InferRouteTypes, InferRoutes } from "../src/routes.ts";

// A realistic resource: GET reads a post, POST creates one (body has an input transform so request
// input genuinely differs from validated output), both keyed by a coerced numeric `:id`.
const posts = defineRoute({
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
});

type Posts = InferRouteTypes<typeof posts>;

describe("InferRouteTypes — the typed-route stamp defineRoute carries", () => {
  it("keys the contribution by the route's string literal", () => {
    expectTypeOf<keyof Posts>().toEqualTypeOf<"/posts/:id">();
  });

  it("exposes only the declared methods (no phantom put/delete/head/...)", () => {
    expectTypeOf<keyof Posts["/posts/:id"]>().toEqualTypeOf<"get" | "post">();
  });

  it("types the request body as the schema's INPUT (what the caller sends, pre-transform)", () => {
    expectTypeOf<Posts["/posts/:id"]["post"]["body"]>().toEqualTypeOf<{
      title: string;
      tags: string;
    }>();
  });

  it("types query/params as the schema's OUTPUT (logical values the caller supplies)", () => {
    expectTypeOf<Posts["/posts/:id"]["post"]["query"]>().toEqualTypeOf<{ draft: boolean }>();
    expectTypeOf<Posts["/posts/:id"]["get"]["params"]>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<Posts["/posts/:id"]["post"]["params"]>().toEqualTypeOf<{ id: number }>();
  });

  it("types the response as the schema's OUTPUT (what the caller receives)", () => {
    expectTypeOf<Posts["/posts/:id"]["get"]["response"]>().toEqualTypeOf<{
      id: number;
      title: string;
    }>();
    expectTypeOf<Posts["/posts/:id"]["post"]["response"]>().toEqualTypeOf<{ id: number }>();
  });

  it("omits body on GET (no request body per RFC); other fields stay", () => {
    expectTypeOf<keyof Posts["/posts/:id"]["get"]>().toEqualTypeOf<
      "params" | "query" | "headers" | "response"
    >();
    // POST keeps body — it's the schema input
    expectTypeOf<Posts["/posts/:id"]["post"]["body"]>().toEqualTypeOf<{
      title: string;
      tags: string;
    }>();
  });
});

describe("defineRoute still infers each handler's event from its own validate + route params", () => {
  it("types event.context.params and event.req.json() per method", () => {
    defineRoute({
      route: "/items/:id",
      params: z.object({ id: z.coerce.number() }),
      post: {
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => {
          expectTypeOf(event.context.params.id).toEqualTypeOf<number>();
          expectTypeOf(await event.req.json()).toEqualTypeOf<{ name: string }>();
          return null;
        },
      },
    });
  });
});

describe("InferRoutes — aggregating an app's route plugins (the typed-fetcher substrate)", () => {
  const health = defineRoute({ route: "/health", get: { handler: () => ({ ok: true }) } });
  const postsList = defineRoute({
    route: "/posts",
    get: { validate: { response: z.array(z.object({ id: z.number() })) }, handler: () => [] },
  });

  const postsCreate = defineRoute({
    route: "/posts",
    post: { validate: { body: z.object({ title: z.string() }) }, handler: () => ({ id: 1 }) },
  });
  // a same-method collision: a second GET /posts (first-wins)
  const postsListDup = defineRoute({
    route: "/posts",
    get: {
      validate: { response: z.object({ shadowed: z.boolean() }) },
      handler: () => ({ shadowed: true }),
    },
  });

  it("merges distinct routes by path", () => {
    type App = InferRoutes<[typeof posts, typeof health, typeof postsList]>;
    expectTypeOf<keyof App>().toEqualTypeOf<"/posts/:id" | "/health" | "/posts">();
  });

  it("rejects a non-route-plugin element at the call site (no silent empty result)", () => {
    // @ts-expect-error — `42` is not a RoutePlugin; the bound makes this a compile error, not a silent {}.
    type _N = InferRoutes<[42]>;
    // @ts-expect-error — a plain object lacks the route-plugin brand.
    type _O = InferRouteTypes<{ nope: true }>;
    expectTypeOf<[_N, _O]>().toBeArray();
  });

  it("composes different methods declared for the same path across plugins", () => {
    type App = InferRoutes<[typeof postsList, typeof postsCreate]>;
    expectTypeOf<keyof App["/posts"]>().toEqualTypeOf<"get" | "post">();
  });

  it("keeps the first plugin's endpoint when the same method is declared twice (first-wins)", () => {
    type App = InferRoutes<[typeof postsList, typeof postsListDup]>;
    // postsList's GET response (an array) wins over postsListDup's { shadowed: boolean }
    expectTypeOf<App["/posts"]["get"]["response"]>().toEqualTypeOf<{ id: number }[]>();
  });

  it("exposes each endpoint's request/response shapes for a downstream typed client", () => {
    type App = InferRoutes<[typeof posts]>;

    // How a fetcher / codegen consumes the aggregate: pick a path+method, read its request + response.
    type CreatePost = App["/posts/:id"]["post"];
    expectTypeOf<CreatePost["params"]>().toEqualTypeOf<{ id: number }>();
    expectTypeOf<CreatePost["query"]>().toEqualTypeOf<{ draft: boolean }>();
    expectTypeOf<CreatePost["body"]>().toEqualTypeOf<{ title: string; tags: string }>();
    expectTypeOf<CreatePost["response"]>().toEqualTypeOf<{ id: number }>();
  });
});

// Runtime behaviour, co-located with the type assertions above.
describe("defineRoute — runtime behavior of the typed surface", () => {
  it("a single route's declared methods all dispatch (the real multi-method merge)", async () => {
    const app = new H3();
    app.register(posts);

    // GET → its response shape
    const get = await app.request("/posts/1");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: 1, title: "hello" });

    // POST → body's input transform runs server-side (tags: "a,b,c" → 3 entries)
    const post = await app.request("/posts/1?draft=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", tags: "a,b,c" }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ id: 3 });
  });

  it("an undeclared method on a declared route is 405 (matches the absent type key)", async () => {
    const app = new H3();
    app.register(posts);
    expect((await app.request("/posts/1", { method: "DELETE" })).status).toBe(405);
  });

  it("validates the declared request body (400 on a contract breach)", async () => {
    const app = new H3();
    app.register(posts);
    const bad = await app.request("/posts/1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: 42 }),
    });
    expect(bad.status).toBe(400);
  });

  it("distinct-path plugins each dispatch, and harvest sees exactly those paths", async () => {
    const app = new H3();
    const health = defineRoute({ route: "/health", get: { handler: () => ({ ok: true }) } });
    app.register(posts);
    app.register(health);

    expect((await app.request("/posts/1")).status).toBe(200);
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });

    // the harvested (runtime) paths line up with what InferRoutes would aggregate at the type level
    expect(
      harvestRoutes(app)
        .map((r) => r.route)
        .sort()
    ).toEqual(["/health", "/posts/:id"]);
  });

  it("composes different methods on the same path across plugins (cross-module merge)", async () => {
    const app = new H3();
    app.register(defineRoute({ route: "/dup", get: { handler: () => "got" } }));
    app.register(defineRoute({ route: "/dup", post: { handler: () => "posted" } }));

    expect(await (await app.request("/dup")).text()).toBe("got");
    expect(await (await app.request("/dup", { method: "POST" })).text()).toBe("posted");
  });

  it("is first-wins when the same method is declared twice on a path", async () => {
    const app = new H3();
    app.register(defineRoute({ route: "/dup", get: { handler: () => "first" } }));
    app.register(defineRoute({ route: "/dup", get: { handler: () => "second" } }));

    expect(await (await app.request("/dup")).text()).toBe("first");
  });

  it("405 Allow unions methods from every plugin on the path (cross-module)", async () => {
    const app = new H3();
    app.register(defineRoute({ route: "/dup", get: { handler: () => "g" } }));
    app.register(defineRoute({ route: "/dup", post: { handler: () => "p" } }));

    const res = await app.request("/dup", { method: "DELETE" });
    expect(res.status).toBe(405);
    const allow = res.headers.get("Allow") ?? "";
    expect(allow).toContain("GET");
    expect(allow).toContain("POST");
  });
});
