import { describe, it, expect } from "vitest";
import { z } from "zod";

import { defineSchema } from "../../src/internal/define-schema.ts";
import { getStandardJSONSchema, hasJSONSchema, readSchemaId } from "../../src/internal/schema.ts";

describe("defineSchema", () => {
  const User = z.object({ id: z.string(), name: z.string() });

  it("preserves validation behaviour", async () => {
    const named = defineSchema("User", User);
    const ok = await named["~standard"].validate({ id: "a", name: "Alice" });
    expect(ok).toEqual({ issues: undefined, value: { id: "a", name: "Alice" } });
    const fail = await named["~standard"].validate({ id: 42, name: "Alice" });
    expect(fail.issues).toBeDefined();
  });

  it("preserves vendor and version of the wrapped schema", () => {
    const named = defineSchema("User", User);
    expect(named["~standard"].vendor).toBe(User["~standard"].vendor);
    expect(named["~standard"].version).toBe(1);
  });

  it("emits StandardJSONSchemaV1 with the injected $id on output", () => {
    const named = defineSchema("User", User);
    expect(hasJSONSchema(named)).toBe(true);
    expect(readSchemaId(getStandardJSONSchema(named))).toBe("User");
  });

  it("injects $id on input direction too", () => {
    const named = defineSchema("User", User);
    expect(readSchemaId(getStandardJSONSchema(named, { direction: "input" }))).toBe("User");
  });

  it("preserves the rest of the emitted JSON Schema body", () => {
    const named = defineSchema("User", User);
    expect(getStandardJSONSchema(named)).toMatchObject({
      $id: "User",
      type: "object",
      properties: { id: expect.anything(), name: expect.anything() },
    });
  });

  it("does not override a pre-existing $id from the inner schema", () => {
    const Tagged = z.object({ id: z.string() }).meta({ $id: "PreSet" });
    const named = defineSchema("Other", Tagged);
    expect(readSchemaId(getStandardJSONSchema(named))).toBe("PreSet");
  });
});
