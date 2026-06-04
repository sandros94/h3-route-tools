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
  options?: PerMethodDef<Options, P> | false;
  head?: PerMethodDef<Head, P> | false;
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
 * A self-dispatching `EventHandlerWithFetch` returned by `defineRouteHandler`, carrying the typed
 * `~routeDef` (for docs/type extraction) and `~options`. Mount it like any h3 handler.
 */
export type RouteHandler<Def = RouteHandlerDef> = EventHandlerWithFetch & {
  readonly "~routeDef": Def;
  readonly "~options": RouteHandlerOptions;
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
  const allow = computeAllow(methods);
  const dispatcher = makeDispatcher(def.params, methods, allow, options, def.meta);
  return Object.assign(dispatcher, { "~routeDef": def, "~options": options });
}

/**
 * Route-aware sugar over {@link defineRouteHandler}: builds the self-dispatching handler and mounts it
 * at `route` with a single `h3.all`. OpenAPI emission discovers it later by harvesting h3's route table
 * (the handler carries `~routeDef`), so there is no separate registration step. Returns an `H3Plugin`,
 * composes with `app.register(...)`. Shadows h3's single-method `defineRoute` as a multi-method superset
 * (see [[project-positioning-upstream]]).
 *
 * Each method's `handler` receives an `event` typed from its own `validate` schemas + route `params`.
 */
export function defineRoute<
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
    route: string;
  },
  options: RouteHandlerOptions = {},
): H3Plugin {
  const { route, ...rest } = def;
  const handler = defineRouteHandler(rest, options);
  return (h3: H3) => {
    // The handler carries `~routeDef`; OpenAPI emission harvests it from h3's route table on demand,
    // so no explicit registration step is needed.
    h3.all(route, handler, { middleware: def.middleware, meta: def.meta });
  };
}

function makeDispatcher(
  params: SchemaWithJSON | undefined,
  methods: RuntimeMethods,
  allow: string,
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
        if (entry === false || !isRuntimeMethod(methods.get)) return methodNotAllowed(allow);
        entry = methods.get;
        headRequest = true;
      }

      if (method === "OPTIONS" && !isRuntimeMethod(entry)) {
        if (entry === false) return methodNotAllowed(allow);
        event.res.headers.set("Allow", allow);
        event.res.status = 204;
        return null;
      }

      if (!isRuntimeMethod(entry)) return methodNotAllowed(allow);

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

function isRuntimeMethod(entry: RuntimeMethod | false | undefined): entry is RuntimeMethod {
  return typeof entry === "object" && entry !== null;
}

function computeAllow(methods: RuntimeMethods): string {
  const allowed = new Set<string>();
  for (const method of METHOD_KEYS) {
    if (isRuntimeMethod(methods[method])) allowed.add(method.toUpperCase());
  }
  if (allowed.has("GET") && methods.head !== false) allowed.add("HEAD");
  if (methods.options !== false) allowed.add("OPTIONS");
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
