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

/** The route module's `~routeDef` if its `default` export is one of ours, else undefined (incl. import failures). */
async function loadRouteDef(
  spec: string,
  typesDir: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const mod = await import(resolve(typesDir, `${spec}.ts`));
    return mod.default?.["~routeDef"];
  } catch {
    return undefined;
  }
}

/** A declared method is an object (`{ validate?, handler }`); `head: false`/`options: false` opt-outs are not. */
function declaredMethods(routeDef: Record<string, unknown>): string[] {
  return CALLABLE_METHODS.filter((m) => typeof routeDef[m] === "object" && routeDef[m] !== null);
}

/** The generated `InternalApi` type string for one method of one of our routes. */
function methodType(spec: string, method: string): string {
  return `import("h3-route-tools/nitro").NitroMethodsOf<typeof import('${spec}').default>['${method}']`;
}

/** Diagnostic for a method-locked file (`x.get.ts`) whose handler declares methods nitro won't route. */
function methodLockMessage(spec: string, lock: string, declared: string[]): string {
  const base = spec.endsWith(`.${lock}`) ? spec.slice(0, -(lock.length + 1)) : spec;
  return [
    `  "${spec}.ts" is locked to ${lock.toUpperCase()} by its filename, but its defineRouteHandler declares: ${declared.join(", ")}.`,
    `  nitro routes only ${lock.toUpperCase()} to a *.${lock}.ts file, so the other method(s) are unreachable.`,
    `  Fix: rename it to "${base}.ts" (catch-all, serves every declared method) or split each method into its own *.<method>.ts file.`,
  ].join("\n");
}

/**
 * Rewrite the generated route types for our routes so nitro's `$fetch`/internal `fetch` is typed from the
 * handler contract via {@link NitroMethodsOf} instead of nitro's `ReturnType` of the self-dispatcher:
 * - catch-all files (`x.ts`, generated as a single `default` entry) become one entry per declared method;
 * - method-locked files (`x.get.ts`, generated as a single method entry) are typed from that method's
 *   contract, and validated to declare exactly that method — a multi-method or mismatched handler in a
 *   locked file would be silently unreachable, so it throws (failing `nitro prepare`/`build`).
 *
 * `typesDir` is the base for each route's `import('…')` specifier. Routes that aren't ours (no `~routeDef`)
 * or whose module can't be imported are left untouched.
 */
export async function extendRouteTypes(
  routes: NitroTypes["routes"],
  typesDir: string,
): Promise<void> {
  const violations: string[] = [];

  for (const [routePath, methods] of Object.entries(routes)) {
    if (methods.default) {
      // Catch-all file: nitro generated one `default` entry from the self-dispatcher's ReturnType.
      const spec = routeImportSpecifier(methods.default);
      if (!spec) continue;
      const routeDef = await loadRouteDef(spec, typesDir);
      if (!routeDef) continue;

      const declared = declaredMethods(routeDef);
      if (declared.length === 0) continue;
      routes[routePath] = Object.fromEntries(declared.map((m) => [m, [methodType(spec, m)]]));
      continue;
    }

    // Method-locked file(s): each key is one method nitro locked from a `*.<method>.ts` filename.
    const rewritten: Record<string, string[]> = {};
    for (const [methodKey, typeStrings] of Object.entries(methods)) {
      if (!typeStrings) continue;
      const spec = routeImportSpecifier(typeStrings);
      const routeDef = spec ? await loadRouteDef(spec, typesDir) : undefined;
      if (!spec || !routeDef) {
        rewritten[methodKey] = typeStrings;
        continue;
      }

      const lock = methodKey.toLowerCase();
      const declared = declaredMethods(routeDef);
      if (declared.length !== 1 || declared[0] !== lock) {
        violations.push(methodLockMessage(spec, lock, declared));
        rewritten[methodKey] = typeStrings;
        continue;
      }
      rewritten[methodKey] = [methodType(spec, lock)];
    }
    routes[routePath] = rewritten;
  }

  if (violations.length > 0) {
    throw new Error(
      `[h3-route-tools] method-locked route file(s) declare unreachable methods:\n\n${violations.join("\n\n")}`,
    );
  }
}

/**
 * The h3-route-tools nitro module — add to `nitro.config.ts` `modules: ["h3-route-tools/nitro"]`.
 * Build-time only: types nitro's `$fetch`/internal `fetch` for routes whose `default` export is a
 * `defineRouteHandler`, and fails the build on a method-locked file whose handler declares other methods.
 */
export const h3RouteTools: NitroModule = {
  name: "h3-route-tools",
  setup(nitro) {
    const typesDir = join(nitro.options.buildDir, "types");
    nitro.hooks.hook("types:extend", (types) => extendRouteTypes(types.routes, typesDir));
  },
};

export default h3RouteTools;
