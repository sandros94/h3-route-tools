import type { H3, H3Plugin } from "h3";

import type { OpenAPIInfo } from "./openapi-types.ts";
import type { ErrorResponsesOption } from "./route-handler.ts";
import { attachRegistry } from "./registry.ts";
import { buildOpenAPIDocument } from "./openapi.ts";

/** Options for the OpenAPI plugin. `info` is required by the OpenAPI spec. */
export interface OpenAPIPluginOptions {
  info: OpenAPIInfo;
  /** Path the document is served from. Defaults to `/openapi.json`. */
  path?: string;
  /** Override or disable auto-registered error responses for every route in the document. */
  errors?: ErrorResponsesOption;
}

/**
 * H3 plugin that attaches an OpenAPI registry to the app and serves the generated document.
 * Register it before the routes whose definitions should appear in the document.
 */
export function defineOpenAPI(options: OpenAPIPluginOptions): H3Plugin {
  if (!options.info?.title || !options.info?.version) {
    throw new TypeError("defineOpenAPI requires `info.title` and `info.version`.");
  }
  const path = options.path ?? "/openapi.json";

  return (h3: H3) => {
    const registry = attachRegistry(h3, { info: options.info });
    h3.get(path, () =>
      buildOpenAPIDocument({
        info: registry.info,
        routes: registry.routes,
        errors: options.errors,
      }),
    );
  };
}
