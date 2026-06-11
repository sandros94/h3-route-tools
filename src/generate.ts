import type { H3 } from "h3";

import { getOpenAPIConfig, harvestRoutes } from "./registry.ts";
import { buildOpenAPIDocument, type OpenAPIDocument } from "./openapi.ts";

/**
 * Build the OpenAPI document from a configured app — its stamped `info`/`errors` plus its harvested
 * routes. Pure (no I/O); `JSON.stringify` the result to emit a static file.
 *
 * @returns the document, or `undefined` if the app has no OpenAPI config.
 *
 * @example
 * const doc = getOpenAPIDocument(app)
 */
export function getOpenAPIDocument(app: H3): OpenAPIDocument | undefined {
  const config = getOpenAPIConfig(app);
  if (!config) return undefined;
  return buildOpenAPIDocument({
    info: config.info,
    routes: harvestRoutes(app),
    errors: config.errors,
  });
}
