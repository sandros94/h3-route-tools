import { HTTPError } from "h3";
import type { ServerRequest } from "srvx";

import {
  createUnsupportedMediaTypeError,
  createValidationError,
  RESPONSE_VALIDATION_FAILED,
  VALIDATION_FAILED,
} from "./error.ts";
import { matchMediaType, PARSER_BY_MEDIA_TYPE, type ParserName } from "./media-type.ts";
import type {
  BodyValidation,
  InferOutput,
  OnValidateError,
  SchemaWithJSON,
  StandardSchemaV1,
  ValidateFunction,
  ValidateOptions,
  ValidateResult,
} from "./types.ts";

/**
 * Validate `data` using a schema or free-form function. Async; supports both standard-schema and predicate-style validators.
 */
export async function validateData<Schema extends StandardSchemaV1>(
  data: unknown,
  fn: Schema,
  options?: ValidateOptions,
): Promise<InferOutput<Schema>>;
export async function validateData<T>(
  data: unknown,
  fn: (data: unknown) => ValidateResult<T> | Promise<ValidateResult<T>>,
  options?: ValidateOptions,
): Promise<T>;
export async function validateData<T>(
  data: unknown,
  fn: ValidateFunction<T>,
  options: ValidateOptions = {},
): Promise<T> {
  if ("~standard" in fn) {
    const result = await fn["~standard"].validate(data);
    if (result.issues) {
      throw createValidationError(
        options.onError?.(result) || { message: VALIDATION_FAILED, issues: result.issues },
      );
    }
    return result.value;
  }

  try {
    const res = await fn(data);
    if (res === false) {
      throw createValidationError(
        options.onError?.({ issues: [{ message: VALIDATION_FAILED }] }) || {
          message: VALIDATION_FAILED,
        },
      );
    }
    if (res === true || res === undefined) {
      // @ts-expect-error: predicate returned true/void means input data is valid T at runtime;
      // the type cannot be narrowed without an explicit type guard signature.
      return data;
    }
    return res;
  } catch (error) {
    throw createValidationError(error);
  }
}

/** Synchronous standard-schema validation. Throws if the schema returns a Promise. */
export function syncValidate<Source extends string, Schema extends SchemaWithJSON>(
  source: Source,
  data: unknown,
  schema: Schema,
  options: ValidateOptions<Source> = {},
): InferOutput<Schema> {
  const result = schema["~standard"].validate(data);
  if (result instanceof Promise) {
    throw new TypeError(`Asynchronous validation is not supported for ${source}`);
  }
  if (result.issues) {
    throw createValidationError(
      options.onError?.({ _source: source, ...result }) || {
        message: VALIDATION_FAILED,
        issues: result.issues,
      },
    );
  }
  return result.value;
}

/** Validate path params synchronously; returns the parsed shape. */
export function validateParams<Schema extends SchemaWithJSON>(
  params: Record<string, string> | undefined,
  schema: Schema,
  options: ValidateOptions = {},
): InferOutput<Schema> {
  return syncValidate("params", params || {}, schema, options);
}

/**
 * Mutate `req.headers` in place with validated values.
 * Only string-valued entries are written back; non-string outputs are dropped from the headers map
 * (the typed value remains observable to the handler via the schema-inferred type).
 */
export function validateHeaders<Schema extends SchemaWithJSON>(
  req: ServerRequest,
  schema: Schema,
  options: ValidateOptions = {},
): void {
  const validated = syncValidate(
    "headers",
    Object.fromEntries(req.headers.entries()),
    schema,
    options,
  );
  writeStringEntries(validated, (k, v) => req.headers.set(k, v));
}

/**
 * Mutate `url.searchParams` in place with validated values.
 * Only string-valued entries are written back; non-string outputs are dropped from the URL
 * (the typed value remains observable to the handler via the schema-inferred type).
 */
export function validateQuery<Schema extends SchemaWithJSON>(
  url: URL,
  schema: Schema,
  options: ValidateOptions = {},
): URL {
  const validated = syncValidate(
    "query",
    Object.fromEntries(url.searchParams.entries()),
    schema,
    options,
  );
  writeStringEntries(validated, (k, v) => url.searchParams.set(k, v));
  return url;
}

function writeStringEntries(value: unknown, set: (key: string, value: string) => void): void {
  if (typeof value !== "object" || value === null) return;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") set(key, raw);
  }
}

