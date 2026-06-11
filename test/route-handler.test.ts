import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";

import type {
  DocumentableRouteHandler,
  InferMethodBody,
  InferMethodHeaders,
  InferMethodQuery,
  InferMethodResponse,
  InferRouteParams,
  MethodValidate,
  PerMethodDef,
  ResponseValidation,
  RouteHandlerDef,
  RouteMethod,
} from "../src/route-handler.ts";
import { defineRouteHandler, defineRoute } from "../src/route-handler.ts";
import type { EventHandlerWithFetch, H3Plugin } from "h3";

describe("RouteMethod", () => {
  it("is the lowercase HTTPMethod union", () => {
    expectTypeOf<"get">().toExtend<RouteMethod>();
    expectTypeOf<"post">().toExtend<RouteMethod>();
    expectTypeOf<"GET">().not.toExtend<RouteMethod>();
  });
});

describe("InferRouteParams", () => {
  it("resolves to the schema's output when params is set", () => {
    expectTypeOf<InferRouteParams<z.ZodObject<{ id: z.ZodString }>>>().toEqualTypeOf<{
      id: string;
    }>();
  });

  it("defaults to Record<string, string> when params is undefined", () => {
    expectTypeOf<InferRouteParams<undefined>>().toEqualTypeOf<Record<string, string>>();
  });
});

describe("InferMethodBody", () => {
  it("resolves bare schema body to its output", () => {
    type V = MethodValidate<z.ZodObject<{ name: z.ZodString }>>;
    expectTypeOf<InferMethodBody<V>>().toEqualTypeOf<{ name: string }>();
  });

  it("resolves media-type map body to union of per-media-type outputs", () => {
    type V = MethodValidate<{
      "application/json": z.ZodObject<{ name: z.ZodString }>;
      "multipart/form-data": z.ZodObject<{ file: z.ZodString }>;
    }>;
    expectTypeOf<InferMethodBody<V>>().toEqualTypeOf<{ name: string } | { file: string }>();
  });

  it("defaults to unknown when body is undefined", () => {
    expectTypeOf<InferMethodBody<MethodValidate>>().toEqualTypeOf<unknown>();
  });
});

describe("InferMethodQuery", () => {
  it("resolves to schema output", () => {
    type V = MethodValidate<undefined, undefined, z.ZodObject<{ q: z.ZodString }>>;
    expectTypeOf<InferMethodQuery<V>>().toEqualTypeOf<{ q: string }>();
  });

  it("defaults to Partial<Record<string, string>>", () => {
    expectTypeOf<InferMethodQuery<MethodValidate>>().toEqualTypeOf<
      Partial<Record<string, string>>
    >();
  });
});

describe("InferMethodHeaders", () => {
  it("resolves to schema output, defaulting to Record<string, string>", () => {
    type V = MethodValidate<undefined, z.ZodObject<{ "x-id": z.ZodString }>>;
    expectTypeOf<InferMethodHeaders<V>>().toEqualTypeOf<{ "x-id": string }>();
    expectTypeOf<InferMethodHeaders<MethodValidate>>().toEqualTypeOf<Record<string, string>>();
  });
});

describe("InferMethodResponse", () => {
  it("resolves bare schema response to its output", () => {
    type V = MethodValidate<undefined, undefined, undefined, z.ZodObject<{ id: z.ZodString }>>;
    expectTypeOf<InferMethodResponse<V>>().toEqualTypeOf<{ id: string }>();
  });

  it("resolves status-code map response to union of per-status outputs", () => {
    type V = MethodValidate<
      undefined,
      undefined,
      undefined,
      { 200: z.ZodObject<{ id: z.ZodString }>; 404: z.ZodObject<{ error: z.ZodString }> }
    >;
    expectTypeOf<InferMethodResponse<V>>().toEqualTypeOf<{ id: string } | { error: string }>();
  });

  it("defaults to unknown when response is undefined", () => {
    expectTypeOf<InferMethodResponse<MethodValidate>>().toEqualTypeOf<unknown>();
  });
});

describe("ResponseValidation acceptance", () => {
  it("accepts a bare schema and a status-code map", () => {
    const bare: ResponseValidation = z.object({ id: z.string() });
    const map: ResponseValidation = { 200: z.object({ id: z.string() }) };
    expectTypeOf(bare).toExtend<ResponseValidation>();
    expectTypeOf(map).toExtend<ResponseValidation>();
  });
});

describe("PerMethodDef handler signature", () => {
  it("types event.context.params from the route-level params schema", () => {
    type MD = PerMethodDef<MethodValidate, z.ZodObject<{ id: z.ZodString }>>;
    type EventArg = Parameters<MD["handler"]>[0];
    expectTypeOf<EventArg["context"]["params"]>().toEqualTypeOf<{ id: string }>();
  });

  it("types handler return as the inferred response output", () => {
    type V = MethodValidate<undefined, undefined, undefined, z.ZodObject<{ ok: z.ZodBoolean }>>;
    type Return = Awaited<ReturnType<PerMethodDef<V, undefined>["handler"]>>;
    // mutual assignability == structural equality
    expectTypeOf<Return>().toExtend<{ ok: boolean }>();
    expectTypeOf<{ ok: boolean }>().toExtend<Return>();
  });
});

