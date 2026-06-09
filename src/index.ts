export { defineRouteHandler, defineRoute, mountRouteHandler } from "./route-handler.ts";
export type {
  RouteHandler,
  RouteHandlerDef,
  RouteHandlerOptions,
  MountableRouteHandler,
  MethodValidate,
  MethodStream,
  ResponseValidation,
  ResponseStreamMap,
  ErrorResponsesOption,
  DocumentableRouteHandler,
  DocumentableRouteDef,
  DocumentableMethodDef,
  RouteMethod,
  StatusCodeKey,
  RoutePlugin,
  RouteRecord,
  Endpoint,
  FetchableMethod,
} from "./route-handler.ts";

export { H3Typed } from "./h3-typed.ts";
export type { H3TypedConfig, H3Routes } from "./h3-typed.ts";

export type { InferRouteTypes, InferRoutes } from "./routes.ts";

export { defineSchema } from "./define-schema.ts";

export { defineOpenAPI } from "./define-openapi.ts";
export type { OpenAPIPluginOptions } from "./define-openapi.ts";
export { buildOpenAPIDocument } from "./openapi.ts";
export type {
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIOperation,
  OpenAPIPathItem,
  OpenAPIParameter,
  OpenAPIMediaType,
  OpenAPIRequestBody,
  OpenAPIResponse,
  OpenAPIComponents,
  OpenAPIVersion,
  RegisteredRoute,
} from "./openapi.ts";

export { attachRegistry, getRegistry, getOpenAPIConfig, harvestRoutes } from "./registry.ts";
export type { OpenAPIRegistry, OpenAPIConfig } from "./registry.ts";

export {
  HTTPErrorSchema,
  ValidationErrorSchema,
  UnsupportedMediaTypeSchema,
} from "./error-schemas.ts";

export type {
  SchemaWithJSON,
  BodyValidation,
  MediaTypeMap,
  StreamDoc,
  StreamMap,
  JSONSchemaDocument,
  ValidateOptions,
  OnValidateError,
  InferInput,
  InferOutput,
  HTTPErrorPayload,
  ValidationErrorData,
  ValidationErrorPayload,
  UnsupportedMediaTypeData,
  UnsupportedMediaTypePayload,
} from "./internal/types.ts";
