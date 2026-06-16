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

## Custom validation errors

Out of the box, a request that fails validation is a `400` and a bad handler response a `500`, both carrying the schema `issues`. To shape them yourself there are only two things to decide:

- **What failed** — every hook receives `{ source, issues, event }`, where `source` is `"params" | "query" | "headers" | "body" | "response"`. You write _one_ function and branch on `source`.
- **Where to hook it** — the same `(failure) => ErrorDetails | void` runs at three scopes that cascade **method → route → app** (the narrower one wins). Return `ErrorDetails` to override, or nothing to fall back to the default.

That's the whole model: one function shape, applied at the scope you need. A complete app:

```ts
import { serve } from "srvx";
import { H3Typed } from "h3-route-tools";
import * as v from "valibot";

const app = new H3Typed({
  // App-wide default: one consistent error envelope for every route.
  // (Named `onValidationError` so it doesn't shadow h3's own catch-all `onError`.)
  onValidationError: ({ source, issues, event }) => ({
    status: source === "response" ? 500 : 422,
    message: `${source} validation failed`,
    data: {
      source,
      requestId: event.req.headers.get("x-request-id"),
      issues: issues.map((i) => ({ path: i.path, message: i.message })),
    },
  }),
}).route({
  route: "/posts/:id",
  params: v.object({ id: v.pipe(v.string(), v.toNumber()) }),
  post: {
    validate: {
      body: v.object({ title: v.string() }),
      response: v.object({ id: v.number(), title: v.string() }),
    },
    handler: async (event) => {
      const { title } = await event.req.json();
      return { id: event.validated.params.id, title };
    },
  },
});

serve(app);
```

```sh
curl -X POST localhost:3000/posts/abc -d '{"title":"hi"}'
# 422 { "message": "params validation failed", "data": { "source": "params", … } }

curl -X POST localhost:3000/posts/1 -H 'content-type: application/json' -d '{"title":42}'
# 422 { "message": "body validation failed",   "data": { "source": "body", … } }
```

### Choosing a scope

`onValidationError` lives in the same place at every level — the config/def object — so it never hides in a forgettable second argument:

| Scope        | When                                 | Where                                 |
| ------------ | ------------------------------------ | ------------------------------------- |
| **Defaults** | you just want `400`/`500` + `issues` | do nothing                            |
| **App**      | one envelope for the whole app       | `new H3Typed({ onValidationError })`  |
| **Route**    | special-case a single route          | `.route({ onValidationError, … })`    |
| **Method**   | special-case one method of a route   | `get: { onValidationError, handler }` |

```ts
// All three at once — method beats route beats app:
new H3Typed({ onValidationError: appDefault }).route({
  route: "/x",
  onValidationError: forThisRoute,
  get: { onValidationError: justForGet, handler },
});
```

In Nitro (or anywhere without an `H3Typed` app), `defineRouteHandler` takes the same `onValidationError` in its definition object — there's no app level, so set it per route file (or per method):

```ts
export default defineRouteHandler({
  onValidationError: ({ source, issues }) => ({ status: 422, data: { source, issues } }),
  get: { validate: { response: User }, handler },
});
```

One thing to keep in mind: a **response** failure always stays `500` (it's a server-side contract breach — your `message`/`data` are used, the status is not).

> `onValidationError` shapes the **runtime** response only. The OpenAPI error-response schema is separate — override it with the route's `errors` option if you change the envelope and want the document to match.

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
