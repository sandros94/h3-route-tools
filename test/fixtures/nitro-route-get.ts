import { defineRouteHandler } from "../../src/route-handler.ts";
import { z } from "zod";

// Stands in for a method-locked nitro route file (`*.get.ts`): a single-method defineRouteHandler.
export default defineRouteHandler({
  params: z.object({ id: z.coerce.number() }),
  get: {
    validate: { response: z.object({ id: z.number(), when: z.date() }) },
    handler: (event) => ({ id: event.validated.params.id, when: new Date(0) }),
  },
});