/**
 * Wrap `req` with content-type-aware body validation.
 * - Bare schema: intercepts `.json()` only; other parsers pass through unvalidated.
 * - Media-type map: throws 415 immediately if `Content-Type` matches no declared key;
 *   otherwise intercepts the parser corresponding to the matched media type.
 *
 * Returns a (possibly proxied) `ServerRequest`. The caller (handler) consumes the body
 * through the appropriate parser method and receives validated, typed data.
 */
export function validateBody(
  req: ServerRequest,
  body: BodyValidation,
  options: ValidateOptions = {},
): ServerRequest {
  if (isBareSchema(body)) {
    return wrapBareJSON(req, body, options);
  }

  const declared = Object.keys(body);
  const incoming = req.headers.get("content-type");
  const matched = matchMediaType(declared, { against: incoming });
  if (!matched) {
    throw createUnsupportedMediaTypeError(incoming);
  }
  return wrapMatched(req, matched, body[matched]!, options);
}

function isBareSchema(body: BodyValidation): body is SchemaWithJSON {
  return "~standard" in body;
}

function wrapBareJSON(
  req: ServerRequest,
  schema: SchemaWithJSON,
  options: ValidateOptions,
): ServerRequest {
  return new Proxy(req, {
    get(target, prop: keyof ServerRequest) {
      if (prop === "json") {
        return function _validatedJson() {
          return req
            .json()
            .then((data) => schema["~standard"].validate(data))
            .then((result) => throwOrReturn(result, options.onError));
        };
      }
      return bindIfFn(target, prop);
    },
  });
}

function wrapMatched(
  req: ServerRequest,
  mediaType: string,
  schema: SchemaWithJSON,
  options: ValidateOptions,
): ServerRequest {
  const parser: ParserName = PARSER_BY_MEDIA_TYPE[mediaType.toLowerCase()] ?? "arrayBuffer";

  return new Proxy(req, {
    get(target, prop: keyof ServerRequest) {
      if (prop === parser) {
        return function _validatedParser() {
          return getParsedBody(req, parser)
            .then((data) => schema["~standard"].validate(data))
            .then((result) => throwOrReturn(result, options.onError));
        };
      }
      return bindIfFn(target, prop);
    },
  });
}

async function getParsedBody(req: ServerRequest, parser: ParserName): Promise<unknown> {
  switch (parser) {
    case "json":
      return req.json();
    case "formData":
      return formDataToObject(await req.formData());
    case "text":
      return req.text();
    case "arrayBuffer":
      return req.arrayBuffer();
  }
}

function bindIfFn(target: ServerRequest, prop: keyof ServerRequest): unknown {
  const value = Reflect.get(target, prop);
  return typeof value === "function" ? value.bind(target) : value;
}

function formDataToObject(form: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(form.entries());
}

function throwOrReturn<T>(
  result: StandardSchemaV1.Result<T>,
  onError: OnValidateError | undefined,
): T {
  if (result.issues) {
    throw createValidationError(
      onError?.({ _source: "body", issues: result.issues }) || {
        message: VALIDATION_FAILED,
        issues: result.issues,
      },
    );
  }
  return result.value;
}

/**
 * Validate a handler's return value against a response schema.
 * Failures produce a 500 (server-side contract breach), not 400.
 */
export async function validateResponse<Schema extends StandardSchemaV1>(
  value: unknown,
  schema: Schema,
  options: ValidateOptions<"response"> = {},
): Promise<InferOutput<Schema>> {
  try {
    return await validateData(value, schema, {
      onError: options.onError
        ? (result) => options.onError!({ ...result, _source: "response" })
        : undefined,
    });
  } catch (error) {
    throw new HTTPError({
      cause: error,
      status: 500,
      statusText: pickStatusText(error),
      message: pickMessage(error),
      data: pickData(error),
    });
  }
}

function pickStatusText(error: unknown): string {
  const v = readStringField(error, "statusText");
  return v && v !== VALIDATION_FAILED ? v : RESPONSE_VALIDATION_FAILED;
}

function pickMessage(error: unknown): string {
  const v = readStringField(error, "message");
  return v && v !== VALIDATION_FAILED ? v : RESPONSE_VALIDATION_FAILED;
}

function pickData(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return Reflect.get(error, "data");
}

function readStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = Reflect.get(value, key);
  return typeof v === "string" ? v : undefined;
}

export type { BodyValidation, MediaTypeMap } from "./types.ts";
