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

/** Options for {@link writeOpenAPIDocument}. */
export interface WriteOpenAPIOptions {
  /** JSON indentation. Default `2`; pass `0` to minify. */
  indent?: number;
}

/**
 * Build {@link getOpenAPIDocument} and write it to `path`, returning the document.
 *
 * @throws {TypeError} if the app has no OpenAPI config.
 *
 * @example
 * import { app } from "../server"
 * await writeOpenAPIDocument(app, "openapi.json")
 */
export async function writeOpenAPIDocument(
  app: H3,
  path: string,
  options: WriteOpenAPIOptions = {},
): Promise<OpenAPIDocument> {
  const doc = getOpenAPIDocument(app);
  if (!doc) {
    throw new TypeError(
      "writeOpenAPIDocument: app has no OpenAPI config — call defineOpenAPI or pass `openapi` to H3Typed.",
    );
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, JSON.stringify(doc, null, options.indent ?? 2));
  return doc;
}
