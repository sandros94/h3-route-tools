import {
  type EventHandlerRequest,
  type EventHandlerWithFetch,
  type H3,
  type H3Event,
  type H3Plugin,
  type H3RouteMeta,
  type Middleware,
  HTTPError,
  defineHandler,
  getQuery,
} from "h3";

import type {
  BodyValidation,
  InferInput,
  InferOutput,
  OnValidateError,
  RouteMethod,
  SchemaWithJSON,
  StatusCodeKey,
  StreamMap,
  ValidatedH3Event,
} from "./internal/types.ts";
import {
  validateBody,
  validateHeaders,
  validateParams,
  validateQuery,
  validateResponse,
} from "./internal/validate.ts";

export type { RouteMethod, StatusCodeKey } from "./internal/types.ts";

/**
 * Response validation accepts two shapes:
 * - `SchemaWithJSON`: bare schema, sugars to a `200` response.
 * - status-code map: explicit schema per status code (e.g. `{ 200: User, 404: NotFound }`).
 */
export type ResponseValidation = SchemaWithJSON | Record<StatusCodeKey, SchemaWithJSON>;

/** Per-method validation slots — everything here is value-validated. Raw streams live in {@link MethodStream}. */
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

/** A map of status code → {@link StreamMap}, documenting raw streamed responses per status. */
export type ResponseStreamMap = Record<StatusCodeKey, StreamMap>;

/**
 * Per-method raw-stream slots — doc-only, never value-validated (a stream can't be).
 * - `body`: request content types read raw via `event.req.body`.
 * - `response`: statuses the handler answers with a stream; documented, validation skipped.
 *
 * The counterpart to {@link MethodValidate}: `validate` is what gets checked, `stream` is what passes through.
 */
export interface MethodStream {
  body?: StreamMap;
  response?: ResponseStreamMap;
}

/** Loose constraint accepting any `MethodValidate` variant; used as a generic bound. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMethodValidate = MethodValidate<any, any, any, any>;

/** The request shape seen by a method's handler, with body/query/params narrowed from schemas. */
export type MethodRequest<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
> = EventHandlerRequest & {
  body: InferMethodBody<V>;
  query: InferMethodQuery<V>;
  routerParams: InferRouteParams<P>;
};

/** The coerced, validated request data exposed at `event.validated`. */
export interface ValidatedData<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined> {
  query: InferMethodQuery<V>;
  params: InferRouteParams<P>;
  headers: InferMethodHeaders<V>;
}

/**
 * The `event` a method's handler receives. `event.validated` holds the coerced query/params/headers;
 * with a validated params schema `event.context.params` is required, else it stays optional (h3 default).
 * The validated body is read lazily via `event.req.json()`.
 */
export type MethodEvent<
  V extends AnyMethodValidate,
  P extends SchemaWithJSON | undefined,
> = (P extends SchemaWithJSON
  ? ValidatedH3Event<MethodRequest<V, P>, InferOutput<P>>
  : H3Event<MethodRequest<V, P>>) & {
  validated: ValidatedData<V, P>;
};

/** Computed event-handler signature for a method, given its validate config + route params. */
export type MethodHandler<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined> = (
  event: MethodEvent<V, P>,
) => InferMethodResponse<V> | Promise<InferMethodResponse<V>>;

/**
 * Per-method def whose `handler` signature is derived from `V` (this method's validate) and `P`
 * (route-level params). `V` is inferred from the sibling `validate`, so the handler's `event` is
 * typed from the schemas declared in the same object.
 */
export interface PerMethodDef<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined> {
  validate?: V;
  stream?: MethodStream;
  meta?: H3RouteMeta;
  handler: MethodHandler<V, P>;
}

/**
 * The full route handler definition. `params` is hoisted to the route level; `head`/`options`
 * additionally accept `false` to opt out of their auto behavior (auto-HEAD, auto-OPTIONS).
 */
export interface RouteHandlerDef<
  P extends SchemaWithJSON | undefined = SchemaWithJSON | undefined,
> {
  params?: P;
  middleware?: Middleware[];
  meta?: H3RouteMeta;
  get?: PerMethodDef<AnyMethodValidate, P>;
  post?: PerMethodDef<AnyMethodValidate, P>;
  put?: PerMethodDef<AnyMethodValidate, P>;
  patch?: PerMethodDef<AnyMethodValidate, P>;
  delete?: PerMethodDef<AnyMethodValidate, P>;
  head?: PerMethodDef<AnyMethodValidate, P> | false;
  options?: PerMethodDef<AnyMethodValidate, P> | false;
  connect?: PerMethodDef<AnyMethodValidate, P>;
  trace?: PerMethodDef<AnyMethodValidate, P>;
}

