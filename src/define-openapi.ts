import type { H3, H3Plugin } from "h3";

import type { ErrorResponsesOption } from "./route-handler.ts";
import { attachRegistry, harvestRoutes } from "./registry.ts";
import { buildOpenAPIDocument, type OpenAPIInfo } from "./openapi.ts";

/** Options for the OpenAPI plugin. `info` is required by the OpenAPI spec. */
export interface OpenAPIPluginOptions {
  info: OpenAPIInfo;
  /** Path the document is served from. Defaults to `/openapi.json`. */
  path?: string;
  /** Override or disable auto-registered error responses for every route in the document. */
  errors?: ErrorResponsesOption;
}

/**
 * H3 plugin that records the OpenAPI config on the app and serves the generated document.
 * The document is built per request by harvesting the app's routes, so it reflects every route
 * regardless of registration order.
 */
export function defineOpenAPI(options: OpenAPIPluginOptions): H3Plugin {
  if (!options.info?.title || !options.info?.version) {
    throw new TypeError("defineOpenAPI requires `info.title` and `info.version`.");
  }
  const path = options.path ?? "/openapi.json";

  return (h3: H3) => {
    attachRegistry(h3, { info: options.info, path, errors: options.errors });

    h3.get(path, () =>
      buildOpenAPIDocument({
        info: options.info,
        routes: harvestRoutes(h3),
        errors: options.errors,
      })
    );
  };
}
