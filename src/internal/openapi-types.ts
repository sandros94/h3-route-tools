import type {
  ComponentsRegistry,
  JSONSchemaDocument,
  RouteMethod,
  StatusCodeKey,
} from "./types.ts";

/** The OpenAPI version this library emits. */
export type OpenAPIVersion = "3.1.0";

/** OpenAPI Info Object. `title` and `version` are required by the spec. */
export interface OpenAPIInfo {
  title: string;
  version: string;
  summary?: string;
  description?: string;
  termsOfService?: string;
  contact?: { name?: string; url?: string; email?: string };
  license?: { name: string; identifier?: string; url?: string };
}

/** OpenAPI Parameter Object (path / query / header / cookie). */
export interface OpenAPIParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JSONSchemaDocument;
}

/** OpenAPI Media Type Object. */
export interface OpenAPIMediaType {
  schema?: JSONSchemaDocument;
}

/** OpenAPI Request Body Object. */
export interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, OpenAPIMediaType>;
}

/** OpenAPI Response Object. `description` is required by the spec. */
export interface OpenAPIResponse {
  description: string;
  content?: Record<string, OpenAPIMediaType>;
}

/** OpenAPI Operation Object — a single method on a path. */
export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses?: Record<StatusCodeKey, OpenAPIResponse>;
}

/** OpenAPI Path Item Object — operations keyed by method, plus shared path-level parameters. */
export type OpenAPIPathItem = {
  [M in RouteMethod]?: OpenAPIOperation;
} & {
  summary?: string;
  description?: string;
  parameters?: OpenAPIParameter[];
};

/** OpenAPI Components Object. `schemas` reuses the shared `$ref`-able registry shape. */
export interface OpenAPIComponents {
  schemas?: ComponentsRegistry;
}

/** A complete OpenAPI 3.1 document. */
export interface OpenAPIDocument {
  openapi: OpenAPIVersion;
  info: OpenAPIInfo;
  paths: Record<string, OpenAPIPathItem>;
  components?: OpenAPIComponents;
}
