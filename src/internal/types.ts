import type { ErrorDetails, H3Event, EventHandlerRequest, HTTPMethod } from "h3";
import type {
  StandardSchemaV1,
  StandardJSONSchemaV1,
  StandardTypedV1,
} from "@standard-schema/spec";

export type { StandardSchemaV1, StandardJSONSchemaV1, StandardTypedV1 };

/** Lowercase HTTP method keys, matching OpenAPI path-item conventions. */
export type RouteMethod = Lowercase<HTTPMethod>;

/** Status code key for response maps — numeric (`200`) or string (`"4XX"`, `"default"`). */
export type StatusCodeKey = number | string;

/** Flatten an intersection / mapped type into a plain object type (display only). */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

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
 * A map of `Content-Type` → validating schema. The matched content type's body is buffered and
 * validated on read; non-declared content types are rejected with 415. Keys are normalized media types.
 */
export type MediaTypeMap = {
  [mediaType: string]: SchemaWithJSON;
};

/**
 * Body validation accepts three shapes:
 * - `undefined`: no validation; the request is passed through unchanged.
 * - `SchemaWithJSON`: bare schema bound to `application/json`; other content types pass through unvalidated.
 * - `MediaTypeMap`: strict — only declared content types are accepted, 415 on mismatch.
 */
export type BodyValidation = SchemaWithJSON | MediaTypeMap;

/**
 * OpenAPI documentation for one streamed content type. A streamed body is never buffered or
 * value-validated — the handler reads the raw `event.req.body` itself — so this only describes the
 * payload for the spec:
 * - `true`: undocumented; emits an empty media-type object (the content-type key identifies the payload).
 * - `JSONSchemaDocument`: a raw JSON Schema, used verbatim (e.g. binary annotations, an NDJSON line shape).
 * - `StandardJSONSchemaV1`: a schema's JSON Schema output.
 */
export type StreamDoc = true | JSONSchemaDocument | StandardJSONSchemaV1;

/**
 * A map of `Content-Type` → {@link StreamDoc} for raw, never-buffered request bodies. A streamed
 * content type is accepted (no 415) and handed to the handler as `event.req.body`; its `StreamDoc`
 * feeds OpenAPI only. Kept separate from {@link MediaTypeMap} so neither a validating schema nor a
 * doc leaks into the other's media types.
 */
export type StreamMap = {
  [mediaType: string]: StreamDoc;
};

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
 * The serialized envelope of any `HTTPError`. Mirrors `h3`'s `HTTPError` toJSON shape.
 * `DataT` parameterizes the `data` field for typed error envelopes (e.g. validation issues).
 */
export interface HTTPErrorPayload<DataT = unknown> {
  status: number;
  statusText: string;
  message: string;
  data?: DataT;
}

/** Serialized 400 envelope produced by validation failures. */
export type ValidationErrorPayload = HTTPErrorPayload<ValidationErrorData>;

/** Serialized 415 envelope produced when no declared content-type matches. */
export type UnsupportedMediaTypePayload = HTTPErrorPayload<UnsupportedMediaTypeData>;

/** A JSON Schema document body — the shape produced by `StandardJSONSchemaV1.Converter`. */
export type JSONSchemaDocument = Record<string, unknown>;

/** Map of extracted component schemas keyed by `$id`, ready to drop into `components.schemas`. */
export type ComponentsRegistry = Record<string, JSONSchemaDocument>;

/** Options for `extractComponents`. */
export interface ExtractComponentsOptions {
  /** Pre-existing components map; entries are merged in (first-write-wins on key conflicts). */
  components?: Readonly<ComponentsRegistry>;
}

/** Result of `extractComponents`. */
export interface ExtractComponentsResult {
  /** The input schema with every `$id`-bearing subschema replaced by a `$ref`. */
  schema: JSONSchemaDocument;
  /** The merged components map (existing entries + newly extracted ones). */
  components: ComponentsRegistry;
}

/**
 * Per-method validation config consumed by the route primitives.
 * `response` is intentionally absent here — it's a separate concern handled at the handler level.
 */
export interface RequestValidation {
  body?: BodyValidation;
  stream?: StreamMap;
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
 * H3Event with `context.params` narrowed to the inferred schema output and required.
 * Use when params have been validated; otherwise plain `H3Event` already keeps `params` optional.
 */
export type ValidatedH3Event<RequestT extends EventHandlerRequest, Params> = {
  [K in keyof H3Event<RequestT>]: K extends "context"
    ? Omit<H3Event<RequestT>[K], "params"> & { params: Params }
    : H3Event<RequestT>[K];
};
