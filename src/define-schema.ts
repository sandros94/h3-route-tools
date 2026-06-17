import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Wrap a validating schema so its emitted JSON Schema carries `$id: name`.
 * Runtime validation is passed through unchanged; only the JSON Schema converters are decorated.
 *
 * If the inner schema already emits a `$id`, that value wins and `defineSchema` becomes a no-op.
 */
export function defineSchema<I, O>(
  name: string,
  schema: StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O>
): StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O> {
  const inner = schema["~standard"];

  return {
    "~standard": {
      version: inner.version,
      vendor: inner.vendor,
      types: inner.types,
      validate: inner.validate,
      jsonSchema: {
        input: (options) => ensureId(inner.jsonSchema.input(options), name),
        output: (options) => ensureId(inner.jsonSchema.output(options), name),
      },
    },
  };
}

function ensureId(json: Record<string, unknown>, name: string): Record<string, unknown> {
  return typeof json["$id"] === "string" ? json : { $id: name, ...json };
}
