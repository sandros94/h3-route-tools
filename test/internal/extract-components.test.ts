import { describe, it, expect } from "vitest";

import { extractComponents } from "../../src/internal/extract-components.ts";

describe("extractComponents — top-level $id", () => {
  it("lifts a $id-tagged schema into components and returns a $ref", () => {
    const input = {
      $id: "User",
      type: "object",
      properties: { id: { type: "string" } },
    };

    const { schema, components } = extractComponents(input);

    expect(schema).toEqual({ $ref: "#/components/schemas/User" });
    expect(components).toEqual({
      User: {
        $id: "User",
        type: "object",
        properties: { id: { type: "string" } },
      },
    });
  });

  it("passes through unchanged when no $id is present anywhere", () => {
    const input = { type: "object", properties: { name: { type: "string" } } };
    const { schema, components } = extractComponents(input);
    expect(schema).toEqual(input);
    expect(components).toEqual({});
  });
});

describe("extractComponents — nested $ids", () => {
  it("lifts $ids from properties recursively", () => {
    const input = {
      type: "object",
      properties: {
        author: {
          $id: "User",
          type: "object",
          properties: { id: { type: "string" } },
        },
        title: { type: "string" },
      },
    };

    const { schema, components } = extractComponents(input);

    expect(schema).toEqual({
      type: "object",
      properties: {
        author: { $ref: "#/components/schemas/User" },
        title: { type: "string" },
      },
    });
    expect(components.User).toMatchObject({ $id: "User", type: "object" });
  });

  it("lifts $ids inside array items", () => {
    const input = {
      type: "array",
      items: { $id: "User", type: "object", properties: { id: { type: "string" } } },
    };
    const { schema, components } = extractComponents(input);
    expect(schema).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/User" },
    });
    expect(components.User).toBeDefined();
  });

  it("lifts $ids inside oneOf / anyOf / allOf", () => {
    const input = {
      oneOf: [
        { $id: "User", type: "object" },
        { $id: "Admin", type: "object" },
      ],
    };
    const { schema, components } = extractComponents(input);
    expect(schema).toEqual({
      oneOf: [{ $ref: "#/components/schemas/User" }, { $ref: "#/components/schemas/Admin" }],
    });
    expect(Object.keys(components).sort()).toEqual(["Admin", "User"]);
  });

  it("handles deeply nested $ids", () => {
    const input = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: { $id: "Deep", type: "string" },
          },
        },
      },
    };
    const { schema, components } = extractComponents(input);
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: { $ref: "#/components/schemas/Deep" },
          },
        },
      },
    });
    expect(components.Deep).toEqual({ $id: "Deep", type: "string" });
  });
});

describe("extractComponents — multiple references", () => {
  it("deduplicates: same $id referenced twice produces one components entry", () => {
    const User = { $id: "User", type: "object", properties: { id: { type: "string" } } };
    const input = {
      type: "object",
      properties: {
        author: User,
        reviewer: User,
      },
    };
    const { schema, components } = extractComponents(input);
    expect(schema).toEqual({
      type: "object",
      properties: {
        author: { $ref: "#/components/schemas/User" },
        reviewer: { $ref: "#/components/schemas/User" },
      },
    });
    expect(Object.keys(components)).toEqual(["User"]);
  });
});

describe("extractComponents — accumulation", () => {
  it("merges with a pre-existing components map", () => {
    const existing = {
      Address: { $id: "Address", type: "object" },
    };
    const input = { $id: "User", type: "object" };
    const { schema, components } = extractComponents(input, { components: existing });
    expect(schema).toEqual({ $ref: "#/components/schemas/User" });
    expect(components).toMatchObject({
      Address: { $id: "Address", type: "object" },
      User: { $id: "User", type: "object" },
    });
  });

  it("does not mutate the input components map", () => {
    const existing = { Address: { $id: "Address", type: "object" } };
    const snapshot = JSON.parse(JSON.stringify(existing));
    extractComponents({ $id: "User", type: "object" }, { components: existing });
    expect(existing).toEqual(snapshot);
  });

  it("first-write-wins on $id collision with pre-existing entry", () => {
    const existing = { User: { $id: "User", type: "string" } };
    const input = { $id: "User", type: "object" };
    const { components } = extractComponents(input, { components: existing });
    expect(components.User).toEqual({ $id: "User", type: "string" });
  });
});

describe("extractComponents — edge cases", () => {
  it("does not break on boolean subschemas (true/false)", () => {
    const input = {
      type: "object",
      additionalProperties: false,
      properties: { x: true },
    };
    const { schema, components } = extractComponents(input);
    expect(schema).toEqual(input);
    expect(components).toEqual({});
  });

  it("ignores non-string $id values", () => {
    const input = { $id: 42, type: "object" };
    const { schema, components } = extractComponents(input);
    expect(schema).toEqual(input);
    expect(components).toEqual({});
  });

  it("does not mutate the input schema", () => {
    const input = {
      type: "object",
      properties: { author: { $id: "User", type: "object" } },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    extractComponents(input);
    expect(input).toEqual(snapshot);
  });
});
