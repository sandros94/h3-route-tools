import { defineRouteHandler } from "h3-route-tools";
import * as v from "valibot";

export default defineRouteHandler({
  get: { validate: { response: v.object({ ok: v.boolean() }) }, handler: () => ({ ok: true }) },
});
