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
        external: ["typescript"],
      },
    },
  ],
});