describe("RouteHandlerDef shape", () => {
  it("accepts a method-keyed definition with route-level params and head/options false", () => {
    const def: RouteHandlerDef = {
      params: z.object({ id: z.string() }),
      get: { validate: { query: z.object({ q: z.string() }) }, handler: () => ({}) },
      post: { validate: { body: z.object({ name: z.string() }) }, handler: () => ({}) },
      head: false,
      options: false,
    };
    expectTypeOf(def).toExtend<RouteHandlerDef>();
  });
});

describe("defineRouteHandler return shape", () => {
  it("returns a callable EventHandlerWithFetch carrying ~routeDef and ~options", () => {
    const handler = defineRouteHandler({
      params: z.object({ id: z.string() }),
      post: {
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => await event.req.json(),
      },
    });
    expectTypeOf(handler).toExtend<EventHandlerWithFetch>();
    expectTypeOf(handler).toExtend<DocumentableRouteHandler>();

    type Def = (typeof handler)["~routeDef"];
    expectTypeOf<NonNullable<Def["params"]>>().toEqualTypeOf<z.ZodObject<{ id: z.ZodString }>>();
    expectTypeOf<NonNullable<NonNullable<Def["post"]>["validate"]>>().toExtend<{
      body: z.ZodObject<{ name: z.ZodString }>;
    }>();
  });
});

describe("defineRoute signature", () => {
  it("takes a route-bearing def and returns an H3Plugin", () => {
    const plugin = defineRoute({ route: "/x", get: { handler: () => "x" } });
    expectTypeOf(plugin).toExtend<H3Plugin>();
  });

  it("requires a route on the def", () => {
    // @ts-expect-error: `route` is required by defineRoute.
    defineRoute({ get: { handler: () => "x" } });
  });

  it("types each method handler's event from its own validate + route params", () => {
    defineRoute({
      route: "/items/:id",
      params: z.object({ id: z.coerce.number() }),
      post: {
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => {
          expectTypeOf(event.context.params.id).toEqualTypeOf<number>();
          expectTypeOf(await event.req.json()).toEqualTypeOf<{ name: string }>();
          return "ok";
        },
      },
    });
  });
});

describe("defineRouteHandler end-to-end handler inference", () => {
  it("types event.req.json() from the method's own body schema", () => {
    defineRouteHandler({
      post: {
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => {
          expectTypeOf(await event.req.json()).toEqualTypeOf<{ name: string }>();
          return null;
        },
      },
    });
  });

  it("types event.validated.{query,params,headers} (coerced) and event.context.params", () => {
    defineRouteHandler({
      params: z.object({ id: z.coerce.number() }),
      get: {
        validate: {
          query: z.object({ limit: z.coerce.number() }),
          headers: z.object({ "x-token": z.string() }),
        },
        handler: (event) => {
          expectTypeOf(event.validated.params).toEqualTypeOf<{ id: number }>();
          expectTypeOf(event.validated.query).toEqualTypeOf<{ limit: number }>();
          expectTypeOf(event.validated.headers).toEqualTypeOf<{ "x-token": string }>();
          expectTypeOf(event.context.params).toEqualTypeOf<{ id: number }>();
          return null;
        },
      },
    });
  });

  it("keeps event.context.params optional when no params schema is given", () => {
    defineRouteHandler({
      get: {
        handler: (event) => {
          expectTypeOf(event.context.params).toEqualTypeOf<Record<string, string> | undefined>();
          return null;
        },
      },
    });
  });

  it("types the body as a union for a media-type map", () => {
    defineRouteHandler({
      post: {
        validate: {
          body: {
            "application/json": z.object({ a: z.string() }),
            "multipart/form-data": z.object({ b: z.number() }),
          },
        },
        handler: async (event) => {
          expectTypeOf(await event.req.json()).toEqualTypeOf<{ a: string } | { b: number }>();
          return null;
        },
      },
    });
  });

  it("constrains the handler return to the response schema output", () => {
    defineRouteHandler({
      get: {
        validate: { response: z.object({ ok: z.boolean() }) },
        // @ts-expect-error: returning a non-conforming shape is rejected by the response schema type.
        handler: () => ({ ok: "yes" }),
      },
    });
  });

  it("accepts head: false / options: false", () => {
    defineRouteHandler({ get: { handler: () => "ok" }, head: false, options: false });
  });
});