/**
 * The `def` of `defineRouteHandler`, with one inferred validate type per method. Each method generic
 * flows into its own handler signature — no shared `Def`, which is what lets per-method inference work
 * through a single object literal. Also serves as the `~routeDef` stamp carried on the built handler.
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
  options?: PerMethodDef<Options, P> | false;
  head?: PerMethodDef<Head, P> | false;
  patch?: PerMethodDef<Patch, P>;
  trace?: PerMethodDef<Trace, P>;
  connect?: PerMethodDef<Connect, P>;
}

/**
 * Controls auto-registered error response schemas (400, 415, 500).
 * `false` disables auto-registration entirely; a partial map overrides the schema per status.
 */
export type ErrorResponsesOption = false | Partial<Record<StatusCodeKey, SchemaWithJSON>>;

/** Options passed at definition time. */
export interface RouteHandlerOptions {
  /** Customize the `HTTPError` details thrown on any validation failure. */
  onError?: OnValidateError;
  /** Override or opt out of the auto-registered error response schemas (400, 415, 500). */
  errors?: ErrorResponsesOption;
  /** Decode route params with `decodeURIComponent` before validation (default off, h3 parity). */
  decode?: boolean;
}

/**
 * A self-dispatching `EventHandlerWithFetch` returned by `defineRouteHandler`, carrying the runtime
 * `~routeDef`/`~options` plus a **type-only** `~inferMethods` stamp. Mount it like any h3 handler.
 *
 * `~inferMethods` is a phantom: never present at runtime, read only through `InferMethods<typeof h>`.
 * Don't access it directly — it's optional purely so it can stay value-free, so a direct read is
 * `Methods | undefined`. The `Infer*` utilities strip that.
 */
export type RouteHandler<Def = RouteHandlerDef, Methods = unknown> = EventHandlerWithFetch & {
  readonly "~routeDef": Def;
  readonly "~options": RouteHandlerOptions;
  readonly "~inferMethods"?: Methods;
};

/** A method def projected for documentation — validation + meta, handler omitted. */
export type DocumentableMethodDef = Omit<
  PerMethodDef<AnyMethodValidate, SchemaWithJSON | undefined>,
  "handler"
>;

/** A route def projected for documentation — params/meta + per-method validation, handlers omitted. */
export type DocumentableRouteDef = Pick<RouteHandlerDef, "params" | "meta"> & {
  [M in RouteMethod]?: DocumentableMethodDef | false;
};

/**
 * Structural view of a `RouteHandler` carrying only what OpenAPI generation reads.
 * Omitting the handler function avoids contravariance when widening concrete route handlers.
 */
export interface DocumentableRouteHandler {
  readonly "~routeDef": DocumentableRouteDef;
  readonly "~options"?: { errors?: ErrorResponsesOption };
}

// ─── Inference helpers ────────────────────────────────────────────────────────

/**
 * Inference direction: a schema's accepted `input` (what a caller sends) vs its validated `output`
 * (what a handler receives). Handlers read output; the typed fetcher sends input.
 */
type Direction = "input" | "output";
type InferDir<S extends SchemaWithJSON, D extends Direction> = D extends "input"
  ? InferInput<S>
  : InferOutput<S>;

/** Resolve route params for direction `D`: the schema's inferred type, else default `Record<string, string>`. */
type InferRouteParamsDir<
  P extends SchemaWithJSON | undefined,
  D extends Direction,
> = P extends SchemaWithJSON ? InferDir<P, D> : Record<string, string>;
/** Route params as seen by a handler (validated output). */
export type InferRouteParams<P extends SchemaWithJSON | undefined> = InferRouteParamsDir<
  P,
  "output"
>;

/**
 * Resolve method body type for direction `D` given its `validate.body`:
 * - bare schema → its inferred type
 * - media-type map → union of all per-media-type types
 * - absent → `unknown`
 */
type InferMethodBodyDir<V extends AnyMethodValidate, D extends Direction> = V extends {
  body?: infer B;
}
  ? [B] extends [SchemaWithJSON]
    ? InferDir<B, D>
    : B extends Record<string, SchemaWithJSON>
      ? { [K in keyof B]: InferDir<B[K], D> }[keyof B]
      : unknown
  : unknown;
