import { describe, it, expect, expectTypeOf } from "vitest";
import { resolve } from "node:path";
import { z } from "zod";
import type { NitroTypes } from "nitro/types";

import { defineRouteHandler } from "../src/route-handler.ts";
import { extendRouteTypes, type NitroMethodsOf } from "../src/nitro.ts";

describe("NitroMethodsOf — RouteHandler → nitro InternalApi value", () => {
  const handler = defineRouteHandler({
    get: {
      validate: { response: z.object({ id: z.number(), when: z.date() }) },
      handler: () => ({ id: 1, when: new Date(0) }),
    },
    post: {
      validate: { response: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    },
  });

  it("maps each declared method to its response, Serialized (Date → string over the wire)", () => {
    expectTypeOf<NitroMethodsOf<typeof handler>["get"]>().toEqualTypeOf<{
      id: number;
      when: string;
    }>();
    expectTypeOf<NitroMethodsOf<typeof handler>["post"]>().toEqualTypeOf<{ ok: boolean }>();
    expectTypeOf<keyof NitroMethodsOf<typeof handler>>().toEqualTypeOf<"get" | "post">();
  });

  it("is never for a non-RouteHandler", () => {
    expectTypeOf<NitroMethodsOf<() => string>>().toEqualTypeOf<never>();
  });
});

describe("extendRouteTypes — rewrites our routes' generated InternalApi entries", () => {
  const typesDir = resolve("test/fixtures");
  // Mirrors nitro's auto-generated `default` entry (the self-dispatcher's ReturnType).
  const nitroEntry = (spec: string): NitroTypes["routes"][string] => ({
    default: [`Simplify<Serialize<Awaited<ReturnType<typeof import('${spec}').default>>>>`],
  });

  it("replaces our route's `default` with one NitroMethodsOf entry per declared method", async () => {
    const routes: NitroTypes["routes"] = { "/posts/:id": nitroEntry("./nitro-route") };
    await extendRouteTypes(routes, typesDir);

    // Runtime method keys are lowercase (what `$fetch` looks up); read them case-agnostically.
    const byMethod = Object.fromEntries(
      Object.entries(routes["/posts/:id"] ?? {}).map(([method, strings]) => [method, strings?.[0]]),
    );
    expect(Object.keys(byMethod).sort()).toEqual(["get", "post"]);
    expect(byMethod.get).toBe(
      `import("h3-route-tools/nitro").NitroMethodsOf<typeof import('./nitro-route').default>['get']`,
    );
    expect(byMethod.post).toBe(
      `import("h3-route-tools/nitro").NitroMethodsOf<typeof import('./nitro-route').default>['post']`,
    );
    expect(byMethod.default).toBeUndefined();
  });

  it("leaves a non-h3-route-tools handler untouched (no `~routeDef`)", async () => {
    const routes: NitroTypes["routes"] = { "/plain": nitroEntry("./nitro-plain") };
    const before = structuredClone(routes);
    await extendRouteTypes(routes, typesDir);
    expect(routes).toEqual(before);
  });

  it("leaves a route whose module can't be imported untouched", async () => {
    const routes: NitroTypes["routes"] = { "/missing": nitroEntry("./does-not-exist") };
    const before = structuredClone(routes);
    await extendRouteTypes(routes, typesDir);
    expect(routes).toEqual(before);
  });

  it("skips a route with no `default` type string", async () => {
    const routes: NitroTypes["routes"] = { "/x": {} };
    await extendRouteTypes(routes, typesDir);
    expect(routes["/x"]).toEqual({});
  });
});

describe("extendRouteTypes — method-locked files (`*.get.ts`)", () => {
  const typesDir = resolve("test/fixtures");
  // Mirrors nitro's generated entry for a method-locked file: keyed by the locked method, not `default`.
  const lockedEntry = (method: string, spec: string): Record<string, string[]> => ({
    [method]: [`Simplify<Serialize<Awaited<ReturnType<typeof import('${spec}').default>>>>`],
  });

  it("types a valid single-method locked file from its contract", async () => {
    const routes: NitroTypes["routes"] = { "/posts": lockedEntry("get", "./nitro-route-get") };
    await extendRouteTypes(routes, typesDir);

    const byMethod = Object.fromEntries(
      Object.entries(routes["/posts"] ?? {}).map(([method, strings]) => [method, strings?.[0]]),
    );
    expect(Object.keys(byMethod)).toEqual(["get"]);
    expect(byMethod.get).toBe(
      `import("h3-route-tools/nitro").NitroMethodsOf<typeof import('./nitro-route-get').default>['get']`,
    );
  });

  it("throws when a locked file declares extra methods (silently unreachable)", async () => {
    // nitro-route declares get + post; a `*.get.ts` file would only ever route GET.
    const routes: NitroTypes["routes"] = { "/posts": lockedEntry("get", "./nitro-route") };
    await expect(extendRouteTypes(routes, typesDir)).rejects.toThrow(
      /locked to GET .* declares: get, post/s,
    );
  });

  it("throws when a locked file's single method mismatches the filename", async () => {
    // nitro-route-get declares only get, but sits in a `*.post.ts` file.
    const routes: NitroTypes["routes"] = { "/posts": lockedEntry("post", "./nitro-route-get") };
    await expect(extendRouteTypes(routes, typesDir)).rejects.toThrow(
      /locked to POST .* declares: get/s,
    );
  });

  it("leaves a non-h3-route-tools locked handler untouched", async () => {
    const routes: NitroTypes["routes"] = { "/plain": lockedEntry("get", "./nitro-plain") };
    const before = structuredClone(routes);
    await extendRouteTypes(routes, typesDir);
    expect(routes).toEqual(before);
  });

  it("leaves a locked route whose module can't be imported untouched", async () => {
    const routes: NitroTypes["routes"] = { "/missing": lockedEntry("get", "./does-not-exist") };
    const before = structuredClone(routes);
    await extendRouteTypes(routes, typesDir);
    expect(routes).toEqual(before);
  });
});