describe("request-body rules by method", () => {
  it("forbids validate.body on get/head/trace/connect", () => {
    defineRouteHandler({
      // @ts-expect-error — GET takes no request body
      get: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
    });
    defineRouteHandler({
      // @ts-expect-error — HEAD takes no request body
      head: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
    });
    defineRouteHandler({
      // @ts-expect-error — TRACE takes no request body
      trace: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
    });
    defineRouteHandler({
      // @ts-expect-error — CONNECT takes no request body
      connect: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
    });
  });

  it("forbids stream.body on a body-forbidden method", () => {
    defineRouteHandler({
      // @ts-expect-error — GET takes no streamed request body either
      get: { stream: { body: { "application/octet-stream": true } }, handler: () => null },
    });
  });

  it("allows validate.body on post/put/patch/delete/options", () => {
    defineRouteHandler({
      post: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
      put: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
      patch: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
      delete: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
      options: { validate: { body: z.object({ x: z.number() }) }, handler: () => null },
      get: {
        validate: { query: z.object({ q: z.string() }), response: z.object({ ok: z.boolean() }) },
        handler: () => ({ ok: true }),
      },
    });
  });
});

describe("declared head/options appear in the contract", () => {
  it("a declared OPTIONS is a full endpoint (body + response)", () => {
    const handler = defineRouteHandler({
      options: {
        validate: {
          body: z.object({ probe: z.string() }),
          response: z.object({ ok: z.boolean() }),
        },
        handler: async (event) => {
          expectTypeOf(await event.req.json()).toEqualTypeOf<{ probe: string }>();
          return { ok: true };
        },
      },
    });
    type Methods = NonNullable<(typeof handler)["~inferMethods"]>;
    expectTypeOf<keyof Methods>().toEqualTypeOf<"options">();
    expectTypeOf<Methods["options"]["body"]>().toEqualTypeOf<{ probe: string }>();
    expectTypeOf<Methods["options"]["response"]>().toEqualTypeOf<{ ok: boolean }>();
  });

  it("a declared HEAD carries neither body nor response", () => {
    const handler = defineRouteHandler({
      head: { validate: { headers: z.object({ "x-id": z.string() }) }, handler: () => null },
    });
    type Methods = NonNullable<(typeof handler)["~inferMethods"]>;
    expectTypeOf<keyof Methods>().toEqualTypeOf<"head">();
    expectTypeOf<keyof Methods["head"]>().toEqualTypeOf<"params" | "query" | "headers">();
  });
});

describe("preserves inline response literals (no `as const`)", () => {
  it("enum/literal response", () => {
    defineRouteHandler({
      get: {
        validate: { response: z.object({ status: z.enum(["draft", "published"]) }) },
        handler: () => ({ status: "published" }),
      },
    });
  });

  it("status-code map (discriminated union)", () => {
    defineRouteHandler({
      get: {
        validate: {
          response: {
            200: z.object({ id: z.number(), kind: z.literal("ok") }),
            404: z.object({ error: z.literal("not_found") }),
          },
        },
        handler: (event) => {
          if (event.validated.query.flag) {
            event.res.status = 404;
            return { error: "not_found" };
          }
          return { id: 1, kind: "ok" };
        },
      },
    });
  });

  it("array response needs no cast", () => {
    defineRouteHandler({
      get: {
        validate: { response: z.object({ tags: z.array(z.string()) }) },
        handler: () => ({ tags: ["a", "b"] }),
      },
    });
  });

  it("preserved through defineRoute", () => {
    defineRoute({
      route: "/x",
      get: {
        validate: { response: z.object({ status: z.enum(["a", "b"]) }) },
        handler: () => ({ status: "a" }),
      },
    });
  });

  it("still rejects a non-conforming literal", () => {
    defineRouteHandler({
      get: {
        validate: { response: z.object({ status: z.enum(["draft", "published"]) }) },
        // @ts-expect-error — "archived" is not in the enum
        handler: () => ({ status: "archived" }),
      },
    });
  });

  it("rejects undefined/null when a response schema is declared", () => {
    defineRouteHandler({
      get: {
        validate: { response: z.object({ ok: z.boolean() }) },
        // @ts-expect-error — undefined is not a valid response
        handler: () => undefined,
      },
    });
    defineRouteHandler({
      get: {
        validate: { response: z.object({ ok: z.boolean() }) },
        // @ts-expect-error — null is not a valid response
        handler: () => null,
      },
    });
  });

  it("still allows undefined/null when no response schema is declared", () => {
    defineRouteHandler({ get: { handler: () => undefined } });
    defineRouteHandler({ get: { handler: () => null } });
  });

  it("allows undefined/null when the response schema itself is optional/nullable/nullish", () => {
    defineRouteHandler({
      get: {
        validate: { response: z.object({ ok: z.boolean() }).optional() },
        handler: () => undefined,
      },
    });
    defineRouteHandler({
      get: {
        validate: { response: z.object({ ok: z.boolean() }).nullable() },
        handler: () => null,
      },
    });
    defineRouteHandler({
      get: {
        validate: { response: z.object({ ok: z.boolean() }).nullish() },
        handler: () => undefined,
      },
    });
  });
});
