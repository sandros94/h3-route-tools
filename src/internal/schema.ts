import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import type { GetJSONSchemaOptions, SchemaWithJSON } from "./types.ts";

/** Type guard: does this schema additionally implement `StandardJSONSchemaV1`? */
export function hasJSONSchema<I, O>(
  schema: SchemaWithJSON<I, O>,
): schema is StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O> {
  return "jsonSchema" in schema["~standard"];
}

/**
 * Extract the JSON Schema representation for the given direction.
 * Returns `undefined` if the schema does not implement `StandardJSONSchemaV1`.
 * Default target is `draft-2020-12` (aligned with OpenAPI 3.1).
 */
export function getStandardJSONSchema<I, O>(
  schema: SchemaWithJSON<I, O>,
  options: GetJSONSchemaOptions = {},
): Record<string, unknown> | undefined {
  if (!hasJSONSchema(schema)) return undefined;
  const direction = options.direction ?? "output";
  const target = options.target ?? "draft-2020-12";
  return schema["~standard"].jsonSchema[direction]({ target });
}

/**
 * Read `$id` from an emitted JSON Schema, if present.
 * The `$id` keyword is the canonical JSON Schema 2020-12 identifier and the hoisting key
 * used to lift subschemas into `components.schemas`.
 */
export function readSchemaId(jsonSchema: Record<string, unknown> | undefined): string | undefined {
  if (!jsonSchema) return undefined;
  const id = jsonSchema["$id"];
  return typeof id === "string" ? id : undefined;
}
