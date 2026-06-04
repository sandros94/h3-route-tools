export { defineRouteHandler, defineRoute } from "./route-handler.ts";
export type {
  RouteHandler,
  RouteHandlerDef,
  RouteHandlerOptions,
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
} from "./route-handler.ts";

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

export { attachRegistry, getRegistry, addRoute } from "./registry.ts";
export type { OpenAPIRegistry } from "./registry.ts";

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
