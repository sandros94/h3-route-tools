import { describe, it, expect, beforeEach } from "vitest";
import { H3 } from "h3";

import { attachRegistry, getOpenAPIConfig, getRegistry, harvestRoutes } from "../src/registry.ts";
import { defineRoute, defineRouteHandler } from "../src/route-handler.ts";

const info = { title: "Test API", version: "1.0.0" };

describe("attachRegistry / getOpenAPIConfig", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  it("stamps the config and reads it back", () => {
    attachRegistry(app, { info, path: "/openapi.json" });
    expect(getOpenAPIConfig(app)).toMatchObject({ info, path: "/openapi.json" });
  });

  it("replaces a previously stamped config", () => {
    attachRegistry(app, { info });
    attachRegistry(app, { info: { title: "Other", version: "2.0.0" } });
    expect(getOpenAPIConfig(app)?.info.title).toBe("Other");
  });

  it("keeps config per-instance", () => {
    const b = new H3();
    attachRegistry(app, { info });
    expect(getOpenAPIConfig(app)).toBeDefined();
    expect(getOpenAPIConfig(b)).toBeUndefined();
  });
});

describe("harvestRoutes", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  it("collects routes mounted via defineRoute", () => {
    app.register(defineRoute({ route: "/a", get: { handler: () => "a" } }));
    app.register(defineRoute({ route: "/b", post: { handler: () => "b" } }));
    expect(harvestRoutes(app).map((r) => r.route)).toEqual(["/a", "/b"]);
  });

  it("collects a route-free handler mounted with raw app.all", () => {
    app.all("/raw", defineRouteHandler({ get: { handler: () => "x" } }));
    const harvested = harvestRoutes(app);
    expect(harvested.map((r) => r.route)).toEqual(["/raw"]);
    expect(harvested[0]?.handler["~routeDef"].get).toBeDefined();
  });

  it("ignores plain handlers that carry no ~routeDef", () => {
    app.get("/plain", () => "plain");
    expect(harvestRoutes(app)).toEqual([]);
  });

  it("returns an empty list for a fresh app", () => {
    expect(harvestRoutes(new H3())).toEqual([]);
  });
});

describe("getRegistry", () => {
  it("returns undefined when no config is stamped", () => {
    const app = new H3();
    app.register(defineRoute({ route: "/a", get: { handler: () => "a" } }));
    expect(getRegistry(app)).toBeUndefined();
  });

  it("derives info + harvested routes once configured, regardless of order", () => {
    const app = new H3();
    // Route mounted BEFORE the config is stamped — harvest is order-independent.
    app.register(defineRoute({ route: "/early", get: { handler: () => "e" } }));
    attachRegistry(app, { info });
    app.register(defineRoute({ route: "/late", post: { handler: () => "l" } }));

    const registry = getRegistry(app);
    expect(registry?.info).toEqual(info);
    expect(registry?.routes.map((r) => r.route)).toEqual(["/early", "/late"]);
  });

  it("isolates state across instances", () => {
    const a = new H3();
    const b = new H3();
    attachRegistry(a, { info: { title: "A", version: "1.0.0" } });
    attachRegistry(b, { info: { title: "B", version: "2.0.0" } });
    a.register(defineRoute({ route: "/a-only", get: { handler: () => "a" } }));

    expect(getRegistry(a)?.info.title).toBe("A");
    expect(getRegistry(b)?.info.title).toBe("B");
    expect(getRegistry(a)?.routes.map((r) => r.route)).toEqual(["/a-only"]);
    expect(getRegistry(b)?.routes).toEqual([]);
  });
});
