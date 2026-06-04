import type { H3 } from "h3";

import type { OpenAPIInfo, RegisteredRoute } from "./openapi.ts";

export type { RegisteredRoute } from "./openapi.ts";

/**
 * Accumulation state for OpenAPI emission, attached to an `H3` instance.
 * Collects raw route bindings; the document is derived on demand via `buildOpenAPIDocument`,
 * so runtime and static (build-time) emission share one conversion path.
 */
export interface OpenAPIRegistry {
  readonly info: OpenAPIInfo;
  readonly routes: RegisteredRoute[];
}

const registries = new WeakMap<H3, OpenAPIRegistry>();

/** Create an empty registry for the given info, attach it to the `H3` instance, and return it. */
export function attachRegistry(h3: H3, options: { info: OpenAPIInfo }): OpenAPIRegistry {
  const registry: OpenAPIRegistry = { info: options.info, routes: [] };
  registries.set(h3, registry);
  return registry;
}

/** Read the registry attached to an `H3` instance, or `undefined` if none is present. */
export function getRegistry(h3: H3): OpenAPIRegistry | undefined {
  return registries.get(h3);
}

/** Append a route binding to a registry. */
export function addRoute(registry: OpenAPIRegistry, route: RegisteredRoute): void {
  registry.routes.push(route);
}
