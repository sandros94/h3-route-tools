import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const PLAYGROUND = resolve(__dirname, "../playgrounds/nitro");
const NITRO = resolve(__dirname, "../node_modules/.bin/nitro");
const TSGO = resolve(__dirname, "../node_modules/.bin/tsgo");
const POSTS = `typeof import('../../../routes/posts/[id]').default`;

// Assumes the workspace is stubbed (`pnpm stub` / CI `build --stub`) so `h3-route-tools/nitro` → src.
describe("nitro e2e — generated InternalApi + typed $fetch", () => {
  let dts: string;
  beforeAll(() => {
    execFileSync(NITRO, ["prepare"], { cwd: PLAYGROUND, stdio: "pipe", timeout: 120_000 });
    dts = readFileSync(resolve(PLAYGROUND, "node_modules/.nitro/types/nitro-routes.d.ts"), "utf8");
  }, 120_000);

  it("emits per-method NitroMethodsOf entries for our multi-method route", () => {
    expect(dts).toContain(`'get': import("h3-route-tools/nitro").NitroMethodsOf<${POSTS}>['get']`);
    expect(dts).toContain(
      `'post': import("h3-route-tools/nitro").NitroMethodsOf<${POSTS}>['post']`,
    );
    expect(dts).toContain(
      `'delete': import("h3-route-tools/nitro").NitroMethodsOf<${POSTS}>['delete']`,
    );
  });

  it("replaces nitro's `default` ReturnType entry for our routes", () => {
    expect(dts).not.toContain(`'default': Simplify<Serialize<Awaited<ReturnType<${POSTS}`);
  });

  // Unbiased: typecheck a transient file that uses nitro's OWN `$Fetch` over the real augmentation. A
  // wrong / `any` / missing-method augmentation makes tsgo fail (the `@ts-expect-error` guards `any`).
  it("types nitro's $fetch from our route contracts", () => {
    const checkFile = resolve(PLAYGROUND, ".fetch-check.ts");
    const checkTsconfig = resolve(PLAYGROUND, ".fetch-check.tsconfig.json");
    writeFileSync(
      checkFile,
      [
        `/// <reference path="./node_modules/.nitro/types/nitro-routes.d.ts" />`,
        `import type { $Fetch } from "nitro/types";`,
        `declare const $fetch: $Fetch;`,
        `export async function check() {`,
        `  const post = await $fetch("/posts/5");`,
        `  post.id satisfies number;`,
        `  post.title satisfies string;`,
        `  post.when satisfies string;`,
        `  const created = await $fetch("/posts/5", { method: "post" });`,
        `  created.tagCount satisfies number;`,
        `  const health = await $fetch("/health");`,
        `  health.ok satisfies boolean;`,
        `  // @ts-expect-error \`nope\` is not on the typed response (fails if the augmentation is \`any\`)`,
        `  return { nope: post.nope };`,
        `}`,
      ].join("\n"),
    );
    writeFileSync(
      checkTsconfig,
      JSON.stringify({
        extends: "nitro/tsconfig",
        compilerOptions: { types: [], noEmit: true },
        include: [".fetch-check.ts"],
      }),
    );
    try {
      execFileSync(TSGO, ["-p", checkTsconfig], {
        cwd: PLAYGROUND,
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch (error) {
      const out = (error as { stdout?: Buffer }).stdout?.toString() ?? String(error);
      throw new Error(`$fetch typecheck failed (typed-fetch regressed):\n${out}`);
    } finally {
      rmSync(checkFile, { force: true });
      rmSync(checkTsconfig, { force: true });
    }
  });
});

describe("nitro e2e — runtime (built server serves our routes)", () => {
  const PORT = 3998;
  const base = `http://127.0.0.1:${PORT}`;
  let server: ChildProcess;

  beforeAll(async () => {
    execFileSync(NITRO, ["build"], { cwd: PLAYGROUND, stdio: "pipe", timeout: 120_000 });
    server = spawn("node", [resolve(PLAYGROUND, ".output/server/index.mjs")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "pipe",
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/health`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("nitro server did not start");
  }, 120_000);

  afterAll(() => {
    server?.kill();
  });

  it("GET /posts/:id returns the validated response (matches the typed contract)", async () => {
    const res = await fetch(`${base}/posts/7`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, title: "Hello", when: "1970-01-01T00:00:00.000Z" });
  });

  it("POST /posts/:id runs the body transform (input ≠ output)", async () => {
    const res = await fetch(`${base}/posts/2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", tags: "a,b,c" }),
    });
    expect(await res.json()).toEqual({ id: 2, tagCount: 3 });
  });

  it("DELETE /posts/:id returns its validated response", async () => {
    const res = await fetch(`${base}/posts/3`, { method: "DELETE" });
    expect(await res.json()).toEqual({ deleted: true });
  });

  it("400s on an invalid param", async () => {
    expect((await fetch(`${base}/posts/abc`)).status).toBe(400);
  });

  it("GET /health", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
  });
});

// Runs last + cleans up in `finally`: a stray route file would break the other describes' prepare/build.
describe("nitro e2e — method-lock build check", () => {
  it("fails `nitro prepare` when a method-locked file declares extra methods", () => {
    const badRoute = resolve(PLAYGROUND, "routes/__method-lock-check.get.ts");
    writeFileSync(
      badRoute,
      [
        `import { defineRouteHandler } from "h3-route-tools";`,
        `import * as v from "valibot";`,
        `export default defineRouteHandler({`,
        `  get: { validate: { response: v.object({ a: v.string() }) }, handler: () => ({ a: "x" }) },`,
        `  post: { validate: { response: v.object({ b: v.number() }) }, handler: () => ({ b: 1 }) },`,
        `});`,
      ].join("\n"),
    );
    try {
      let error: { stdout?: Buffer; stderr?: Buffer } | undefined;
      try {
        execFileSync(NITRO, ["prepare"], { cwd: PLAYGROUND, stdio: "pipe", timeout: 120_000 });
      } catch (e) {
        error = e as { stdout?: Buffer; stderr?: Buffer };
      }
      expect(error, "nitro prepare should have failed").toBeDefined();
      const output = `${error?.stdout?.toString() ?? ""}${error?.stderr?.toString() ?? ""}`;
      expect(output).toMatch(/method-locked route file/);
      expect(output).toMatch(/__method-lock-check\.get.*declares: get, post/s);
    } finally {
      rmSync(badRoute, { force: true });
    }
  }, 120_000);
});
