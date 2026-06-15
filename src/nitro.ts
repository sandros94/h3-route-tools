import { join, resolve } from "node:path";
import type { NitroModule, NitroTypes, Serialize, Simplify } from "nitro/types";
import type { RouteHandler } from "h3-route-tools";

/** Callable HTTP methods (mirrors the contract's `CallableMethod`; trace/connect are never fetchable). */
const CALLABLE_METHODS = ["get", "head", "post", "put", "patch", "delete", "options"] as const;

/**
 * The nitro `InternalApi` value for a route file whose `default` export is a {@link RouteHandler}: each
 * declared method maps to its response type, `Serialize`d the way it arrives over `$fetch` (e.g. `Date`
 * becomes `string`).
 */
export type NitroMethodsOf<H> =
  H extends RouteHandler<infer _Def, infer Methods>
    ? {
        [M in keyof Methods]: Simplify<
          Serialize<Methods[M] extends { response: infer R } ? R : unknown>
        >;
      }
    : never;

/** The `import('…')` specifier nitro put in a route's generated type string (relative to the types dir). */
function routeImportSpecifier(typeStrings: string[] | undefined): string | undefined {
  return typeStrings?.[0]?.match(/import\('([^']+)'\)/)?.[1];
}

/** A declared method is an object (`{ validate?, handler }`); `head: false`/`options: false` opt-outs are not. */
function declaredMethods(routeDef: Record<string, unknown>): string[] {
  return CALLABLE_METHODS.filter((m) => typeof routeDef[m] === "object" && routeDef[m] !== null);
}

/**
 * Rewrite the generated route types for our routes: replace nitro's single `default` entry (the
 * self-dispatcher's `ReturnType`) with one entry per declared method, typed from the handler contract via
 * {@link NitroMethodsOf}. `typesDir` is the base for each route's `import('…')` specifier. Routes that
 * aren't ours (no `~routeDef`) or whose module can't be imported are left untouched.
 */
export async function extendRouteTypes(
  routes: NitroTypes["routes"],
  typesDir: string,
): Promise<void> {
  for (const [routePath, methods] of Object.entries(routes)) {
    const spec = routeImportSpecifier(methods.default);
    if (!spec) continue;

    let routeDef: Record<string, unknown> | undefined;
    try {
      const mod = await import(resolve(typesDir, `${spec}.ts`));
      routeDef = mod.default?.["~routeDef"];
    } catch {
      continue;
    }
    if (!routeDef) continue;

    const declared = declaredMethods(routeDef);
    if (declared.length === 0) continue;

    routes[routePath] = Object.fromEntries(
      declared.map((method) => [
        method,
        [
          `import("h3-route-tools/nitro").NitroMethodsOf<typeof import('${spec}').default>['${method}']`,
        ],
      ]),
    );
  }
}

/**
 * The h3-route-tools nitro module — add to `nitro.config.ts` `modules: ["h3-route-tools/nitro"]`.
 * Build-time only: types nitro's `$fetch` for routes whose `default` export is a `defineRouteHandler`.
 */
export const h3RouteTools: NitroModule = {
  name: "h3-route-tools",
  setup(nitro) {
    const typesDir = join(nitro.options.buildDir, "types");
    nitro.hooks.hook("types:extend", (types) => extendRouteTypes(types.routes, typesDir));
  },
};

export default h3RouteTools;
