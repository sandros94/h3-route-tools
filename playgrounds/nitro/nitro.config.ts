import { defineConfig } from "nitro";

// Showcase: h3-route-tools in a nitro v3 app. Routes are plain file routes that export a
// `defineRouteHandler` (multi-method, self-dispatching); the `h3-route-tools/nitro` module adds the
// build-time DX (typed `$fetch`, method-lock guard, OpenAPI enrichment). `serverDir: "./"` keeps routes
// at the package root.

export default defineConfig({
  modules: ["h3-route-tools/nitro"],

  compatibilityDate: "2026-06-10",

  serverDir: "./",

  // The module enriches nitro's OpenAPI document (Scalar at /_scalar, Swagger at /_swagger) with our
  // routes' contracts, while keeping nitro's entries for plain routes (e.g. `routes/legacy.ts`).
  experimental: { openAPI: true },
  openAPI: {
    meta: { title: "h3-route-tools playground", version: "0.0.0" },
    production: "runtime",
  },
});
