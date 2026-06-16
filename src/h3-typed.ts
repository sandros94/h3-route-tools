import { type H3Config, type H3Plugin, H3 } from "h3";

import {
  type AnyMethodValidate,
  type MethodValidate,
  type RouteHandlerInput,
  type ResponseRecord,
  type RouteHandlerOptions,
  type RouteRecord,
  type RoutePlugin,
  defineRouteHandler,
  mountRouteHandler,
} from "./route-handler.ts";
import type { OnValidationError, SchemaWithJSON } from "./internal/types.ts";
import type { InferRouteTypes, MergePair } from "./routes.ts";
import type { Prettify } from "./internal/types.ts";
import { defineOpenAPI, type OpenAPIPluginOptions } from "./define-openapi.ts";

/** {@link H3} config plus an optional `openapi` block that serves the generated document. */
export interface H3TypedConfig extends H3Config {
  openapi?: OpenAPIPluginOptions;
  /**
   * Default validation-error hook for every route added via `.route()`; a route's or method's own
   * `onError` overrides it. Named apart from h3's catch-all `onError` (which it leaves untouched).
   */
  onValidationError?: OnValidationError;
}

/**
 * An {@link H3} app that remembers the routes you add. Build it fluently with `.route(def)` and
 * `.register(plugin)`; `InferRoutes<typeof app>` then gives the full `{ [route]: { [method]: Endpoint } }`
 * map for a typed client.
 *
 * @example
 * const app = new H3Typed({ openapi: { info: { title: "API", version: "1.0.0" } } })
 *   .route({ route: "/users/:id", get: { validate: { response: User }, handler } })
 *   .register(postsPlugin);
 *
 * type Routes = InferRoutes<typeof app>;
 */
export class H3Typed<Routes = {}> extends H3 {
  readonly #onValidationError?: OnValidationError;

  /**
   * Create the app. Accepts every {@link H3} option, plus `openapi` — when set, the OpenAPI document
   * is generated from the app's routes and served (default path `/openapi.json`) — and
   * `onValidationError`, a default validation-error hook for every route added via `.route()`.
   */
  constructor(config: H3TypedConfig = {}) {
    const { openapi, onValidationError, ...h3Config } = config;
    super(h3Config);
    this.#onValidationError = onValidationError;
    if (openapi) this.register(defineOpenAPI(openapi));
  }

  /**
   * Register an h3 plugin and return the app for chaining. A {@link RoutePlugin} (from `defineRoute`)
   * also records its routes in the app's type, so `H3Routes<typeof app>` includes them — the same as
   * adding them with `.route()`. Any other `H3Plugin` behaves as in base h3.
   *
   * @example app.register(defineRoute({ route: "/health", get: { handler: () => "ok" } }))
   */
  override register<P extends RoutePlugin>(
    plugin: P,
  ): H3Typed<Prettify<MergePair<Routes, InferRouteTypes<P>>>>;
  override register(plugin: H3Plugin): this;
  override register(plugin: H3Plugin): this {
    super.register(plugin);
    return this;
  }

  /**
   * Define and mount a route, returning the app for chaining. Pass the route path plus one entry per
   * HTTP method; each `handler`'s `event` is typed from that method's `validate` and the route
   * `params`. Different methods added to the same path (here or via `.register`) compose; a repeated
   * method keeps the first. The route is recorded in the app's type for `InferRoutes<typeof app>`.
   *
   * @example
   * app.route({
   *   route: "/users/:id",
   *   params: z.object({ id: z.coerce.number() }),
   *   get: { validate: { response: User }, handler: (e) => getUser(e.context.params.id) },
   * })
   */
  route<
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
    const RR extends ResponseRecord<Get, Put, Post, Del, Options, Head, Patch, Trace, Connect> =
      ResponseRecord<Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>,
  >(
    def: RouteHandlerInput<P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect, RR> & {
      route: R;
    } & Record<K, unknown>,
    options: RouteHandlerOptions = {},
  ): H3Typed<
    Prettify<
      MergePair<
        Routes,
        RouteRecord<R, K, P, Get, Put, Post, Del, Options, Head, Patch, Trace, Connect>
      >
    >
  > {
    const { route, ...rest } = def;
    const handler = defineRouteHandler(
      { ...rest, onValidationError: rest.onValidationError ?? this.#onValidationError },
      options,
    );
    mountRouteHandler(this, route, handler);
    return this;
  }
}
