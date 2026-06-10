import type { InferRoutes, InferRoutesInput } from "./routes.ts";
import type { Prettify } from "./internal/types.ts";

/** A `Response` whose `json()` resolves to the typed body `T`; everything else is the native `Response`. */
export interface TypedResponse<T> extends Omit<Response, "json" | "clone"> {
  json(): Promise<T>;
  clone(): TypedResponse<T>;
}

/**
 * Resolve a route source to its `{ [route]: { [method]: Endpoint } }` map: anything {@link InferRoutes}
 * reads is resolved; an already-resolved map (e.g. a code-generated routes type) passes through.
 */
export type NormalizeRoutes<Source> = Source extends InferRoutesInput
  ? InferRoutes<Source>
  : Source;

// ─── option shape ───────────────────────────────────────────────────────────

/** The response type an endpoint answers with. */
type ResponseOf<E> = E extends { response: infer R } ? R : unknown;

type Lower<M> = Lowercase<M & string>;
/** A route's declared (lowercase) methods plus their uppercase spellings — both are accepted. */
type MethodInput<Methods> = (keyof Methods & string) | Uppercase<keyof Methods & string>;
/** The endpoint for method `M`, looked up by the lowercase key. */
type EndpointFor<Methods, M> = Methods[Lower<M> & keyof Methods];

/** `params` is required when the route has named params (`{ id }`), optional for the open default. */
type ParamsOption<E> = E extends { params: infer P }
  ? [keyof P] extends [never]
    ? { params?: P }
    : string extends keyof P
      ? { params?: P }
      : { params: P }
  : {};

type BodyOption<E> = E extends { body: infer B } ? (unknown extends B ? {} : { body: B }) : {};

/** The chosen `method` plus the endpoint's typed params/query/headers/body. */
type EndpointOptions<E, M> = Prettify<
  { method: M } & ParamsOption<E> &
    BodyOption<E> & {
      query?: E extends { query: infer Q } ? Q : never;
      headers?: E extends { headers: infer H } ? H : never;
    }
>;

/** Any key on `O` absent from `Expected` becomes `never` → excess properties error. */
type NoExcess<O, Expected> = { [K in Exclude<keyof O, keyof Expected>]: never };

/* The leading `O &` is required: it anchors method inference so `O["method"]` resolves and the
   response narrows (drop it and the response collapses to the method union). */
type ExactOptions<O, E, M> = O & EndpointOptions<E, M> & NoExcess<O, EndpointOptions<E, M>>;

// ─── the typed fetch ──────────────────────────────────────────────────────────

/**
 * A `$fetch`-style typed fetch over a route `Source` — an `H3Typed` app (`TypedFetch<typeof app>`) or
 * a code-generated routes type. Address a route by its pattern with the typed `method`/`params`/
 * `query`/`body`; `method` is case-insensitive and undeclared keys (e.g. a `body` on `GET`) error.
 *
 * @example
 * const api: TypedFetch<typeof app> = createTypedFetch({ baseURL })
 * const res = await api("/posts/:id", { method: "post", params: { id: 1 }, body: { title } })
 * const created = await res.json()
 */
export type TypedFetch<Source, R = NormalizeRoutes<Source>> = <
  Route extends keyof R & string,
  const O extends { method: MethodInput<R[Route]> },
>(
  route: Route,
  options: ExactOptions<O, EndpointFor<R[Route], O["method"]>, O["method"]>,
) => Promise<TypedResponse<ResponseOf<EndpointFor<R[Route], O["method"]>>>>;

// ─── runtime ──────────────────────────────────────────────────────────────────

/** Loose runtime view of the call options the typed signature narrows. */
interface RuntimeOptions {
  method: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A fetch-compatible transport: the global `fetch`, or an `H3Typed` app's `request`, etc. */
export type FetchLike = (input: string, init?: RequestInit) => Response | Promise<Response>;

/** Options for {@link createTypedFetch}. */
export interface CreateTypedFetchOptions {
  /** Prefixed to every request path (e.g. `https://api.example.com`). Default `""`. */
  baseURL?: string;
  /** The underlying transport. Default `globalThis.fetch`; pass `app.request` to hit an app directly. */
  fetch?: FetchLike;
  /** Headers merged into every request (per-call `headers` win). */
  headers?: HeadersInit;
}

/**
 * Build a {@link TypedFetch} over a route `Source` (an `H3Typed` app type or a code-generated routes
 * type). Substitutes `params` into the route pattern, appends `query`, JSON-encodes `body`, upcases
 * the method, and returns the transport's `Response` typed as a {@link TypedResponse}.
 *
 * @example
 * const api = createTypedFetch<typeof app>({ baseURL: "/api" })
 * const res = await api("/posts/:id", { method: "post", params: { id: 1 }, body: { title } })
 */
export function createTypedFetch<Source>(
  options: CreateTypedFetchOptions = {},
): TypedFetch<Source> {
  const { baseURL = "", fetch: transport = globalThis.fetch, headers: baseHeaders } = options;

  const run = async (route: string, opts: RuntimeOptions): Promise<Response> => {
    let path = route;
    if (opts.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        const encoded = encodeURIComponent(String(value));
        path = path.replace(`**:${key}`, encoded).replace(`:${key}`, encoded);
      }
    }

    let url = baseURL + path;
    if (opts.query) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) search.set(key, String(value));
      }
      const qs = search.toString();
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }

    const headers = new Headers(baseHeaders);
    if (opts.headers) {
      for (const [key, value] of Object.entries(opts.headers)) headers.set(key, value);
    }
    const init: RequestInit = { method: opts.method.toUpperCase(), headers };
    if (opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }

    return transport(url, init);
  };

  // The dynamic impl can't be statically proven against the precise generic — the one boundary cast.
  return run as TypedFetch<Source>;
}