/** Method body as seen by a handler (validated output). */
export type InferMethodBody<V extends AnyMethodValidate> = InferMethodBodyDir<V, "output">;

/** Resolve method query type for direction `D`, defaulting to `Partial<Record<string, string>>`. */
type InferMethodQueryDir<V extends AnyMethodValidate, D extends Direction> = V extends {
  query?: infer Q;
}
  ? [Q] extends [SchemaWithJSON]
    ? InferDir<Q, D>
    : Partial<Record<string, string>>
  : Partial<Record<string, string>>;
/** Method query as seen by a handler (validated output). */
export type InferMethodQuery<V extends AnyMethodValidate> = InferMethodQueryDir<V, "output">;

/** Resolve method headers type for direction `D`, defaulting to `Record<string, string>`. */
type InferMethodHeadersDir<V extends AnyMethodValidate, D extends Direction> = V extends {
  headers?: infer H;
}
  ? [H] extends [SchemaWithJSON]
    ? InferDir<H, D>
    : Record<string, string>
  : Record<string, string>;
/** Method headers as seen by a handler (validated output). */
export type InferMethodHeaders<V extends AnyMethodValidate> = InferMethodHeadersDir<V, "output">;

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
export const METHOD_KEYS: readonly RouteMethod[] = [
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

/** Loose runtime view of a method entry (handler typed permissively for the dispatcher). */
interface RuntimeMethod {
  validate?: AnyMethodValidate;
  stream?: MethodStream;
  meta?: H3RouteMeta;
  handler: (...args: never[]) => unknown;
}

type RuntimeMethods = Partial<Record<string, RuntimeMethod | false>>;

/**
 * Build a route handler from a method-keyed definition. Route-free — mount the returned
 * `EventHandlerWithFetch` like any h3 handler (`app.all(route, h)`, a Nitro file, etc.); it
 * dispatches on the request method internally and carries `~routeDef`/`~options` for docs.
 *
 * Each method's `handler` receives an `event` typed from its own `validate` schemas + route `params`.
 */
export function defineRouteHandler<
  K extends string = never,
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
  def: RouteHandlerInput<P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect> &
    Record<K, unknown>,
  options: RouteHandlerOptions = {},
): RouteHandler<
  RouteHandlerInput<P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>,
  MethodsRecord<K, P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>
> {
  const methods: RuntimeMethods = {
    get: def.get,
    put: def.put,
    post: def.post,
    delete: def.delete,
    options: def.options,
    head: def.head,
    patch: def.patch,
    trace: def.trace,
    connect: def.connect,
  };
  const dispatcher = makeDispatcher(def.params, methods, options, def.meta);
  return Object.assign(dispatcher, { "~routeDef": def, "~options": options });
}

/** HTTP methods exposed in the typed route surface. Protocol methods (head/options/trace/connect) are
 * auto-handled and intentionally excluded from the fetcher type. */
export type FetchableMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * The typed surface of one method, from a caller's perspective:
 * - `body` → schema **input** (the raw payload the caller sends, pre-transform).
 * - `params`/`query`/`headers` → schema **output** (logical values the caller supplies; the fetcher
 *   serializes them to strings and the server coerces back — input would be the useless pre-coerce type).
 * - `response` → schema **output** (what the caller receives).
 */
export interface Endpoint<V extends AnyMethodValidate, P extends SchemaWithJSON | undefined> {
  params: InferRouteParams<P>;
  query: InferMethodQuery<V>;
  headers: InferMethodHeaders<V>;
  body: InferMethodBodyDir<V, "input">;
  response: InferMethodResponse<V>;
}

/** Per-method validate types keyed by method, used to extract each declared method's {@link Endpoint}. */
interface MethodValidates<
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
  get: Get;
  put: Put;
  post: Post;
  delete: Del;
  options: Options;
  head: Head;
  patch: Patch;
  trace: Trace;
  connect: Connect;
}

/**
 * The per-method `{ [declaredMethod]: Endpoint }` map of one route handler. `K` is the declared-method
 * key union (captured via `& Record<K, unknown>`); only methods actually declared *and*
 * {@link FetchableMethod fetchable} appear — no phantom entries.
 */
export type MethodsRecord<
  K extends string,
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
> = {
  [M in FetchableMethod as M extends K ? M : never]: Endpoint<
    MethodValidates<Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>[M],
    P
  >;
};

