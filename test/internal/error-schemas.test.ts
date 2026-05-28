import { describe, it, expect } from "vitest";

import {
  HTTPErrorSchema,
  ValidationErrorSchema,
  UnsupportedMediaTypeSchema,
} from "../../src/internal/error-schemas.ts";
import { hasJSONSchema, getStandardJSONSchema, readSchemaId } from "../../src/internal/schema.ts";

describe("error schemas — common shape", () => {
  const schemas = [
    { name: "HTTPError", schema: HTTPErrorSchema },
    { name: "ValidationError", schema: ValidationErrorSchema },
    { name: "UnsupportedMediaType", schema: UnsupportedMediaTypeSchema },
  ];

  it.each(schemas)("$name implements StandardJSONSchemaV1 (no validator)", ({ schema }) => {
    expect(hasJSONSchema(schema)).toBe(true);
    expect("validate" in schema["~standard"]).toBe(false);
  });

  it.each(schemas)("$name carries the matching $id on input/output", ({ name, schema }) => {
    expect(readSchemaId(getStandardJSONSchema(schema, { direction: "input" }))).toBe(name);
    expect(readSchemaId(getStandardJSONSchema(schema, { direction: "output" }))).toBe(name);
  });

  it.each(schemas)("$name uses the h3-typed-routes vendor", ({ schema }) => {
    expect(schema["~standard"].vendor).toBe("h3-typed-routes");
    expect(schema["~standard"].version).toBe(1);
  });

  it.each(schemas)("$name returns the same body regardless of target", ({ schema }) => {
    const a = getStandardJSONSchema(schema, { target: "draft-2020-12" });
    const b = getStandardJSONSchema(schema, { target: "openapi-3.0" });
    expect(a).toEqual(b);
  });
});

describe("HTTPErrorSchema body", () => {
  it("describes the canonical envelope shape", () => {
    expect(getStandardJSONSchema(HTTPErrorSchema)).toMatchObject({
      type: "object",
      required: ["status", "statusText", "message"],
      properties: {
        status: { type: "integer" },
        statusText: { type: "string" },
        message: { type: "string" },
        data: expect.anything(),
      },
    });
  });
});

describe("ValidationErrorSchema body", () => {
  it("pins status to 400 and describes the issues array", () => {
    expect(getStandardJSONSchema(ValidationErrorSchema)).toMatchObject({
      type: "object",
      properties: {
        status: { const: 400 },
        data: {
          type: "object",
          properties: {
            issues: {
              type: "array",
              items: expect.objectContaining({
                type: "object",
                required: ["message"],
              }),
            },
            message: { type: "string" },
          },
        },
      },
    });
  });
});

describe("UnsupportedMediaTypeSchema body", () => {
  it("pins status to 415 and requires data.received", () => {
    expect(getStandardJSONSchema(UnsupportedMediaTypeSchema)).toMatchObject({
      type: "object",
      required: ["status", "statusText", "message", "data"],
      properties: {
        status: { const: 415 },
        data: {
          type: "object",
          required: ["received"],
          properties: {
            received: { type: ["string", "null"] },
          },
        },
      },
    });
  });
});
