import * as v from "valibot";
import { H3Typed } from "../../src/h3-typed.ts";

/*
  The valibot twin of codegen-app.ts — same routes/shapes, valibot schemas. A real, runnable app
  (dispatched in test/codegen.test.ts) that proves the codegen + validation layer work across Standard
  Schema libraries, and backs the zod-vs-valibot codegen benchmark.
*/
const coerceNumber = v.pipe(v.string(), v.transform(Number));

export const app = new H3Typed()
  .route({
    route: "/posts/:id",
    params: v.object({ id: coerceNumber }),
    get: {
      validate: {
        response: v.object({
          id: v.number(),
          title: v.string(),
          when: v.date(),
          status: v.picklist(["draft", "published"]),
          author: v.object({ name: v.string(), email: v.optional(v.string()) }),
          tags: v.array(v.string()),
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
        query: v.object({
          draft: v.pipe(
            v.string(),
            v.transform((s) => s === "true"),
          ),
        }),
        body: v.object({
          title: v.string(),
          tags: v.pipe(
            v.string(),
            v.transform((s) => s.split(",")),
          ),
        }),
        response: v.object({ id: v.number(), tagCount: v.number() }),
      },
      handler: async (event) => {
        const body = await event.req.json();
        return { id: event.validated.params.id, tagCount: body.tags.length };
      },
    },
    delete: {
      validate: { response: v.object({ deleted: v.boolean() }) },
      handler: () => ({ deleted: true }),
    },
  })
  .route({
    route: "/users/:id",
    params: v.object({ id: coerceNumber }),
    get: {
      validate: {
        headers: v.object({ authorization: v.string() }),
        response: {
          200: v.object({ id: v.number(), name: v.string() }),
          404: v.object({ error: v.literal("not_found") }),
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