/**
 * The typed-routes contribution of a single `defineRoute`: `{ [route]: { [declaredMethod]: Endpoint } }`
 * — the route literal keying a {@link MethodsRecord}.
 */
export type RouteRecord<
  R extends string,
  K extends string,
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
> = {
  [Route in R]: MethodsRecord<K, P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>;
};

/**
 * The required runtime brand that nominally marks a value as a typed route plugin. It's a real value
 * (set by `defineRoute`), so constraints like `InferRoutes` reject anything that isn't a route plugin.
 */
export interface RoutePluginBrand {
  readonly "~routePlugin": true;
}

/**
 * The `H3Plugin` returned by `defineRoute`: a real plugin, a required {@link RoutePluginBrand} (so it's
 * nominally a route plugin), and a **type-only** `~inferRoute` stamp carrying the route's typed
 * {@link RouteRecord} contribution — phantom, never present at runtime, read via `InferRoutes`.
 * Composes with `app.register(...)` like any plugin.
 */
export type RoutePlugin<Routes = unknown> = H3Plugin &
  RoutePluginBrand & { readonly "~inferRoute"?: Routes };

/** The handler shape {@link mountRouteHandler} accepts: a route handler carrying its `~routeDef`. */
export type MountableRouteHandler = EventHandlerWithFetch & {
  readonly "~routeDef": DocumentableRouteDef & { middleware?: Middleware[] };
};

/**
 * Mount a built route handler onto an app at `route`. Every declared method is served, and different
 * methods on the same path compose across callers (a repeated method keeps the first). Use it to get
 * `defineRoute`/`H3Typed.route` mounting from a handler you already have:
 * `mountRouteHandler(app, "/users", handler)`.
 */
export function mountRouteHandler(h3: H3, route: string, handler: MountableRouteHandler): void {
  const def = handler["~routeDef"];
  const opts = { middleware: def.middleware, meta: def.meta };
  for (const method of METHOD_KEYS) {
    if (isRuntimeMethod(Reflect.get(def, method))) h3.on(method, route, handler, opts);
  }
  h3.all(route, handler, opts);
}

/**
 * Define a route as a plugin: register it with `app.register(defineRoute({ route, get, post }))`. Set
 * `route` to the path and add one entry per HTTP method; each `handler`'s `event` is typed from that
 * method's `validate` and the route `params`. Methods added to the same path across plugins compose
 * (a repeated method keeps the first). Recover the route types with `InferRoutes`/`InferMethods`.
 *
 * @example
 * app.register(defineRoute({
 *   route: "/users/:id",
 *   params: z.object({ id: z.coerce.number() }),
 *   get: { validate: { response: User }, handler: (e) => getUser(e.context.params.id) },
 * }))
 */
export function defineRoute<
  R extends string,
  K extends string = never,
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
  def: RouteHandlerInput<P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect> & {
    route: R;
  } & Record<K, unknown>,
  options: RouteHandlerOptions = {},
): RoutePlugin<RouteRecord<R, K, P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>> {
  const { route, ...rest } = def;
  const handler = defineRouteHandler(rest, options);
  const brand: RoutePluginBrand = { "~routePlugin": true };
  return Object.assign((h3: H3) => mountRouteHandler(h3, route, handler), brand);
}

function makeDispatcher(
  params: SchemaWithJSON | undefined,
  methods: RuntimeMethods,
  options: RouteHandlerOptions,
  meta: H3RouteMeta | undefined,
): EventHandlerWithFetch {
  return defineHandler({
    meta,
    handler: async (event: H3Event) => {
      const method = event.req.method.toUpperCase();
      let entry = methods[method.toLowerCase()];
      let headRequest = false;

      if (method === "HEAD" && !isRuntimeMethod(entry)) {
        if (entry === false || !isRuntimeMethod(methods.get)) {
          return methodNotAllowed(computeAllow(event, methods));
        }
        entry = methods.get;
        headRequest = true;
      }

      if (method === "OPTIONS" && !isRuntimeMethod(entry)) {
        if (entry === false) return methodNotAllowed(computeAllow(event, methods));
        event.res.headers.set("Allow", computeAllow(event, methods));
        event.res.status = 204;
        return null;
      }

      if (!isRuntimeMethod(entry)) return methodNotAllowed(computeAllow(event, methods));

      const validated = await runRequestValidation(
        event,
        params,
        entry.validate,
        entry.stream,
        options,
      );
      Reflect.set(event, "validated", validated);

      // @ts-expect-error: the event is request-validated at this point; its static type narrows
      // context.params, req.body and `validated` beyond what h3's base H3Event proves here.
      const result = await entry.handler(event);

      const response = await runResponseValidation(
        result,
        entry.validate?.response,
        entry.stream?.response,
        event.res.status,
        options.onError,
      );

      // HEAD: the GET path ran for side effects/headers; the body is omitted.
      return headRequest ? null : response;
    },
  });
}

