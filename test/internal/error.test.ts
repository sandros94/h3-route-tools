import { describe, it, expect } from "vitest";
import { HTTPError } from "h3";

import {
  createValidationError,
  createUnsupportedMediaTypeError,
  VALIDATION_FAILED,
  UNSUPPORTED_MEDIA_TYPE,
} from "../../src/internal/error.ts";

describe("createValidationError", () => {
  it("returns the input HTTPError unchanged", () => {
    const original = new HTTPError({ status: 418, statusText: "I'm a teapot", message: "tea" });
    expect(createValidationError(original)).toBe(original);
  });

  it("wraps a FailureResult into a 400 HTTPError with issues in data", () => {
    const err = createValidationError({
      issues: [{ message: "Invalid", path: ["id"] }],
    });
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.status).toBe(400);
    expect(err.statusText).toBe(VALIDATION_FAILED);
    expect(err.data?.issues).toEqual([{ message: "Invalid", path: ["id"] }]);
  });

  it("wraps a plain Error into a 400 HTTPError", () => {
    const err = createValidationError(new Error("oops"));
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.status).toBe(400);
    expect(err.data?.message).toBe(VALIDATION_FAILED);
  });
});

describe("createUnsupportedMediaTypeError", () => {
  it("returns a 415 HTTPError with the received content-type in data", () => {
    const err = createUnsupportedMediaTypeError("text/csv");
    expect(err).toBeInstanceOf(HTTPError);
    expect(err.status).toBe(415);
    expect(err.statusText).toBe(UNSUPPORTED_MEDIA_TYPE);
    expect(err.data?.received).toBe("text/csv");
  });

  it("handles nullish content-type", () => {
    const err = createUnsupportedMediaTypeError(null);
    expect(err.status).toBe(415);
    expect(err.data?.received).toBeNull();
  });
});
