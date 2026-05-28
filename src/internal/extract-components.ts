import type {
  ComponentsRegistry,
  ExtractComponentsOptions,
  ExtractComponentsResult,
  JSONSchemaDocument,
} from "./types.ts";

/**
 * Walk a JSON Schema and extract every `$id`-bearing subschema into a components map,
 * replacing it in place with a `{ $ref: "#/components/schemas/<id>" }` pointer.
 *
 * Pure — never mutates inputs. The returned `components` map merges any pre-existing entries
 * with the newly extracted ones (first-write-wins on `$id` collisions).
 *
 * Top-level `$id` is extracted too. Recursive: nested `$id`s inside `properties`, array items,
 * `oneOf`/`anyOf`/`allOf`, and arbitrary nesting are all lifted into the components map.
 */
export function extractComponents(
  jsonSchema: JSONSchemaDocument,
  options: ExtractComponentsOptions = {},
): ExtractComponentsResult {
  const components: ComponentsRegistry = { ...options.components };
  const id = readId(jsonSchema);
  if (id !== undefined) {
    storeIfAbsent(id, jsonSchema, components);
    return { schema: { $ref: refFor(id) }, components };
  }
  return { schema: walkChildren(jsonSchema, components), components };
}

function walk(node: unknown, components: ComponentsRegistry): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, components));
  }
  if (!isPlainSchemaObject(node)) return node;

  const id = readId(node);
  if (id !== undefined) {
    storeIfAbsent(id, node, components);
    return { $ref: refFor(id) };
  }

  return walkChildren(node, components);
}

function storeIfAbsent(
  id: string,
  node: Record<string, unknown>,
  components: ComponentsRegistry,
): void {
  if (Object.prototype.hasOwnProperty.call(components, id)) return;
  // Reserve the slot before recursing — handles cyclic schemas where a $id'd node
  // contains a nested reference back to itself.
  components[id] = {};
  components[id] = walkChildren(node, components);
}

function refFor(id: string): string {
  return `#/components/schemas/${id}`;
}

function walkChildren(
  obj: Record<string, unknown>,
  components: ComponentsRegistry,
): JSONSchemaDocument {
  const out: JSONSchemaDocument = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = walk(value, components);
  }
  return out;
}

function isPlainSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(node: Record<string, unknown>): string | undefined {
  const id = node["$id"];
  return typeof id === "string" ? id : undefined;
}