async function runRequestValidation(
  event: H3Event,
  params: SchemaWithJSON | undefined,
  validate: AnyMethodValidate | undefined,
  stream: MethodStream | undefined,
  options: RouteHandlerOptions,
): Promise<Record<string, unknown>> {
  const onError = options.onError;

  let resolvedParams: unknown;
  if (params) {
    resolvedParams = await validateParams(event, params, { decode: options.decode, onError });
    Reflect.set(event.context, "params", resolvedParams);
  } else {
    resolvedParams = event.context.params ?? {};
  }

  const query = validate?.query
    ? await validateQuery(event, validate.query, { onError })
    : getQuery(event);

  const headers = validate?.headers
    ? await validateHeaders(event, validate.headers, { onError })
    : Object.fromEntries(event.req.headers.entries());

  if (validate?.body || stream?.body) {
    const req = validateBody(
      event.req,
      { body: validate?.body, stream: stream?.body },
      { onError },
    );
    Reflect.set(event, "req", req);
  }

  return { query, params: resolvedParams, headers };
}

function isRuntimeMethod(entry: unknown): entry is RuntimeMethod {
  return typeof entry === "object" && entry !== null;
}

/**
 * Build the `Allow` header: the union of declared methods across every handler on the matched route,
 * plus auto HEAD (when GET is present) and OPTIONS. Falls back to `ownMethods` if the route table is
 * unreachable.
 */
function computeAllow(event: H3Event, ownMethods: RuntimeMethods): string {
  const allowed = new Set<string>();
  const route = event.context.matchedRoute?.route;
  const table = event.app ? Reflect.get(event.app, "~routes") : undefined;
  let harvested = false;

  if (route && Array.isArray(table)) {
    for (const entry of table) {
      if (entry?.route !== route || typeof entry.handler !== "function") continue;
      const def = Reflect.get(entry.handler, "~routeDef");
      if (typeof def !== "object" || def === null) continue;
      harvested = true;
      for (const method of METHOD_KEYS) {
        if (isRuntimeMethod(Reflect.get(def, method))) allowed.add(method.toUpperCase());
      }
    }
  }
  if (!harvested) {
    for (const method of METHOD_KEYS) {
      if (isRuntimeMethod(ownMethods[method])) allowed.add(method.toUpperCase());
    }
  }
  if (allowed.has("GET") && ownMethods.head !== false) allowed.add("HEAD");
  if (ownMethods.options !== false) allowed.add("OPTIONS");
  return [...allowed].join(", ");
}

function methodNotAllowed(allow: string): never {
  throw new HTTPError({ status: 405, statusText: "Method Not Allowed", headers: { Allow: allow } });
}

function runResponseValidation(
  result: unknown,
  response: ResponseValidation | undefined,
  streamResponse: ResponseStreamMap | undefined,
  status: number | undefined,
  onError: OnValidateError | undefined,
): Promise<unknown> | unknown {
  const code = status ?? 200;

  // A status declared under `stream.response` is doc-only — never value-validated.
  if (streamResponse && (streamResponse[code] ?? streamResponse[String(code)])) return result;

  const schema = response ? resolveResponseSchema(response, status) : undefined;
  if (!schema) return result;

  // The status is schema-validated but the handler streamed it — fail loud rather than drift.
  if (isStreamLike(result)) {
    throw new HTTPError({
      status: 500,
      statusText: "Internal Server Error",
      message: `Response for status ${code} is schema-validated, but the handler returned a stream. Declare it under stream.response instead.`,
    });
  }

  return validateResponse(result, schema, { onError: onError ? (r) => onError(r) : undefined });
}

/** A streamed return value that cannot be value-validated: a web stream, a `Response`, or an async iterable. */
function isStreamLike(value: unknown): boolean {
  return (
    value instanceof ReadableStream ||
    value instanceof Response ||
    (typeof value === "object" && value !== null && Symbol.asyncIterator in value)
  );
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
