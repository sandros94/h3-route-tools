import { defineConfig } from "nitro";

// Showcase: h3-route-tools in a nitro v3 app. Routes are plain file routes that export a
// `defineRouteHandler` (multi-method, self-dispatching); the `h3-route-tools/nitro` module adds the
// build-time DX (typed `$fetch`, method-lock guard). `serverDir: "./"` keeps routes at the package root.

export default defineConfig({
  modules: ["h3-route-tools/nitro"],

  compatibilityDate: "2026-06-10",

  serverDir: "./",
});
