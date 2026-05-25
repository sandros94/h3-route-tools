import type { H3, H3Plugin, Middleware, H3RouteMeta, HTTPMethod, EventHandlerRequest } from "h3";

import type {
  StandardSchemaV1,
  OnValidateError,
  InferOutput,
} from "./upstream-internal/validate.ts";
import type { StringHeaders, ValidatedH3Event } from "./upstream-internal/utils.ts";

import { defineValidatedHandler } from "./handler.ts";

/**
 * Route validation schemas
 */
export interface RouteValidation {
  body?: StandardSchemaV1;
  headers?: StandardSchemaV1;
  query?: StandardSchemaV1;
  params?: StandardSchemaV1;
  response?: StandardSchemaV1;
  onError?: OnValidateError;
}

type RouteValidationConfig<V extends RouteValidation> = Omit<V, "onError"> & {
  onError?: OnValidateError;
};

type RouteEventRequest<V extends RouteValidation> = EventHandlerRequest & {
  body: NonNullable<V["body"]> extends StandardSchemaV1
    ? InferOutput<NonNullable<V["body"]>>
    : unknown;
  query: NonNullable<V["query"]> extends StandardSchemaV1
    ? StringHeaders<InferOutput<NonNullable<V["query"]>>>
    : Partial<Record<string, string>>;
  routerParams: NonNullable<V["params"]> extends StandardSchemaV1
    ? InferOutput<NonNullable<V["params"]>>
    : Record<string, string>;
};

type RouteEventParams<V extends RouteValidation> =
  NonNullable<V["params"]> extends StandardSchemaV1
    ? InferOutput<NonNullable<V["params"]>>
    : Record<string, string>;

type RouteResponse<V extends RouteValidation> =
  NonNullable<V["response"]> extends StandardSchemaV1
    ? InferOutput<NonNullable<V["response"]>>
    : unknown;

interface RouteMethodDefinition<V extends RouteValidation = RouteValidation> {
  /**
   * Handler function for the route.
   */
  handler: (
    event: ValidatedH3Event<RouteEventRequest<V>, RouteEventParams<V>>,
  ) => RouteResponse<V> | Promise<RouteResponse<V>>;

  /**
   * Validation schemas for request and response
   */
  validate?: RouteValidationConfig<V>;
}

type RouteDefinition = {
  [method in HTTPMethod]: RouteMethodDefinition;
} & {
  /**
   * Route pattern, e.g. '/api/users/:id'
   */
  route: string;

  /**
   * Shared middleware for all methods on this route.
   * Method-specific middleware can also be defined in each method's handler.
   */
  middleware?: Middleware[];

  /**
   * Shared metadata for all methods on this route, shallowly merged.
   * Method-specific metadata will override shared metadata if there are conflicts.
   */
  meta?: H3RouteMeta;
};

export function defineRoute(def: RouteDefinition): H3Plugin {
  const { route, middleware = [], meta = {}, ..._methods } = def;

  return (h3: H3) => {
    for (const method in _methods) {
      const def = _methods[method as HTTPMethod];
      h3.on(method as HTTPMethod, route, defineValidatedHandler(def), { meta, middleware });
    }
  };
}
