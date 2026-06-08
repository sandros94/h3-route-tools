import type { RoutePlugin } from "./route-handler.ts";

/**
 * Recover the typed-route contribution (`{ [route]: { [method]: Endpoint } }`) stamped on a
 * {@link RoutePlugin} returned by `defineRoute`. The `P extends RoutePlugin` bound rejects anything
 * that isn't a typed route plugin at the call site.
 */
export type InferRouteTypes<P extends RoutePlugin> =
  P extends RoutePlugin<infer Routes> ? Routes : never;

/** Flatten an intersection / mapped type into a plain object type (display only). */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Merge two route maps: different paths/methods compose; a method in both is first-wins (`A`). */
type MergePair<A, B> = {
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

/**
 * Aggregate several `defineRoute` plugins into one `{ [route]: { [method]: Endpoint } }` map — the
 * typed-fetcher substrate. Same path across plugins composes its methods (first-wins on duplicates).
 */
export type InferRoutes<Plugins extends readonly RoutePlugin[]> = Prettify<MergeAll<Plugins>>;
