import type { ErrorDetails, H3Event, EventHandlerRequest } from "h3";
import type {
  StandardSchemaV1,
  StandardJSONSchemaV1,
  StandardTypedV1,
} from "@standard-schema/spec";

export type { StandardSchemaV1, StandardJSONSchemaV1, StandardTypedV1 };

export type InferInput<Schema extends StandardTypedV1> = StandardSchemaV1.InferInput<Schema>;
export type InferOutput<Schema extends StandardTypedV1> = StandardSchemaV1.InferOutput<Schema>;
export type FailureResult = StandardSchemaV1.FailureResult;
export type Issue = StandardSchemaV1.Issue;
export type ValidateIssues = ReadonlyArray<Issue>;

/**
 * A schema that validates and may additionally produce JSON Schema for OpenAPI emission.
 * `StandardSchemaV1 & StandardJSONSchemaV1` schemas opt-in to docs; pure `StandardSchemaV1` skip emission.
 */
export type SchemaWithJSON<Input = unknown, Output = Input> =
  | StandardSchemaV1<Input, Output>
  | (StandardSchemaV1<Input, Output> & StandardJSONSchemaV1<Input, Output>);

/**
 * A map of `Content-Type` → schema. Used for content-type-aware body validation.
 * Keys are normalized media types (e.g. `application/json`, `multipart/form-data`).
 */
export type MediaTypeMap<S extends SchemaWithJSON = SchemaWithJSON> = {
  [mediaType: string]: S;
};

/**
 * Body validation accepts three shapes:
 * - `undefined`: no validation, full pass-through (preserves `defineHandler` migration ergonomics)
 * - `SchemaWithJSON`: bare schema, bound to `application/json` only; other content types pass through
 * - `MediaTypeMap`: strict — only declared content types accepted, 415 on mismatch
 */
export type BodyValidation = SchemaWithJSON | MediaTypeMap;

/** Result of a custom validate function. */
export type ValidateResult<T> = T | true | false | void;

/** A standard-schema or a free-form validate function. */
export type ValidateFunction<T, Schema extends StandardSchemaV1 = StandardSchemaV1<any, T>> =
  | Schema
  | ((data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>);

/** Hook that transforms a validation failure into `ErrorDetails` for the thrown `HTTPError`. */
export type OnValidateError<Source extends string = string> = (
  result: FailureResult & { _source?: Source },
) => ErrorDetails;

/**
 * Common options for every validator function.
 * `Source` parameterizes the `_source` tag passed to `onError` (e.g. `"response"`).
 */
export interface ValidateOptions<Source extends string = string> {
  onError?: OnValidateError<Source>;
}

/** Options for `getStandardJSONSchema`. */
export interface GetJSONSchemaOptions {
  direction?: "input" | "output";
  target?: StandardJSONSchemaV1.Target;
}

/** Canonical `data` payload attached to `HTTPError`s raised by validation failure. */
export interface ValidationErrorData {
  issues?: ValidateIssues;
  message?: string;
}

/** Canonical `data` payload attached to a 415 `HTTPError`. */
export interface UnsupportedMediaTypeData {
  received: string | null;
}

/**
 * Per-method validation config consumed by the route primitives.
 * `response` is intentionally absent here — it's a separate concern handled at the handler level.
 */
export interface RequestValidation {
  body?: BodyValidation;
  headers?: SchemaWithJSON;
  query?: SchemaWithJSON;
  params?: SchemaWithJSON;
  onError?: OnValidateError;
}

/** Headers and query values arrive as strings; this narrows schema output to that constraint. */
export type StringHeaders<T> = {
  [K in keyof T]: Extract<T[K], string>;
};

/**
 * H3Event with `context.params` narrowed to the inferred schema output.
 * Note: params remains optional at the type level for H3 compatibility — guaranteed at runtime.
 */
export type ValidatedH3Event<RequestT extends EventHandlerRequest, Params> = Omit<
  H3Event<RequestT>,
  "context"
> & {
  context: Omit<H3Event["context"], "params"> & {
    params?: Params;
  };
};
