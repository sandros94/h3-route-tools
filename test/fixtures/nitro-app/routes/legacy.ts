import { defineHandler } from "nitro";

// A plain nitro route (no `defineRouteHandler`) — kept in the merged OpenAPI document so legacy routes
// survive a gradual migration.
export default defineHandler(() => ({ legacy: true }));
