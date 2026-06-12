import type {
  HTTPErrorPayload,
  StandardJSONSchemaV1,
  UnsupportedMediaTypePayload,
  ValidationErrorPayload,
} from "./internal/types.ts";

const VENDOR = "h3-route-tools";

/**
 * Build a documentation-only `StandardJSONSchemaV1` from a hardcoded JSON Schema body.
 * Result intentionally has no `~standard.validate` — these schemas describe error envelopes
 * the server produces, not bodies the server accepts.
 */
function staticSchema<Payload>(
  body: Readonly<Record<string, unknown>>,
): StandardJSONSchemaV1<Payload, Payload> {
  return {
    "~standard": {
      version: 1,
      vendor: VENDOR,
      jsonSchema: {
        input: () => body,
        output: () => body,
      },
    },
  };
}

const issueSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    path: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          { type: "number" },
          {
            type: "object",
            properties: { key: {} },
            required: ["key"],
          },
        ],
      },
    },
  },
  required: ["message"],
};

/** Canonical JSON Schema for any `HTTPError` envelope. Generic over `data`. */
export const HTTPErrorSchema = staticSchema<HTTPErrorPayload>({
  $id: "HTTPError",
  type: "object",
  properties: {
    status: { type: "integer", minimum: 100, maximum: 599 },
    statusText: { type: "string" },
    message: { type: "string" },
    data: {},
  },
  required: ["status", "statusText", "message"],
});

/** Canonical JSON Schema for the 400 envelope thrown by validation failures. */
export const ValidationErrorSchema = staticSchema<ValidationErrorPayload>({
  $id: "ValidationError",
  type: "object",
  properties: {
    status: { type: "integer", const: 400 },
    statusText: { type: "string" },
    message: { type: "string" },
    data: {
      type: "object",
      properties: {
        issues: { type: "array", items: issueSchema },
        message: { type: "string" },
      },
    },
  },
  required: ["status", "statusText", "message"],
});

/** Canonical JSON Schema for the 415 envelope thrown when no declared content-type matches. */
export const UnsupportedMediaTypeSchema = staticSchema<UnsupportedMediaTypePayload>({
  $id: "UnsupportedMediaType",
  type: "object",
  properties: {
    status: { type: "integer", const: 415 },
    statusText: { type: "string" },
    message: { type: "string" },
    data: {
      type: "object",
      properties: {
        received: { type: ["string", "null"] },
      },
      required: ["received"],
    },
  },
  required: ["status", "statusText", "message", "data"],
});
