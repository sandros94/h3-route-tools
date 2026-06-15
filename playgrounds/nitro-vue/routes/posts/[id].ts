import { defineRouteHandler } from "h3-route-tools";
import * as v from "valibot";

export default defineRouteHandler({
  params: v.object({ id: v.pipe(v.string(), v.toNumber()) }),
  get: {
    validate: {
      response: v.object({ id: v.number(), title: v.string(), when: v.date() }),
    },
    handler: (event) => ({ id: event.validated.params.id, title: "Hello", when: new Date(0) }),
  },
  post: {
    validate: {
      body: v.object({
        title: v.string(),
        tags: v.union([
          v.array(v.string()),
          v.pipe(
            v.string(),
            v.transform((s) => s.split(",")),
          ),
        ]),
      }),
      response: v.object({ id: v.number(), tagCount: v.number() }),
    },
    handler: async (event) => {
      const body = await event.req.json();
      return { id: event.validated.params.id, tagCount: body.tags.length };
    },
  },
});
