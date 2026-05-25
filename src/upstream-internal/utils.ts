import type { H3Event, EventHandlerRequest } from "h3";

export type StringHeaders<T> = {
  [K in keyof T]: Extract<T[K], string>;
};

/**
 * @experimental defineValidatedHandler is an experimental feature and API may change.
 */
// Helper type to create a validated H3Event with typed context.params
// After validation, params will have the inferred type from the schema
// Note: params remains optional for TypeScript compatibility, but is guaranteed at runtime
export type ValidatedH3Event<RequestT extends EventHandlerRequest, Params> = Omit<
  H3Event<RequestT>,
  "context"
> & {
  context: Omit<H3Event["context"], "params"> & {
    params?: Params; // Typed from schema (optional for TS, guaranteed after validation)
  };
};
