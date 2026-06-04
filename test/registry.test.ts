import { describe, it, expect, beforeEach } from "vitest";
import { H3 } from "h3";

import { addRoute, attachRegistry, getRegistry, type RegisteredRoute } from "../src/registry.ts";

const info = { title: "Test API", version: "1.0.0" };

function route(path: string): RegisteredRoute {
  return { route: path, handler: { "~routeDef": { get: { validate: {} } } } };
}

describe("attachRegistry", () => {
  let app: H3;

  beforeEach(() => {
    app = new H3();
  });

  it("creates an empty registry carrying the given info and attaches it", () => {
    const registry = attachRegistry(app, { info });
    expect(registry.info).toEqual(info);
    expect(registry.routes).toEqual([]);
    expect(getRegistry(app)).toBe(registry);
  });

  it("replaces a previously attached registry", () => {
    const first = attachRegistry(app, { info });
    const second = attachRegistry(app, { info: { title: "Other", version: "2.0.0" } });
    expect(first).not.toBe(second);
    expect(getRegistry(app)).toBe(second);
  });

  it("keeps registries per-instance", () => {
    const a = new H3();
    const b = new H3();
    attachRegistry(a, { info });
    expect(getRegistry(a)).toBeDefined();
    expect(getRegistry(b)).toBeUndefined();
  });

  it("isolates distinct registries across multiple app instances", () => {
    const a = new H3();
    const b = new H3();
    const ra = attachRegistry(a, { info: { title: "A", version: "1.0.0" } });
    const rb = attachRegistry(b, { info: { title: "B", version: "2.0.0" } });

    addRoute(ra, route("/a-only"));
    addRoute(rb, route("/b-1"));
    addRoute(rb, route("/b-2"));

    expect(getRegistry(a)).toBe(ra);
    expect(getRegistry(b)).toBe(rb);
    expect(getRegistry(a)).not.toBe(getRegistry(b));
    expect(getRegistry(a)?.info.title).toBe("A");
    expect(getRegistry(b)?.info.title).toBe("B");
    expect(getRegistry(a)?.routes.map((r) => r.route)).toEqual(["/a-only"]);
    expect(getRegistry(b)?.routes.map((r) => r.route)).toEqual(["/b-1", "/b-2"]);
  });
});

describe("getRegistry", () => {
  it("returns undefined when no registry is attached", () => {
    expect(getRegistry(new H3())).toBeUndefined();
  });
});

describe("addRoute", () => {
  it("appends route bindings in order", () => {
    const registry = attachRegistry(new H3(), { info });
    addRoute(registry, route("/a"));
    addRoute(registry, route("/b"));
    expect(registry.routes.map((r) => r.route)).toEqual(["/a", "/b"]);
  });

  it("is observable through the attached instance", () => {
    const app = new H3();
    const registry = attachRegistry(app, { info });
    addRoute(registry, route("/users"));
    expect(getRegistry(app)?.routes).toHaveLength(1);
  });
});
