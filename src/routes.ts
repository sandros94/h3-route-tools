import type { H3 } from "h3";

import {
  type MountableRouteHandler,
  type RouteHandler,
  type RoutePlugin,
  type RoutePluginBrand,
  mountRouteHandler,
} from "./route-handler.ts";
import type { H3Typed } from "./h3-typed.ts";

/**
 * Recover the typed-route contribution (`{ [route]: { [method]: Endpoint } }`) stamped on a
 * {@link RoutePlugin} returned by `defineRoute`. The `P extends RoutePlugin` bound rejects anything
 * that isn't a typed route plugin at the call site.
 */
export type InferRouteTypes<P extends RoutePlugin> =
  P extends RoutePlugin<infer Routes> ? Routes : never;

/** Flatten an intersection / mapped type into a plain object type (display only). */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Merge two route maps: different paths/methods compose; a method in both is first-wins (`A`). */
export type MergePair<A, B> = {
  [P in keyof A | keyof B]: P extends keyof A
    ? P extends keyof B
      ? Prettify<A[P] & Omit<B[P], keyof A[P]>>
      : A[P]
    : P extends keyof B
      ? B[P]
      : never;
};

/** Fold a tuple of route plugins left-to-right (earlier wins). */
type MergeAll<T extends readonly RoutePlugin[]> = T extends readonly [
  infer Head extends RoutePlugin,
  ...infer Tail extends readonly RoutePlugin[],
]
  ? MergePair<InferRouteTypes<Head>, MergeAll<Tail>>
  : {};

/** A route handler carrying its type-only `~inferMethods` stamp — the value type of a {@link RouteMap}. */
export type AnyRouteHandler = MountableRouteHandler & { readonly "~inferMethods"?: unknown };

/**
 * A route map: each route path keys a route-free handler from `defineRouteHandler`. The grouping form
 * module authors can export — `{ "/users/:id": defineRouteHandler({...}), "/posts": ... }`.
 */
export type RouteMap = Record<string, AnyRouteHandler>;

/** Recover a handler's per-method `{ [method]: Endpoint }` map from its `~inferMethods` stamp. */
type HandlerMethods<H> = H extends { readonly "~inferMethods"?: infer M } ? M : never;

/** Aggregate a {@link RouteMap} into `{ [route]: { [method]: Endpoint } }` — keys are already routes. */
export type InferRouteMap<M extends RouteMap> = Prettify<{
  [Route in keyof M & string]: HandlerMethods<M[Route]>;
}>;

/** Everything {@link InferRoutes} can read routes from. The bound rejects non-route values up front. */
export type InferRoutesInput = H3Typed | RoutePlugin | readonly RoutePlugin[] | RouteMap;

/**
 * Aggregate routes into one `{ [route]: { [method]: Endpoint } }` map — the typed-client substrate.
 * Accepts an {@link H3Typed} instance (`InferRoutes<typeof app>`), a single `defineRoute` plugin, a
 * `readonly RoutePlugin[]` tuple (same path composes its methods, first-wins on duplicates), or a
 * {@link RouteMap} object of `defineRouteHandler` handlers.
 */
export type InferRoutes<T extends InferRoutesInput> =
  T extends H3Typed<infer Routes>
    ? Routes
    : T extends readonly RoutePlugin[]
      ? Prettify<MergeAll<T>>
      : T extends RoutePlugin
        ? InferRouteTypes<T>
        : T extends RouteMap
          ? InferRouteMap<T>
          : never;

/**
 * Recover the per-method `{ [method]: Endpoint }` map of a SINGLE route — a `defineRouteHandler`
 * handler (`InferMethods<typeof handler>`) or a single `defineRoute` plugin (its one route's methods).
 */
export type InferMethods<T extends AnyRouteHandler | RoutePlugin> =
  T extends RouteHandler<infer _Def, infer Methods>
    ? Methods
    : T extends RoutePlugin<infer Routes>
      ? Routes[keyof Routes]
      : never;

/**
 * Mount a {@link RouteMap} as a single plugin: register it with `app.register(mountRoutes({ ... }))`.
 * Each entry's path is the map key; the handler serves its declared methods, and methods on a shared
 * path compose with other plugins (a repeated method keeps the first). The plugin carries the map's
 * aggregated route types, so `app.register(...)` accumulates them and `InferRoutes` can read them.
 *
 * @example
 * app.register(mountRoutes({
 *   "/users/:id": defineRouteHandler({ get: { validate: { response: User }, handler } }),
 *   "/posts": defineRouteHandler({ get: { handler: listPosts } }),
 * }))
 */
export function mountRoutes<M extends RouteMap>(map: M): RoutePlugin<InferRouteMap<M>> {
  const brand: RoutePluginBrand = { "~routePlugin": true };
  return Object.assign((h3: H3) => {
    for (const [route, handler] of Object.entries(map)) {
      mountRouteHandler(h3, route, handler);
    }
  }, brand);
}
