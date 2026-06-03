import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";

import type {
  BindableRouteHandler,
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
} from "../../src/internal/route-handler.ts";
import { defineRouteHandler, bindRouteHandler } from "../../src/internal/route-handler.ts";
import type { EventHandlerWithFetch } from "h3";

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
    type Return = ReturnType<PerMethodDef<V, undefined>["handler"]>;
    expectTypeOf<Return>().toEqualTypeOf<{ ok: boolean } | Promise<{ ok: boolean }>>();
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
    expectTypeOf(handler).toExtend<BindableRouteHandler>();
    expectTypeOf(handler).toExtend<DocumentableRouteHandler>();

    type Def = (typeof handler)["~routeDef"];
    expectTypeOf<NonNullable<Def["params"]>>().toEqualTypeOf<z.ZodObject<{ id: z.ZodString }>>();
    expectTypeOf<NonNullable<NonNullable<Def["post"]>["validate"]>>().toExtend<{
      body: z.ZodObject<{ name: z.ZodString }>;
    }>();
  });
});

describe("bindRouteHandler signature", () => {
  it("takes the H3 instance and an options object with route + handler", () => {
    type Args = Parameters<typeof bindRouteHandler>;
    expectTypeOf<Args["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Args[1]>().toExtend<{
      route: string;
      handler: BindableRouteHandler & DocumentableRouteHandler;
    }>();
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
