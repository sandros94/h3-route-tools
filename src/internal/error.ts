import { HTTPError } from "h3";
import type { UnsupportedMediaTypeData, ValidateIssues, ValidationErrorData } from "./types.ts";

export const VALIDATION_FAILED = "Validation failed";
export const RESPONSE_VALIDATION_FAILED = "Response validation failed";
export const UNSUPPORTED_MEDIA_TYPE = "Unsupported Media Type";

/** Build an `HTTPError` from any failure shape — pass-through for existing `HTTPError`s. */
export function createValidationError<DataT>(cause: HTTPError<DataT>): HTTPError<DataT>;
export function createValidationError(cause: unknown): HTTPError<ValidationErrorData>;
export function createValidationError(
  cause: unknown,
): HTTPError<ValidationErrorData> | HTTPError<unknown> {
  if (HTTPError.isError(cause)) return cause;

  const status = readNumberProp(cause, "status") ?? 400;
  const statusText = readStringProp(cause, "statusText") ?? VALIDATION_FAILED;
  const message = readStringProp(cause, "message") ?? VALIDATION_FAILED;
  const issues = readIssues(cause);

  return new HTTPError<ValidationErrorData>({
    cause,
    status,
    statusText,
    message,
    data: {
      issues,
      message: cause instanceof Error ? VALIDATION_FAILED : message,
    },
  });
}

/** 415 thrown when a content-type map is declared and `Content-Type` matches no declared key. */
export function createUnsupportedMediaTypeError(
  received: string | null | undefined,
): HTTPError<UnsupportedMediaTypeData> {
  return new HTTPError<UnsupportedMediaTypeData>({
    status: 415,
    statusText: UNSUPPORTED_MEDIA_TYPE,
    message: UNSUPPORTED_MEDIA_TYPE,
    data: { received: received ?? null },
  });
}

function readStringProp(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = Reflect.get(value, key);
  return typeof v === "string" ? v : undefined;
}

function readNumberProp(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = Reflect.get(value, key);
  return typeof v === "number" ? v : undefined;
}

function readIssues(value: unknown): ValidateIssues | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = Reflect.get(value, "issues");
  return Array.isArray(v) ? v : undefined;
}
