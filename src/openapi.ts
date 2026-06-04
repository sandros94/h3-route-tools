import type {
  BodyValidation,
  ComponentsRegistry,
  JSONSchemaDocument,
  RouteMethod,
  SchemaWithJSON,
  StandardJSONSchemaV1,
  StandardTypedV1,
  StatusCodeKey,
  StreamDoc,
  StreamMap,
} from "./internal/types.ts";
import {
  type DocumentableMethodDef,
  type DocumentableRouteHandler,
  type ErrorResponsesOption,
  METHOD_KEYS,
  type ResponseValidation,
} from "./route-handler.ts";
import { getStandardJSONSchema } from "./internal/schema.ts";
import { extractComponents } from "./internal/extract-components.ts";
import {
  HTTPErrorSchema,
  UnsupportedMediaTypeSchema,
  ValidationErrorSchema,
} from "./error-schemas.ts";

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

/** A route binding collected for documentation: its path plus the route handler that serves it. */
export interface RegisteredRoute {
  route: string;
  handler: DocumentableRouteHandler;
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  500: "Internal Server Error",
};

/** Convert an h3 route pattern to an OpenAPI templated path (`:id` / `**:rest` → `{id}` / `{rest}`). */
export function toOpenAPIPath(route: string): string {
  return route.replace(/\*\*:(\w+)/g, "{$1}").replace(/:(\w+)/g, "{$1}");
}

/**
 * Decompose an object schema into OpenAPI parameters, one per property.
 * Non-object schemas (or schemas without an extractable JSON Schema) yield no parameters.
 * Path parameters are always required; query/header use the schema's `required` list.
 */
export function schemaToParameters(
  schema: SchemaWithJSON,
  options: { in: "query" | "header" | "path" },
): OpenAPIParameter[] {
  const json = getStandardJSONSchema(schema);
  const properties = asRecord(json?.["properties"]);
  if (!properties) return [];
  const required = new Set(asStringArray(json?.["required"]));
  return Object.entries(properties).map(([name, propSchema]) => ({
    name,
    in: options.in,
    required: options.in === "path" ? true : required.has(name),
    schema: asRecord(propSchema) ?? {},
  }));
}

/** Convert one method definition to an OpenAPI Operation Object. */
export function toOpenAPIOperation(
  method: DocumentableMethodDef,
  options: { hasRouteParams?: boolean; errors?: ErrorResponsesOption } = {},
): OpenAPIOperation {
  const validate = method.validate;
  const body: BodyValidation | undefined = validate?.body;
  const stream: StreamMap | undefined = validate?.stream;
  const query: SchemaWithJSON | undefined = validate?.query;
  const headers: SchemaWithJSON | undefined = validate?.headers;
  const response: ResponseValidation | undefined = validate?.response;

  const operation: OpenAPIOperation = {};

  const parameters: OpenAPIParameter[] = [];
  if (query) parameters.push(...schemaToParameters(query, { in: "query" }));
  if (headers) parameters.push(...schemaToParameters(headers, { in: "header" }));
  if (parameters.length) operation.parameters = parameters;

  if (body || stream) operation.requestBody = toRequestBody(body, stream);

  const autoErrors = computeAutoErrors({
    body,
    stream,
    headers,
    query,
    response,
    hasRouteParams: options.hasRouteParams ?? false,
    errors: options.errors,
  });
  const responses = toResponses(response, autoErrors);
  if (Object.keys(responses).length) operation.responses = responses;

  applyOperationMeta(operation, method.meta);
  return operation;
}

/** Convert a documentable route handler to an OpenAPI Path Item Object. */
export function toOpenAPIPathItem(
  handler: DocumentableRouteHandler,
  options: { errors?: ErrorResponsesOption } = {},
): OpenAPIPathItem {
  const def = handler["~routeDef"];
  const errors = handler["~options"]?.errors ?? options.errors;
  const hasRouteParams = !!def.params;

  const pathItem: OpenAPIPathItem = {};
  if (def.params) {
    const params = schemaToParameters(def.params, { in: "path" });
    if (params.length) pathItem.parameters = params;
  }

  for (const method of METHOD_KEYS) {
    const methodDef = def[method];
    if (!methodDef) continue;
    pathItem[method] = toOpenAPIOperation(methodDef, { hasRouteParams, errors });
  }

  return pathItem;
}

/**
 * Build a complete OpenAPI 3.1 document from a set of route bindings.
 * Pure — requires no `H3` instance, so the same builder serves runtime emission and static builds.
 */
