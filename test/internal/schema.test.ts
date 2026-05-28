import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as v from "valibot";

import { hasJSONSchema, getStandardJSONSchema, readSchemaId } from "../../src/internal/schema.ts";

describe("hasJSONSchema", () => {
  it("returns true for schemas that implement StandardJSONSchemaV1 (zod 4)", () => {
    expect(hasJSONSchema(z.object({ id: z.string() }))).toBe(true);
  });

  it("returns false for schemas that only implement StandardSchemaV1 (valibot)", () => {
    expect(hasJSONSchema(v.object({ id: v.string() }))).toBe(false);
  });
});

describe("getStandardJSONSchema", () => {
  it("returns the JSON Schema for a zod schema (output direction by default)", () => {
    const schema = z.object({ id: z.string(), name: z.string() });
    const json = getStandardJSONSchema(schema);
    expect(json).toMatchObject({
      type: "object",
      properties: { id: expect.anything(), name: expect.anything() },
    });
  });

  it("supports input vs output direction", () => {
    const schema = z.object({ id: z.string() });
    const input = getStandardJSONSchema(schema, { direction: "input" });
    const output = getStandardJSONSchema(schema, { direction: "output" });
    expect(input).toBeDefined();
    expect(output).toBeDefined();
  });

  it("returns undefined for schemas without StandardJSONSchemaV1", () => {
    expect(getStandardJSONSchema(v.object({ id: v.string() }))).toBeUndefined();
  });
});

describe("readSchemaId", () => {
  it("returns the $id when present and string-valued", () => {
    expect(readSchemaId({ $id: "User", type: "object" })).toBe("User");
  });

  it("returns undefined when $id is missing", () => {
    expect(readSchemaId({ type: "object" })).toBeUndefined();
  });

  it("returns undefined when $id is not a string", () => {
    expect(readSchemaId({ $id: 42 })).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(readSchemaId(undefined)).toBeUndefined();
  });
});
