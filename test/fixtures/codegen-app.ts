import { z } from "zod";
import { H3Typed } from "../../src/h3-typed.ts";

/*
  A real, runnable fixture app — handlers return genuine values that satisfy their response schemas
  (no casts). test/codegen.test.ts dispatches against it to prove it works before snapshotting the
  generated types, so the snapshot can't bless a fake app.
*/
export const app = new H3Typed()
  .route({
    route: "/posts/:id",
    params: z.object({ id: z.coerce.number() }),
    get: {
      validate: {
        response: z.object({
          id: z.number(),
          title: z.string(),
          when: z.date(),
          status: z.enum(["draft", "published"]),
          author: z.object({ name: z.string(), email: z.string().optional() }),
          tags: z.array(z.string()),
        }),
      },
      handler: (event) => ({
        id: event.validated.params.id,
        title: "Hello",
        when: new Date(0),
        status: "published",
        author: { name: "Ada" },
        tags: ["a", "b"],
      }),
    },
    post: {
      validate: {
        query: z.object({ draft: z.coerce.boolean() }),
        body: z.object({ title: z.string(), tags: z.string().transform((s) => s.split(",")) }),
        response: z.object({ id: z.number(), tagCount: z.number() }),
      },
      handler: async (event) => {
        const body = await event.req.json();
        return { id: event.validated.params.id, tagCount: body.tags.length };
      },
    },
    // DELETE takes no request body (RFC 9110 §9.3.5) — only a typed response.
    delete: {
      validate: { response: z.object({ deleted: z.boolean() }) },
      handler: () => ({ deleted: true }),
    },
  })
  .route({
    route: "/users/:id",
    params: z.object({ id: z.coerce.number() }),
    get: {
      validate: {
        headers: z.object({ authorization: z.string() }),
        response: {
          200: z.object({ id: z.number(), name: z.string() }),
          404: z.object({ error: z.literal("not_found") }),
        },
      },
      handler: (event) => {
        if (event.validated.params.id === 0) {
          event.res.status = 404;
          return { error: "not_found" };
        }
        return { id: event.validated.params.id, name: "Ada" };
      },
    },
  })
  .route({ route: "/health", get: { handler: () => ({ ok: true }) } });
