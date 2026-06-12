import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: ["./src/index.ts"],
      rolldown: {
        platform: "neutral",
      },
    },
    {
      type: "bundle",
      input: ["./src/codegen.ts"],
      rolldown: {
        platform: "node",
        external: ["typescript", "h3-route-tools"],
      },
    },
    {
      type: "bundle",
      input: ["./src/cli.ts"],
      rolldown: {
        platform: "node",
        // The CLI is a thin wrapper over the package's own entries — keep them external so it doesn't
        // re-bundle the codegen/openapi graphs.
        external: ["h3-route-tools", "h3-route-tools/codegen"],
      },
    },
  ],
});
