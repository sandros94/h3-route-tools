# h3-route-tools

Type-first routes for [h3](https://h3.dev) v2 — validated params/body/query/response, a typed fetch client, and OpenAPI 3.1 — for plain h3 and [nitro](https://nitro.build) v3.

> [!NOTE]
> This is highly experimental with the main goal of exploring a fully type-first route design with a typed fetch client. The idea is based on the work done by [productdevbook](https://github.com/productdevbook) on the upstream [h3#1143](https://github.com/h3js/h3/pull/1143) and [h3#1237](https://github.com/h3js/h3/pull/1237).

Routes are validated with any [Standard Schema](https://standardschema.dev) validator (zod, valibot, …). The examples below use valibot.

## Plain h3

Define routes with per-method validation. `event.validated` is typed from the schemas, and the response is validated too; validation failures return `400` automatically.

```ts
import { serve } from "srvx";
import { H3Typed } from "h3-route-tools";
import * as v from "valibot";

const app = new H3Typed().route({
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
});

serve(app);
```

## Typed fetch client

`createTypedFetch<typeof app>` infers the route, method, params, body, and response. Address a route by its pattern:

```ts
import { createTypedFetch } from "h3-route-tools";

// Hit the app directly, or pass `{ baseURL: "https://api.example.com" }` to use global fetch.
const api = createTypedFetch<typeof app>({ fetch: app.request });

const res = await api("/posts/:id", { method: "post", params: { id: 1 }, body: { title: "Hi" } });
const created = await res.json(); // typed: { id: number }
```

`res.json()` is typed as the **wire shape**: a `v.date()` / `z.date()` response field comes back as `string` (that is what JSON gives you), not `Date`.

## Nitro v3

Add the module and write file routes whose default export is a `defineRouteHandler`:

```ts
// nitro.config.ts
import { defineConfig } from "nitro";

export default defineConfig({
  modules: ["h3-route-tools/nitro"],
  serverDir: "./",
  compatibilityDate: "2026-06-10",
});
```

```ts
// routes/posts/[id].ts
import { defineRouteHandler } from "h3-route-tools";
import * as v from "valibot";

export default defineRouteHandler({
  params: v.object({ id: v.pipe(v.string(), v.toNumber()) }),
  get: {
    validate: { response: v.object({ id: v.number(), title: v.string() }) },
    handler: (event) => ({ id: event.validated.params.id, title: "Hello" }),
  },
  post: {
    validate: { body: v.object({ title: v.string() }), response: v.object({ id: v.number() }) },
    handler: (event) => ({ id: event.validated.params.id }),
  },
});
```

The same handler serves every declared method (it self-dispatches), so a multi-method handler goes in a **catch-all** file (`routes/posts/[id].ts`). The module:

- types nitro's `InternalApi` (what `$fetch` and a `$Fetch`-typed client read) per method, from each route's contract;
- **fails the build** if a multi-method handler sits in a method-locked file (`posts.get.ts`), where the other methods would be silently unreachable;
- enriches nitro's OpenAPI document (below).

### Typed client in nitro

Use nitro's own `$fetch` (response typing only), or `createTypedFetch` to also type params/body/query — fed a **type-only** route map (no runtime import, no client-bundle cost):

```ts
import { createTypedFetch } from "h3-route-tools";

type Routes = {
  "/posts/:id": typeof import("../routes/posts/[id]").default;
};

export const api = createTypedFetch<Routes>();
// api("/posts/:id", { method: "get", params: { id: 7 } })
```

### OpenAPI

Enable nitro's OpenAPI. The module merges your routes' contracts into nitro's document — **keeping nitro's entries for plain/legacy routes** — and nitro's Scalar (`/_scalar`) and Swagger (`/_swagger`) UIs render the result:

```ts
// nitro.config.ts
export default defineConfig({
  modules: ["h3-route-tools/nitro"],
  serverDir: "./",
  experimental: { openAPI: true },
  openAPI: { production: "runtime" }, // also serve it from the built server
});
```

## Choosing a validator (the valibot caveat)

Validation and TypeScript types work with any Standard Schema validator. **OpenAPI / JSON-Schema generation does not** — it depends on the validator's `to-json-schema`, and the two common choices differ a lot:

- **zod** — rich output. Only a `Date` field can't be represented (no library can) and shows as `{}`.
- **valibot** — `@valibot/to-json-schema` throws on `pipe` / `transform` / `date` schemas, and generation then degrades the **whole containing object** to `{}`. Because coercion like `v.pipe(v.string(), v.toNumber())` is so common, valibot routes often produce empty OpenAPI schemas — even though their validation and TS types are perfectly fine.

So if you rely on the generated OpenAPI (or codegen), prefer **zod** quick and dirty tests, or refer to **valibot**'s overrides for manual schema definition. Otherwise, valibot is fine for validation and TS types, and is smaller and faster than zod 😜.
