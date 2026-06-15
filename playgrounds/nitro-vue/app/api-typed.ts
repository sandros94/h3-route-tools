import { createTypedFetch } from "h3-route-tools";

// Our own typed client as a PEER to nitro's `$Fetch` — types params/body/query AND response, over
// global fetch + native Response.json(). The route map is type-only (`typeof import().default`), so no
// server code is pulled into the client bundle. Response fields are reported as their wire shape
// (e.g. a `z.date()` response arrives as `string`).
type Routes = {
  "/posts/:id": typeof import("../routes/posts/[id].ts").default;
  "/health": typeof import("../routes/health.ts").default;
};

export const typedApi = createTypedFetch<Routes>();
