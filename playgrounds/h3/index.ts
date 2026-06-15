import { serve } from "srvx";
import { H3Typed, createTypedFetch } from "h3-route-tools";
import * as v from "valibot";

const app = new H3Typed()
  .route({
    route: "/posts/:id",
    params: v.object({ id: v.pipe(v.string(), v.toNumber()) }),
    get: {
      validate: { response: v.object({ id: v.number(), title: v.string() }) },
      handler: (event) => ({ id: event.validated.params.id, title: "Hello" }),
    },
    post: {
      validate: {
        body: v.object({ title: v.string() }),
        response: v.object({ id: v.number() }),
      },
      handler: (event) => ({ id: event.validated.params.id }),
    },
  })
  .route({ route: "/health", get: { handler: () => ({ ok: true }) } });

// `createTypedFetch<typeof app>` gives a fully typed client over the same app — route, method, params, body, and response are all inferred.

export const api = createTypedFetch<typeof app>({ fetch: app.request });

serve(app);
