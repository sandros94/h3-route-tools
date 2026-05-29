import {
  type EventHandlerRequest,
  type EventHandlerWithFetch,
  type H3,
  type H3Event,
  type H3RouteMeta,
  type HTTPMethod,
  type Middleware,
  defineHandler,
} from "h3";

import type {
  BodyValidation,
  InferOutput,
  OnValidateError,
  SchemaWithJSON,
  ValidatedH3Event,
} from "./types.ts";
import {
  validateBody,
  validateHeaders,
  validateParams,
  validateQuery,
  validateResponse,
} from "./validate.ts";

/** Lowercase HTTP method keys, matching OpenAPI path-item conventions. */
export type RouteMethod = Lowercase<HTTPMethod>;

/** Status code key for response validation maps — numeric (`200`) or string (`"4XX"`, `"default"`). */
export type StatusCodeKey = number | string;

/**
 * Response validation accepts two shapes:
 * - `SchemaWithJSON`: bare schema, sugars to a `200` response.
 * - status-code map: explicit schema per status code (e.g. `{ 200: User, 404: NotFound }`).
 */
export type ResponseValidation = SchemaWithJSON | Record<StatusCodeKey, SchemaWithJSON>;

/** Per-method request validation slots. */
export interface MethodValidate<
  Body extends BodyValidation | undefined = undefined,
  Headers extends SchemaWithJSON | undefined = undefined,
  Query extends SchemaWithJSON | undefined = undefined,
  Response extends ResponseValidation | undefined = undefined,
> {
  body?: Body;
  headers?: Headers;
  query?: Query;
  response?: Response;
}

/** Loose constraint accepting any `MethodValidate` variant; used as a generic bound. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMethodValidate = MethodValidate<any, any, any, any>;

/**
 * Per-method definition: validation + handler + optional method-specific meta.
 * `P` is the route-level params schema, threaded down so `event.context.params` is typed.
 */
export interface MethodDef<
  V extends AnyMethodValidate = MethodValidate,
  P extends SchemaWithJSON | undefined = SchemaWithJSON | undefined,
> {
  validate?: V;
  handler: MethodHandler<V, P>;
  meta?: H3RouteMeta;
}

/** The request shape seen by a method's handler, with body/query/params narrowed from schemas. */
export type MethodRequest<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
> = EventHandlerRequest & {
  body: InferMethodBody<V>;
  query: InferMethodQuery<V>;
  routerParams: InferRouteParams<P>;
};

/**
 * The `event` a method's handler receives. With a validated params schema, `context.params` is
 * required (`ValidatedH3Event`); without one, the plain `H3Event` keeps `params` optional.
 */
export type MethodEvent<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
> = P extends SchemaWithJSON
  ? ValidatedH3Event<MethodRequest<V, P>, InferOutput<P>>
  : H3Event<MethodRequest<V, P>>;

/** Computed event-handler signature for a method, given its validate config + route params. */
export type MethodHandler<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined> = (
  event: MethodEvent<V, P>,
) => InferMethodResponse<V> | Promise<InferMethodResponse<V>>;

/**
 * The full route handler definition — route-free, with `params` hoisted to the route level
 * and per-method entries keyed by lowercase HTTP method.
 */
export interface RouteHandlerDef<
  P extends SchemaWithJSON | undefined = SchemaWithJSON | undefined,
> {
  params?: P;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
  get?: MethodDef<AnyMethodValidate, P>;
  post?: MethodDef<AnyMethodValidate, P>;
  put?: MethodDef<AnyMethodValidate, P>;
  patch?: MethodDef<AnyMethodValidate, P>;
  delete?: MethodDef<AnyMethodValidate, P>;
  options?: MethodDef<AnyMethodValidate, P>;
  head?: MethodDef<AnyMethodValidate, P>;
  connect?: MethodDef<AnyMethodValidate, P>;
  trace?: MethodDef<AnyMethodValidate, P>;
}

/**
 * Per-method def whose `handler` signature is derived from `V` (this method's validate) and `P`
 * (route-level params). `V` is inferred from the sibling `validate`, so the handler's `event` is
 * typed from the schemas declared in the same object.
 */
export interface PerMethodDef<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined> {
  validate?: V;
  meta?: H3RouteMeta;
  handler: MethodHandler<V, P>;
}

/**
 * The `def` parameter of `defineRouteHandler`, with one inferred validate type per method.
 * Each method generic flows into its own handler signature — no shared `Def`, which is what
 * lets per-method inference work through a single object literal.
 */
export interface RouteHandlerInput<
  P extends SchemaWithJSON | undefined,
  Get extends AnyMethodValidate,
  Put extends AnyMethodValidate,
  Post extends AnyMethodValidate,
  Del extends AnyMethodValidate,
  Options extends AnyMethodValidate,
  Head extends AnyMethodValidate,
  Patch extends AnyMethodValidate,
  Trace extends AnyMethodValidate,
  Connect extends AnyMethodValidate,
