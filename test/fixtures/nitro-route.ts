import { defineRouteHandler } from "../../src/route-handler.ts";
import { z } from "zod";

// Stands in for a nitro route file: a multi-method defineRouteHandler the transform must detect + rewrite.
export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  get: {
    validate: { response: z.object({ id: z.number(), when: z.date() }) },
    handler: (event) => ({ id: event.validated.params.id, when: new Date(0) }),
  },
  post: {
    validate: { body: z.object({ name: z.string() }), response: z.object({ ok: z.boolean() }) },
    handler: () => ({ ok: true }),
  },
});
