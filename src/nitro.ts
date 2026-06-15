import type { NitroModule, Serialize, Simplify } from "nitro/types";
import type { RouteHandler } from "h3-route-tools";

/**
 * The nitro `InternalApi` value for a route file whose `default` export is a {@link RouteHandler}: each
 * declared method maps to its response type, JSON-serialized (`Serialize`) the way it arrives over
 * `$fetch`. nitro's `$fetch` reads `InternalApi[path][method]`, so this is what makes it typed per method.
 */
export type NitroMethodsOf<H> =
  H extends RouteHandler<infer _Def, infer Methods>
    ? {
        [M in keyof Methods]: Simplify<
          Serialize<Methods[M] extends { response: infer R } ? R : unknown>
        >;
      }
    : never;

/**
 * The h3-route-tools nitro module — add to `nitro.config.ts` `modules: ["h3-route-tools/nitro"]`.
 * Build-time only.
 */
export const h3RouteTools: NitroModule = {
  name: "h3-route-tools",
  setup(_nitro) {
    // TODO: PHASE 1 — type $fetch: _nitro.hooks.hook("types:extend", (types) => { /* inject NitroMethodsOf */ })
    // TODO: PHASE 2 — method-lock build check
  },
};

export default h3RouteTools;