> {
  params?: P;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
  get?: PerMethodDef<Get, P>;
  put?: PerMethodDef<Put, P>;
  post?: PerMethodDef<Post, P>;
  delete?: PerMethodDef<Del, P>;
  options?: PerMethodDef<Options, P>;
  head?: PerMethodDef<Head, P>;
  patch?: PerMethodDef<Patch, P>;
  trace?: PerMethodDef<Trace, P>;
  connect?: PerMethodDef<Connect, P>;
}

/** Reconstructed route def carried on the returned handler's `~routeDef` stamp. */
export interface ReconstructedRouteDef<
  P extends SchemaWithJSON | undefined,
  Get extends AnyMethodValidate,
  Put extends AnyMethodValidate,
  Post extends AnyMethodValidate,
  Del extends AnyMethodValidate,
  Options extends AnyMethodValidate,
  Head extends AnyMethodValidate,
  Patch extends AnyMethodValidate,
  Trace extends AnyMethodValidate,
  Connect extends AnyMethodValidate,
> {
  params?: P;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
  get?: PerMethodDef<Get, P>;
  put?: PerMethodDef<Put, P>;
  post?: PerMethodDef<Post, P>;
  delete?: PerMethodDef<Del, P>;
  options?: PerMethodDef<Options, P>;
  head?: PerMethodDef<Head, P>;
  patch?: PerMethodDef<Patch, P>;
  trace?: PerMethodDef<Trace, P>;
  connect?: PerMethodDef<Connect, P>;
}

/** Options passed at definition time. */
export interface RouteHandlerOptions {
  /** Customize the `HTTPError` details thrown on any validation failure. */
  onError?: OnValidateError;
  /**
   * Override or opt out of the auto-registered error response schemas (400, 415, 500).
   * Pass `false` to disable auto-registration entirely; pass a partial map to override per-status.
   */
  errors?: false | Partial<Record<StatusCodeKey, SchemaWithJSON>>;
}

/**
 * The opaque object returned by `defineRouteHandler`.
 * `~routeDef` carries the typed definition (for documentation tooling and downstream type
 * extraction); `~handlers` holds the pre-built per-method h3 handlers for `bindRouteHandler`.
 */
export interface RouteHandler<Def = RouteHandlerDef> {
  readonly "~routeDef": Def;
  readonly "~handlers": Partial<Record<RouteMethod, EventHandlerWithFetch>>;
}

/** Minimal structural view of a `RouteHandler` that `bindRouteHandler` needs to wire routes. */
export interface BindableRouteHandler {
  readonly "~routeDef": { middleware?: Middleware[]; meta?: H3RouteMeta };
  readonly "~handlers": Partial<Record<RouteMethod, EventHandlerWithFetch>>;
}

// ─── Inference helpers ────────────────────────────────────────────────────────

/** Resolve route params output type: schema's inferred output, else default `Record<string, string>`. */
export type InferRouteParams<P extends SchemaWithJSON | undefined> = P extends SchemaWithJSON
  ? InferOutput<P>
  : Record<string, string>;

/**
 * Resolve method body type given its `validate.body`:
 * - bare schema → its inferred output
 * - media-type map → union of all per-media-type outputs
 * - absent → `unknown`
 */
export type InferMethodBody<V extends AnyMethodValidate> = V extends { body?: infer B }
  ? [B] extends [SchemaWithJSON]
    ? InferOutput<B>
    : B extends Record<string, SchemaWithJSON>
      ? { [K in keyof B]: InferOutput<B[K]> }[keyof B]
      : unknown
  : unknown;

/** Resolve method query output type, defaulting to `Partial<Record<string, string>>`. */
export type InferMethodQuery<V extends AnyMethodValidate> = V extends { query?: infer Q }
  ? [Q] extends [SchemaWithJSON]
    ? InferOutput<Q>
    : Partial<Record<string, string>>
  : Partial<Record<string, string>>;

/** Resolve method headers output type, defaulting to `Record<string, string>`. */
export type InferMethodHeaders<V extends AnyMethodValidate> = V extends { headers?: infer H }
  ? [H] extends [SchemaWithJSON]
    ? InferOutput<H>
    : Record<string, string>
  : Record<string, string>;

/**
 * Resolve method response type:
 * - bare schema → its inferred output (the `200` shape)
 * - status-code map → union of every value's inferred output
 * - absent → `unknown`
 */
export type InferMethodResponse<V extends AnyMethodValidate> = V extends { response?: infer R }
  ? [R] extends [SchemaWithJSON]
    ? InferOutput<R>
    : R extends Record<StatusCodeKey, SchemaWithJSON>
      ? { [K in keyof R]: InferOutput<R[K]> }[keyof R]
      : unknown
  : unknown;

// ─── Public surface ───────────────────────────────────────────────────────────

