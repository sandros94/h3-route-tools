import { describe, it, expect } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { H3 } from "h3";
import { z } from "zod";

import { H3Typed } from "../src/h3-typed.ts";
import { defineRoute } from "../src/route-handler.ts";
import { defineOpenAPI } from "../src/define-openapi.ts";
import { getOpenAPIDocument } from "../src/generate.ts";
import { writeOpenAPIDocument } from "../src/codegen.ts";

function configuredApp() {
  return new H3Typed({ openapi: { info: { title: "API", version: "1.0.0" } } }).route({
    route: "/posts/:id",
    params: z.object({ id: z.coerce.number() }),
    get: {
      validate: { response: z.object({ id: z.number(), title: z.string() }) },
      handler: () => ({ id: 1, title: "hello" }),
    },
  });
}

describe("getOpenAPIDocument", () => {
  it("builds a 3.1 document from a configured app's stamped config + harvested routes", () => {
    const doc = getOpenAPIDocument(configuredApp());
    expect(doc?.openapi).toBe("3.1.0");
    expect(doc?.info).toEqual({ title: "API", version: "1.0.0" });
    expect(Object.keys(doc?.paths ?? {})).toContain("/posts/{id}");
    expect(doc?.paths["/posts/{id}"]?.get).toBeDefined();
  });

  it("also reads config attached via the defineOpenAPI plugin on a plain H3", () => {
    const app = new H3();
    app.register(defineRoute({ route: "/health", get: { handler: () => ({ ok: true }) } }));
    app.register(defineOpenAPI({ info: { title: "T", version: "2.0.0" } }));
    const doc = getOpenAPIDocument(app);
    expect(doc?.info.version).toBe("2.0.0");
    expect(Object.keys(doc?.paths ?? {})).toContain("/health");
  });

  it("returns undefined when the app has no OpenAPI config", () => {
    const app = new H3();
    app.register(defineRoute({ route: "/x", get: { handler: () => "x" } }));
    expect(getOpenAPIDocument(app)).toBeUndefined();
  });

  it("is JSON-serializable for a build-time emit", () => {
    const json = JSON.stringify(getOpenAPIDocument(configuredApp()));
    expect(JSON.parse(json).openapi).toBe("3.1.0");
  });
});

describe("writeOpenAPIDocument", () => {
  it("writes the document to disk and returns it", async () => {
    const path = `${tmpdir()}/h3tr-openapi.json`;
    try {
      const returned = await writeOpenAPIDocument(configuredApp(), path);
      const onDisk = JSON.parse(await readFile(path, "utf8"));
      expect(onDisk).toEqual(returned);
      expect(onDisk.openapi).toBe("3.1.0");
      expect(Object.keys(onDisk.paths)).toContain("/posts/{id}");
    } finally {
      await rm(path, { force: true });
    }
  });

  it("honors a custom indent (0 minifies)", async () => {
    const path = `${tmpdir()}/h3tr-openapi-min.json`;
    try {
      await writeOpenAPIDocument(configuredApp(), path, { indent: 0 });
      expect(await readFile(path, "utf8")).not.toContain("\n");
    } finally {
      await rm(path, { force: true });
    }
  });

  it("throws when the app has no OpenAPI config", async () => {
    await expect(writeOpenAPIDocument(new H3(), `${tmpdir()}/h3tr-nope.json`)).rejects.toThrow(
      /no OpenAPI config/
    );
  });
});
