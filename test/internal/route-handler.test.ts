import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";

import type {
  BindableRouteHandler,
  InferMethodBody,
  InferMethodQuery,
  InferMethodResponse,
  InferRouteParams,
  MethodDef,
  MethodValidate,
  ResponseValidation,
  RouteHandler,
  RouteHandlerDef,
  RouteMethod,
} from "../../src/internal/route-handler.ts";
import { defineRouteHandler, bindRouteHandler } from "../../src/internal/route-handler.ts";

describe("RouteMethod", () => {
  it("is the lowercase HTTPMethod union", () => {
    expectTypeOf<"get">().toExtend<RouteMethod>();
    expectTypeOf<"post">().toExtend<RouteMethod>();
    expectTypeOf<"GET">().not.toExtend<RouteMethod>();
  });
});

describe("InferRouteParams", () => {
  it("resolves to the schema's output when params is set", () => {
    type P = InferRouteParams<z.ZodObject<{ id: z.ZodString }>>;
    expectTypeOf<P>().toEqualTypeOf<{ id: string }>();
  });

  it("defaults to Record<string, string> when params is undefined", () => {
    type P = InferRouteParams<undefined>;
    expectTypeOf<P>().toEqualTypeOf<Record<string, string>>();
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
    type V = MethodValidate;
    expectTypeOf<InferMethodBody<V>>().toEqualTypeOf<unknown>();
  });
});

describe("InferMethodQuery", () => {
  it("resolves to schema output", () => {
    type V = MethodValidate<undefined, undefined, z.ZodObject<{ q: z.ZodString }>>;
    expectTypeOf<InferMethodQuery<V>>().toEqualTypeOf<{ q: string }>();
  });

  it("defaults to Partial<Record<string, string>>", () => {
    type V = MethodValidate;
    expectTypeOf<InferMethodQuery<V>>().toEqualTypeOf<Partial<Record<string, string>>>();
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
      {
        200: z.ZodObject<{ id: z.ZodString }>;
        404: z.ZodObject<{ error: z.ZodString }>;
      }
    >;
    expectTypeOf<InferMethodResponse<V>>().toEqualTypeOf<{ id: string } | { error: string }>();
  });

  it("defaults to unknown when response is undefined", () => {
    type V = MethodValidate;
    expectTypeOf<InferMethodResponse<V>>().toEqualTypeOf<unknown>();
  });
});

describe("ResponseValidation acceptance", () => {
  it("accepts a bare schema", () => {
    const bare: ResponseValidation = z.object({ id: z.string() });
    expectTypeOf(bare).toExtend<ResponseValidation>();
  });

  it("accepts a status-code map", () => {
    const map: ResponseValidation = {
      200: z.object({ id: z.string() }),
      404: z.object({ error: z.string() }),
    };
    expectTypeOf(map).toExtend<ResponseValidation>();
  });
});

describe("MethodDef handler signature", () => {
  it("types event.context.params from route-level params schema", () => {
    type Params = z.ZodObject<{ id: z.ZodString }>;
    type MD = MethodDef<MethodValidate, Params>;

    // The handler's event.context.params is typed as the params schema output
    type Handler = MD["handler"];
    type EventArg = Parameters<Handler>[0];
    type ParamsType = NonNullable<EventArg["context"]["params"]>;
    expectTypeOf<ParamsType>().toEqualTypeOf<{ id: string }>();
  });

  it("types handler return as the inferred response output", () => {
    type V = MethodValidate<undefined, undefined, undefined, z.ZodObject<{ ok: z.ZodBoolean }>>;
    type MD = MethodDef<V>;
    type Return = ReturnType<MD["handler"]>;
    expectTypeOf<Return>().toEqualTypeOf<{ ok: boolean } | Promise<{ ok: boolean }>>();
  });
});

describe("RouteHandlerDef shape", () => {
  it("accepts a method-keyed definition with route-level params", () => {
    const def: RouteHandlerDef = {
      params: z.object({ id: z.string() }),
      get: {
        validate: { query: z.object({ q: z.string() }) },
        handler: () => ({}),
      },
      post: {
        validate: { body: z.object({ name: z.string() }) },
        handler: () => ({}),
      },
    };
    expectTypeOf(def).toExtend<RouteHandlerDef>();
  });
});

describe("defineRouteHandler return shape", () => {
  it("stamps ~routeDef with the route-level params and per-method validate", () => {
    const handler = defineRouteHandler({
      params: z.object({ id: z.string() }),
      post: {
        validate: { body: z.object({ name: z.string() }) },
        handler: async (event) => await event.req.json(),
      },
    });
    type Def = (typeof handler)["~routeDef"];
    expectTypeOf<NonNullable<Def["params"]>>().toEqualTypeOf<z.ZodObject<{ id: z.ZodString }>>();
    expectTypeOf<NonNullable<NonNullable<Def["post"]>["validate"]>>().toExtend<{
      body: z.ZodObject<{ name: z.ZodString }>;
    }>();
  });

  it("exposes pre-built handlers map", () => {
    type H = RouteHandler["~handlers"];
    expectTypeOf<H>().toExtend<Partial<Record<RouteMethod, unknown>>>();
  });
});

describe("bindRouteHandler signature", () => {
  it("takes the H3 instance and an options object with route + handler", () => {
    type Args = Parameters<typeof bindRouteHandler>;
    expectTypeOf<Args["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Args[1]>().toExtend<{ route: string; handler: BindableRouteHandler }>();
  });

  it("accepts a defineRouteHandler result as its handler", () => {
    const handler = defineRouteHandler({ get: { handler: () => "ok" } });
    expectTypeOf(handler).toExtend<BindableRouteHandler>();
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

  it("types event.context.params as required when a params schema is validated", () => {
    defineRouteHandler({
      params: z.object({ id: z.coerce.number() }),
      get: {
        handler: (event) => {
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

  it("each method infers independently within the same route", () => {
    defineRouteHandler({
      get: {
        validate: { query: z.object({ q: z.string() }).loose() },
        handler: (event) => {
          expectTypeOf(event.url.searchParams.get("q")).toEqualTypeOf<string | null>();
          return null;
        },
      },
      post: {
        validate: { body: z.object({ payload: z.string() }) },
        handler: async (event) => {
          expectTypeOf(await event.req.json()).toEqualTypeOf<{ payload: string }>();
          return null;
        },
      },
    });
  });
});
