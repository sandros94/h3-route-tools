import { join, resolve } from "node:path";
import type { NitroModule, NitroTypes, Serialize, Simplify } from "nitro/types";
import { buildOpenAPIDocument, type RegisteredRoute, type RouteHandler } from "h3-route-tools";

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

/** One route file whose `default` export is an h3-route-tools handler, recovered from nitro's types. */
export interface CollectedRouteHandler {
  /** The nitro route path, e.g. `"/posts/:id"`. */
  routePath: string;
  /** The route module's `import('…')` specifier, relative to `typesDir` (resolve to read the file). */
  importSpecifier: string;
  /** The callable methods the handler declares (lowercase). */
  methods: string[];
}

/**
 * Read nitro's generated `routes` and return the route files whose `default` export is one of ours (a
 * `defineRouteHandler`), each with its `import('…')` specifier and declared methods. The building block
 * the module uses to type `$fetch`; exposed so an advanced consumer (a vite plugin, a Nuxt module, a
 * custom `types:extend` hook) can enumerate our routes and generate their own artifacts — e.g. a route
 * map type `{ [routePath]: typeof import('<importSpecifier>').default }` for a typed client. Routes that
 * aren't ours or whose module can't be imported are skipped; `typesDir` is the base the specifiers are
 * relative to (typically `join(nitro.options.buildDir, "types")`).
 */
