#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";

import { generateRoutesDts, writeRoutesDts, writeOpenAPIDocument } from "h3-route-tools/codegen";
import { getOpenAPIDocument } from "h3-route-tools";

const HELP = `h3-route-tools — route type-gen & OpenAPI emit

Usage
  h3-route-tools types   --file <routes.ts> --type <Name> [--out <file.d.ts>]
  h3-route-tools openapi --app <app.ts> [--out <file.json>]

Commands
  types     Flatten a route type alias to a self-contained .d.ts (reads source; no app run).
  openapi   Build the OpenAPI document from a configured app (runs the app).

types options
  -f, --file <path>       .ts file exporting the route alias, e.g. InferRoutes<typeof app>
  -t, --type <Name>       the exported type alias to flatten
  -o, --out <path>        write the .d.ts (default: stdout)
      --tsconfig <path>   tsconfig to resolve (default: nearest to --file)
      --export-as <Name>  emitted type name (default: --type)

openapi options
  -a, --app <path>        module exporting the app (a named \`app\` export or the default export)
  -o, --out <path>        write the .json (default: stdout)
  -e, --export <name>     named export to use as the app
      --indent <n>        JSON indent (default 2; 0 minifies)

A TypeScript --app must run under a loader (it is executed), e.g.
  node --import jiti/register node_modules/h3-route-tools/dist/cli.mjs openapi --app ./src/app.ts --out openapi.json
or point --app at a built .mjs, or use a runtime with native TypeScript (Node >=24, Bun, Deno).`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function runTypes(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: "string", short: "f" },
      type: { type: "string", short: "t" },
      out: { type: "string", short: "o" },
      tsconfig: { type: "string" },
      "export-as": { type: "string" },
    },
  });
  if (!values.file || !values.type) fail("types: --file and --type are required (see --help).");

  const opts = {
    file: values.file,
    typeName: values.type,
    tsconfig: values.tsconfig,
    exportAs: values["export-as"],
  };
  if (values.out) {
    await writeRoutesDts({ ...opts, outFile: values.out });
    console.error(`Wrote ${values.out}`);
  } else {
    process.stdout.write(await generateRoutesDts(opts));
  }
}

async function loadApp(path: string, exportName?: string): Promise<unknown> {
  let mod: Record<string, unknown>;
  try {
    mod = await import(resolve(path));
  } catch (cause) {
    throw new Error(
      `openapi: failed to import ${path}. If it is TypeScript, run under a loader ` +
        `(e.g. \`node --import jiti/register …\`) or point --app at a built .mjs.`,
      { cause }
    );
  }
  const app = exportName ? mod[exportName] : (mod.app ?? mod.default);
  if (!app) {
    fail(
      `openapi: no app found in ${path} (looked for a \`app\` or default export; use --export <name>).`
    );
  }
  return app;
}

async function runOpenAPI(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      app: { type: "string", short: "a" },
      out: { type: "string", short: "o" },
      export: { type: "string", short: "e" },
      indent: { type: "string" },
    },
  });
  if (!values.app) fail("openapi: --app is required (see --help).");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = (await loadApp(values.app, values.export)) as any;
  const indent = values.indent === undefined ? undefined : Number(values.indent);
  if (values.out) {
    await writeOpenAPIDocument(app, values.out, { indent });
    console.error(`Wrote ${values.out}`);
  } else {
    const doc = getOpenAPIDocument(app);
    if (!doc)
      fail("openapi: the app has no OpenAPI config (defineOpenAPI / new H3Typed({ openapi })).");
    process.stdout.write(`${JSON.stringify(doc, null, indent ?? 2)}\n`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "types":
      return runTypes(rest);
    case "openapi":
      return runOpenAPI(rest);
    case "-h":
    case "--help":
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