/** Every lowercase HTTP method key, in OpenAPI path-item order. */
const METHOD_KEYS: readonly RouteMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "connect",
];

/**
 * Build a route handler from a method-keyed definition. Route-free — pair with `bindRouteHandler`
 * to mount on an `H3` instance, or default-export from a file-routed framework.
 *
 * Each method's `handler` receives an `event` typed from that method's own `validate` schemas
 * and the route-level `params`.
 */
export function defineRouteHandler<
  P extends SchemaWithJSON | undefined = undefined,
  Get extends AnyMethodValidate = MethodValidate,
  Put extends AnyMethodValidate = MethodValidate,
  Post extends AnyMethodValidate = MethodValidate,
  Del extends AnyMethodValidate = MethodValidate,
  Options extends AnyMethodValidate = MethodValidate,
  Head extends AnyMethodValidate = MethodValidate,
  Patch extends AnyMethodValidate = MethodValidate,
  Trace extends AnyMethodValidate = MethodValidate,
  Connect extends AnyMethodValidate = MethodValidate,
>(
  def: RouteHandlerInput<P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>,
  options: RouteHandlerOptions = {},
): RouteHandler<
  ReconstructedRouteDef<P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>
> {
  const handlers: Partial<Record<RouteMethod, EventHandlerWithFetch>> = {};
  const shared = { params: def.params, meta: def.meta };

  if (def.get) handlers.get = buildMethodHandler(def.get, shared, options);
  if (def.put) handlers.put = buildMethodHandler(def.put, shared, options);
  if (def.post) handlers.post = buildMethodHandler(def.post, shared, options);
  if (def.delete) handlers.delete = buildMethodHandler(def.delete, shared, options);
  if (def.options) handlers.options = buildMethodHandler(def.options, shared, options);
  if (def.head) handlers.head = buildMethodHandler(def.head, shared, options);
  if (def.patch) handlers.patch = buildMethodHandler(def.patch, shared, options);
  if (def.trace) handlers.trace = buildMethodHandler(def.trace, shared, options);
  if (def.connect) handlers.connect = buildMethodHandler(def.connect, shared, options);

  return { "~routeDef": def, "~handlers": handlers };
}

/**
 * Bind a previously-defined `RouteHandler` to a concrete route on an `H3` instance.
 * Each declared method is registered via `h3.on(method, route, ...)` with route-level
 * middleware and meta applied.
 */
export function bindRouteHandler(
  h3: H3,
  options: { route: string; handler: BindableRouteHandler },
): void {
  const { route, handler } = options;
  const { middleware, meta } = handler["~routeDef"];

  for (const method of METHOD_KEYS) {
    const h3Handler = handler["~handlers"][method];
    if (!h3Handler) continue;
    h3.on(method, route, h3Handler, { middleware, meta });
  }
}

function buildMethodHandler<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined>(
  methodDef: PerMethodDef<V, P>,
  shared: { params: P; meta: H3RouteMeta | undefined },
  options: RouteHandlerOptions,
): EventHandlerWithFetch {
  const params = shared.params;
  const validate = methodDef.validate;
  const onError = options.onError;
  const meta = methodDef.meta ?? shared.meta;

  return defineHandler({
    meta,
    handler: async (event: H3Event) => {
      if (params) {
        Reflect.set(
          event.context,
          "params",
          validateParams(event.context.params, params, { onError }),
        );
      }
      if (validate?.headers) {
        validateHeaders(event.req, validate.headers, { onError });
      }
      if (validate?.query) {
        validateQuery(event.url, validate.query, { onError });
      }
      if (validate?.body) {
        Reflect.set(event, "req", validateBody(event.req, validate.body, { onError }));
      }

      // @ts-expect-error: the event is request-validated at this point; its static type narrows
      // context.params and req.body beyond what h3's base H3Event proves at this call site.
      const result = await methodDef.handler(event);

      if (validate?.response) {
        return runResponseValidation(result, validate.response, event.res.status, onError);
      }
      return result;
    },
  });
}

function runResponseValidation(
  result: unknown,
  response: ResponseValidation,
  status: number | undefined,
  onError: OnValidateError | undefined,
): Promise<unknown> | unknown {
  const schema = resolveResponseSchema(response, status);
  if (!schema) return result;
  return validateResponse(result, schema, {
    onError: onError ? (r) => onError(r) : undefined,
  });
}

/**
 * Pick the response schema to validate against:
 * - bare schema → used directly (the `200` shape)
 * - status-code map → the entry matching the response status (default `200`), else none
 */
function resolveResponseSchema(
  response: ResponseValidation,
  status: number | undefined,
): SchemaWithJSON | undefined {
  if (isSchema(response)) return response;
  const code = status ?? 200;
  return response[code] ?? response[String(code)];
}

function isSchema(value: ResponseValidation): value is SchemaWithJSON {
  return "~standard" in value;
}