export function buildOpenAPIDocument(options: {
  info: OpenAPIInfo;
  routes: RegisteredRoute[];
  errors?: ErrorResponsesOption;
}): OpenAPIDocument {
  const paths: Record<string, OpenAPIPathItem> = {};
  for (const { route, handler } of options.routes) {
    const key = toOpenAPIPath(route);
    const pathItem = toOpenAPIPathItem(handler, { errors: options.errors });
    paths[key] = paths[key] ? mergePathItem(paths[key]!, pathItem) : pathItem;
  }

  const { components } = extractDocumentComponents(paths);
  const doc: OpenAPIDocument = { openapi: "3.1.0", info: options.info, paths };
  if (Object.keys(components).length) doc.components = { schemas: components };
  return doc;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toRequestBody(
  body: BodyValidation | undefined,
  stream: StreamMap | undefined,
): OpenAPIRequestBody {
  const content: Record<string, OpenAPIMediaType> = {};
  if (body) {
    if (isStandardSchema(body)) {
      content["application/json"] = toMediaType(body);
    } else {
      for (const [mediaType, schema] of Object.entries(body)) {
        content[mediaType] = toMediaType(schema);
      }
    }
  }
  if (stream) {
    for (const [mediaType, doc] of Object.entries(stream)) {
      content[mediaType] = streamMediaType(doc);
    }
  }
  return { required: true, content };
}

/**
 * A streamed content type is documented by its {@link StreamDoc}; `true` emits an empty media-type
 * object — the content-type key already identifies the payload, and OpenAPI 3.1 has no `format: "binary"`.
 */
function streamMediaType(doc: StreamDoc): OpenAPIMediaType {
  if (doc === true) return {};
  return isDocSchema(doc) ? toMediaType(doc) : { schema: doc };
}

function isStandardSchema(value: object): value is SchemaWithJSON {
  return "~standard" in value;
}

function isDocSchema(doc: StandardJSONSchemaV1 | JSONSchemaDocument): doc is StandardJSONSchemaV1 {
  return "~standard" in doc;
}

function toResponses(
  response: ResponseValidation | undefined,
  autoErrors: Array<[string, StandardTypedV1]>,
): Record<string, OpenAPIResponse> {
  const responses: Record<string, OpenAPIResponse> = {};

  if (response) {
    if (isSchema(response)) {
      responses["200"] = toResponseObject("200", response);
    } else {
      for (const [code, schema] of Object.entries(response)) {
        responses[code] = toResponseObject(code, schema);
      }
    }
  }

  for (const [code, schema] of autoErrors) {
    if (!(code in responses)) responses[code] = toResponseObject(code, schema);
  }

  return responses;
}

function toResponseObject(code: StatusCodeKey, schema: StandardTypedV1): OpenAPIResponse {
  return {
    description: describeStatus(code),
    content: { "application/json": toMediaType(schema) },
  };
}

function toMediaType(schema: StandardTypedV1): OpenAPIMediaType {
  const json = getStandardJSONSchema(schema);
  return json ? { schema: json } : {};
}

function computeAutoErrors(input: {
  body: BodyValidation | undefined;
  stream: StreamMap | undefined;
  headers: SchemaWithJSON | undefined;
  query: SchemaWithJSON | undefined;
  response: ResponseValidation | undefined;
  hasRouteParams: boolean;
  errors: ErrorResponsesOption | undefined;
}): Array<[string, StandardTypedV1]> {
  if (input.errors === false) return [];
  const overrides = input.errors;
  const out: Array<[string, StandardTypedV1]> = [];

  const needs400 = input.hasRouteParams || !!input.body || !!input.headers || !!input.query;
  const needs415 = (!!input.body && !isSchema(input.body)) || !!input.stream;
  const needs500 = !!input.response;

  if (needs400) out.push(["400", overrides?.[400] ?? ValidationErrorSchema]);
  if (needs415) out.push(["415", overrides?.[415] ?? UnsupportedMediaTypeSchema]);
  if (needs500) out.push(["500", overrides?.[500] ?? HTTPErrorSchema]);

  return out;
}

function applyOperationMeta(operation: OpenAPIOperation, meta: unknown): void {
  const metaRecord = asRecord(meta);
  const oapi = asRecord(metaRecord?.["openapi"]);
  if (!oapi) return;
  if (typeof oapi["summary"] === "string") operation.summary = oapi["summary"];
  if (typeof oapi["description"] === "string") operation.description = oapi["description"];
  if (typeof oapi["operationId"] === "string") operation.operationId = oapi["operationId"];
  const tags = asStringArray(oapi["tags"]);
  if (tags.length) operation.tags = tags;
}

/** Walk every schema slot in the paths object, lifting `$id` subschemas into a shared components map. */
function extractDocumentComponents(paths: Record<string, OpenAPIPathItem>): {
  components: ComponentsRegistry;
} {
  let components: ComponentsRegistry = {};
  const ref = (schema: JSONSchemaDocument | undefined): JSONSchemaDocument | undefined => {
    if (!schema) return schema;
    const result = extractComponents(schema, { components });
    components = result.components;
    return result.schema;
  };
  const refParams = (params: OpenAPIParameter[] | undefined): void => {
    params?.forEach((p) => {
      p.schema = ref(p.schema);
    });
  };
  const refContent = (content: Record<string, OpenAPIMediaType> | undefined): void => {
    if (!content) return;
    for (const mediaType of Object.values(content)) {
      mediaType.schema = ref(mediaType.schema);
    }
  };

  for (const pathItem of Object.values(paths)) {
    refParams(pathItem.parameters);
    for (const method of METHOD_KEYS) {
      const operation = pathItem[method];
      if (!operation) continue;
      refParams(operation.parameters);
      refContent(operation.requestBody?.content);
      if (operation.responses) {
        for (const res of Object.values(operation.responses)) refContent(res.content);
      }
    }
  }

  return { components };
}

function mergePathItem(a: OpenAPIPathItem, b: OpenAPIPathItem): OpenAPIPathItem {
  const merged: OpenAPIPathItem = { ...a, ...b };
  const params = [...(a.parameters ?? []), ...(b.parameters ?? [])];
  if (params.length) merged.parameters = params;
  return merged;
}

function describeStatus(code: StatusCodeKey): string {
  const n = typeof code === "number" ? code : Number(code);
  return STATUS_TEXT[n] ?? "Response";
}

function isSchema(value: BodyValidation | ResponseValidation): value is SchemaWithJSON {
  return typeof value === "object" && value !== null && "~standard" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
