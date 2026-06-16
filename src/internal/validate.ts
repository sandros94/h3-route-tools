import { HTTPError, getQuery, getRouterParams, type H3Event } from "h3";
import type { ServerRequest } from "srvx";
import type { ErrorDetails } from "h3";

import {
  createUnsupportedMediaTypeError,
  createValidationError,
  RESPONSE_VALIDATION_FAILED,
  VALIDATION_FAILED,
} from "./error.ts";
import { matchMediaType, PARSER_BY_MEDIA_TYPE, type ParserName } from "./media-type.ts";
import type {
  BodyValidation,
  ErrorBuilder,
  InferOutput,
  OnValidationError,
  SchemaWithJSON,
  StandardSchemaV1,
  StreamMap,
  ValidateFunction,
  ValidateIssues,
  ValidateOptions,
  ValidateResult,
  ValidateSource,
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
      throw new HTTPError(options.onError?.(result) ?? defaultValidationError(result.issues));
    }
    return result.value;
  }

  try {
    const res = await fn(data);
    if (res === false) {
      const issues = [{ message: VALIDATION_FAILED }];
      throw new HTTPError(options.onError?.({ issues }) ?? defaultValidationError(issues));
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

/** The default validation error: a `400` carrying the schema issues — used whenever `onError` overrides nothing. */
function defaultValidationError(issues: ValidateIssues | undefined): ErrorDetails {
  return {
    status: 400,
    statusText: VALIDATION_FAILED,
    message: VALIDATION_FAILED,
    data: { issues, message: VALIDATION_FAILED },
  };
}

/** The single chokepoint: bind a `source` + `event` to an `OnValidationError`, yielding the {@link ErrorBuilder} the validators consume. */
export function resolveOnError(
  source: ValidateSource,
  event: H3Event,
  onError: OnValidationError | undefined,
): ErrorBuilder {
  return (result) =>
    onError?.({ source, issues: result.issues, event }) || defaultValidationError(result.issues);
}

/**
 * Validate route params — eager, async, opt-in `decode` (default off, h3 parity). Validated with our
 * own {@link validateData} (over h3's raw `getRouterParams`) so `onError` controls the whole error
 * envelope, including `data`, the same as every other source.
 */
export function validateParams<Schema extends SchemaWithJSON>(
  event: H3Event,
  schema: Schema,
  options: ValidateOptions & { decode?: boolean } = {},
): Promise<InferOutput<Schema>> {
  return validateData(getRouterParams(event, { decode: options.decode }), schema, {
    onError: options.onError,
  });
}

/** Validate query — eager, async; over h3's raw `getQuery` (see {@link validateParams} on `onError`). */
export function validateQuery<Schema extends SchemaWithJSON>(
  event: H3Event,
  schema: Schema,
  options: ValidateOptions = {},
): Promise<InferOutput<Schema>> {
  return validateData(getQuery(event), schema, { onError: options.onError });
}

/** Validate request headers — eager, async; our own (h3 has no header accessor). Headers are strings. */
export async function validateHeaders<Schema extends SchemaWithJSON>(
  event: H3Event,
  schema: Schema,
  options: ValidateOptions = {},
): Promise<InferOutput<Schema>> {
  const headers = Object.fromEntries(event.req.headers.entries());
  return validateData(headers, schema, { onError: options.onError });
}

/**
 * Wrap `req` with lazy, content-type-aware body validation — nothing is read here.
 * - Bare schema `body` → a request whose `.json()` validates on read.
 * - `body` media-type map → matches the `Content-Type`; a matched schema validates the parsed body on read.
 * - `stream` media-type map → matched content types are never buffered; the raw request is returned and
 *   the handler reads `event.req.body` itself.
 * - Neither map matches the `Content-Type` → 415.
 */
export function validateBody(
  req: ServerRequest,
  validation: { body?: BodyValidation; stream?: StreamMap },
  options: ValidateOptions = {},
): ServerRequest {
  const { body, stream } = validation;
  if (body && isSchema(body)) {
    return wrapBareJSON(req, body, options);
  }

  const incoming = req.headers.get("content-type");
  const matched = matchMediaType([...keysOf(body), ...keysOf(stream)], { against: incoming });
  if (!matched) {
    throw createUnsupportedMediaTypeError(incoming);
  }

  const schema = body?.[matched];
  return schema ? wrapMatched(req, matched, schema, options) : req;
}

function keysOf(map: Record<string, unknown> | undefined): string[] {
  return map ? Object.keys(map) : [];
}

function isSchema(value: object): value is SchemaWithJSON {
  return "~standard" in value;
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
  onError: ErrorBuilder | undefined,
): T {
  if (result.issues) {
    throw new HTTPError(onError?.(result) ?? defaultValidationError(result.issues));
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
  options: ValidateOptions = {},
): Promise<InferOutput<Schema>> {
  try {
    return await validateData(value, schema, { onError: options.onError });
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
