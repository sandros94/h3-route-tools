import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";

import { H3Typed } from "../src/h3-typed.ts";
import { defineRoute } from "../src/route-handler.ts";
import { createTypedFetch, type TypedFetch, type TypedResponse } from "../src/typed-fetch.ts";

// Type assertions run inside never-invoked thunks (calling the stub fetch would throw); a typecheck
// pass is the assertion. Runtime behaviour is covered by wrapping a real app's `request` as transport.

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
      body: z.object({ title: z.string(), tags: z.string().transform((s) => s.split(",")) }),
      response: z.object({ id: z.number() }),
    },
    handler: async (event) => {
      const body = await event.req.json();
      return { id: body.tags.length };
    },
  },
});
const health = defineRoute({ route: "/health", get: { handler: () => ({ ok: true }) } });

const app = new H3Typed().register(posts).register(health);

// A code-gen-style already-resolved routes type (not an app/plugin) — the separate-consumer source.
type CodegenRoutes = {
  "/posts/:id": {
    get: {
      params: { id: number };
      query: never;
      headers: never;
      body: unknown;
      response: { id: number; title: string };
    };
    post: {
      params: { id: number };
      query: { draft: boolean };
      headers: never;
      body: { title: string; tags: string };
      response: { id: number };
    };
  };
};

describe("TypedFetch — typing over an H3Typed app source", () => {
  it("types the GET response and requires params for a parametric route", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      const res = await api("/posts/:id", { method: "get", params: { id: 1 } });
      expectTypeOf(res).toExtend<TypedResponse<{ id: number; title: string }>>();
      expectTypeOf(res.json()).resolves.toEqualTypeOf<{ id: number; title: string }>();
      expectTypeOf(res.status).toEqualTypeOf<number>();
    };
    void check;
  });

  it("types the POST body as schema INPUT, plus query, plus response", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      const res = await api("/posts/:id", {
        method: "post",
        params: { id: 1 },
        query: { draft: true },
        body: { title: "t", tags: "a,b" },
      });
      expectTypeOf(res.json()).resolves.toEqualTypeOf<{ id: number }>();
    };
    void check;
  });

  it("accepts the method in either case", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      await api("/posts/:id", { method: "get", params: { id: 1 } });
      await api("/posts/:id", { method: "GET", params: { id: 1 } });
      await api("/posts/:id", {
        method: "POST",
        params: { id: 1 },
        body: { title: "t", tags: "a" },
      });
    };
    void check;
  });

  it("does not require params for a static route; an unvalidated response stays unknown", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      // no response schema → unknown (only validated responses are typed)
      const res = await api("/health", { method: "get" });
      expectTypeOf(res.json()).resolves.toBeUnknown();
    };
    void check;
  });

  it("rejects an unknown route and an undeclared method", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      // @ts-expect-error — /nope is not a route
      await api("/nope", { method: "get" });
      // @ts-expect-error — delete is not declared on /posts/:id
      await api("/posts/:id", { method: "delete", params: { id: 1 } });
    };
    void check;
  });

  it("rejects a body on GET (RFC) and any excess option key", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      // @ts-expect-error — GET takes no body
      await api("/posts/:id", { method: "get", params: { id: 1 }, body: { x: 1 } });
      // @ts-expect-error — `nope` is not a known option
      await api("/posts/:id", { method: "get", params: { id: 1 }, nope: true });
    };
    void check;
  });

  it("rejects a mistyped body field", () => {
    const check = async (api: TypedFetch<typeof app>) => {
      await api("/posts/:id", {
        method: "post",
        params: { id: 1 },
        // @ts-expect-error — title must be a string
        body: { title: 42, tags: "a" },
      });
    };
    void check;
  });
});

describe("TypedFetch — typing over an already-resolved (code-gen) source", () => {
  it("addresses + types identically to the app-derived client", () => {
    const check = async (api: TypedFetch<CodegenRoutes>) => {
      const res = await api("/posts/:id", {
        method: "POST",
        params: { id: 1 },
        body: { title: "t", tags: "a" },
      });
      expectTypeOf(res.json()).resolves.toEqualTypeOf<{ id: number }>();
    };
    void check;
  });
});

describe("createTypedFetch — runtime over a real app's request", () => {
  const api = createTypedFetch<typeof app>({ fetch: app.request });

  it("substitutes params into the pattern and types + returns the GET response", async () => {
    const res = await api("/posts/:id", { method: "get", params: { id: 1 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, title: "hello" });
  });

  it("upcases the method, appends query, and JSON-encodes the body", async () => {
    const res = await api("/posts/:id", {
      method: "post",
      params: { id: 1 },
      query: { draft: true },
      body: { title: "t", tags: "a,b,c" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 3 });
  });

  it("applies baseURL and serves a static route", async () => {
    const prefixed = createTypedFetch<typeof app>({
      baseURL: "",
      fetch: (url, init) => app.request(url, init),
    });
    const res = await prefixed("/health", { method: "GET" });
    expect(await res.json()).toEqual({ ok: true });
  });
});