export async function collectRouteHandlers(
  routes: NitroTypes["routes"],
  typesDir: string,
): Promise<CollectedRouteHandler[]> {
  const collected: CollectedRouteHandler[] = [];
  for (const [routePath, methods] of Object.entries(routes)) {
    // A route entry references one module per method (method-locked files) or one `default` (catch-all).
    const specifiers = new Set<string>();
    for (const typeStrings of Object.values(methods)) {
      const spec = routeImportSpecifier(typeStrings);
      if (spec) specifiers.add(spec);
    }
    for (const importSpecifier of specifiers) {
      const routeDef = await loadRouteDef(importSpecifier, typesDir);
      if (!routeDef) continue;
      collected.push({ routePath, importSpecifier, methods: declaredMethods(routeDef) });
    }
  }
  return collected;
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

/** Internal route nitro's own OpenAPI document is moved to, so ours can serve the merged result. */
const NITRO_OPENAPI_BASE_ROUTE = "/_openapi.__h3rt-base.json";

/**
 * Build the OpenAPI `paths` + component `schemas` for our routes (rich, from each handler's contract),
 * to merge over nitro's document. `routes`/`typesDir` come from the `types:extend` payload, as in
 * {@link collectRouteHandlers}. Routes that aren't ours or can't be imported are skipped.
 */
export async function buildOpenAPIOverlay(
  routes: NitroTypes["routes"],
  typesDir: string,
): Promise<{ paths: Record<string, unknown>; schemas: Record<string, unknown> }> {
  const registered: RegisteredRoute[] = [];
  for (const [routePath, methods] of Object.entries(routes)) {
    const specifiers = new Set<string>();
    for (const typeStrings of Object.values(methods)) {
      const spec = routeImportSpecifier(typeStrings);
      if (spec) specifiers.add(spec);
    }
    for (const spec of specifiers) {
      try {
        const mod = await import(resolve(typesDir, `${spec}.ts`));
        if (mod.default?.["~routeDef"]) registered.push({ route: routePath, handler: mod.default });
      } catch {
        continue;
      }
    }
  }
  if (registered.length === 0) return { paths: {}, schemas: {} };
  const doc = buildOpenAPIDocument({ info: { title: "", version: "" }, routes: registered });
  return { paths: doc.paths, schemas: doc.components?.schemas ?? {} };
}

/**
 * Source of the runtime route that serves nitro's document with our routes' path items merged over it.
 * The merge (fetch nitro's document once, overlay our paths/components) runs lazily on first request and
 * is cached — nitro re-runs the lazy loader on dev reload, so it stays fresh. `servers` is recomputed per
 * request from the actual request origin (nitro's own handler, reached via the in-process sub-request,
 * would otherwise report the sub-request's synthetic origin).
 */
function openAPIHandlerSource(overlayJSON: string): string {
  return [
    `import { defineLazyEventHandler, defineHandler, getRequestURL } from "h3";`,
    `import { fetch } from "nitro";`,
    `import { useRuntimeConfig } from "nitro/runtime-config";`,
    `const overlay = ${overlayJSON};`,
    // ufo's joinURL isn't bundled into the built server from a virtual module; inline a minimal join.
    `const joinURL = (origin, base) => (!base || base === "/" ? origin : origin.replace(/\\/$/, "") + "/" + base.replace(/^\\/+/, ""));`,
    `export default defineLazyEventHandler(async () => {`,
    `  const base = await (await fetch(${JSON.stringify(NITRO_OPENAPI_BASE_ROUTE)})).json();`,
    `  const paths = { ...base.paths, ...overlay.paths };`,
    `  delete paths[${JSON.stringify(NITRO_OPENAPI_BASE_ROUTE)}];`,
    `  const schemas = { ...base.components?.schemas, ...overlay.schemas };`,
    `  const components = Object.keys(schemas).length ? { ...base.components, schemas } : base.components;`,
    `  const doc = { ...base, paths, ...(components ? { components } : {}) };`,
    `  const server0 = doc.servers?.[0] ?? {};`,
    `  return defineHandler((event) => ({`,
    `    ...doc,`,
    `    servers: [{ ...server0, url: joinURL(getRequestURL(event).origin, useRuntimeConfig().app?.baseURL) }],`,
    `  }));`,
    `});`,
  ].join("\n");
}

/**
 * Override nitro's OpenAPI document with our richer one — only when nitro's OpenAPI is enabled
 * (`experimental.openAPI`). nitro's document (built from `defineRouteMeta`) is reused as the base, so
 * legacy/plain routes are preserved (graceful migration); our routes' path items — typed from each
 * `defineRouteHandler` contract — are merged over it. nitro's existing Scalar/Swagger UIs render the
 * result, since they fetch the same `openAPI.route`.
 */
function overrideOpenAPI(nitro: Parameters<NitroModule["setup"]>[0], typesDir: string): void {
  let overlayJSON = `{"paths":{},"schemas":{}}`;

  nitro.hooks.hook("types:extend", async (types) => {
    overlayJSON = JSON.stringify(await buildOpenAPIOverlay(types.routes, typesDir));
  });

  nitro.options.virtual["#h3-route-tools/openapi"] = () => openAPIHandlerSource(overlayJSON);

  nitro.hooks.hook("build:before", () => {
    const route = nitro.options.openAPI?.route || "/_openapi.json";
    const nitroHandler = nitro.options.handlers.find(
      (h) => h.route === route && String(h.handler).includes("internal/routes/openapi"),
    );
    if (!nitroHandler) return;
    nitroHandler.route = NITRO_OPENAPI_BASE_ROUTE;
    nitro.options.handlers.push({ route, handler: "#h3-route-tools/openapi" });
  });
}

/**
 * The h3-route-tools nitro module — add to `nitro.config.ts` `modules: ["h3-route-tools/nitro"]`.
 * Build-time only:
 * - types nitro's `$fetch`/internal `fetch` for routes whose `default` export is a `defineRouteHandler`;
 * - fails the build on a method-locked file (`x.get.ts`) whose handler declares unreachable methods;
 * - when nitro's OpenAPI is enabled (`experimental.openAPI`), enriches its document with our routes'
 *   contracts while keeping nitro's entries for plain/legacy routes.
 */
export const h3RouteTools: NitroModule = {
  name: "h3-route-tools",
  setup(nitro) {
    const typesDir = join(nitro.options.buildDir, "types");
    nitro.hooks.hook("types:extend", (types) => extendRouteTypes(types.routes, typesDir));
    if (nitro.options.experimental?.openAPI) overrideOpenAPI(nitro, typesDir);
  },
};

export default h3RouteTools;
