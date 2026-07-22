import { dirname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { H3 } from "h3";

import { type OpenAPIDocument, getOpenAPIDocument } from "h3-route-tools/openapi";

/*
  Build-time tooling for the `h3-route-tools/codegen` entry (Node-only, never imported at runtime):
  - generateRoutesDts / writeRoutesDts: flatten a route type alias to a self-contained `.d.ts` from the
    app's types. Loads the optional `typescript` peer on demand, so the rest of the entry needs no TS.
  - writeOpenAPIDocument: run a configured app and emit its OpenAPI document to a file.

  TypeScript 7 (the Go port) dropped the in-process compiler API: the checker now lives in the `tsgo`
  binary, reachable only via the `typescript/unstable/*` client. We drive it here — spawn an API server,
  overlay the sources through a virtual filesystem, and query the checker over the real project.
*/

type TsAsync = typeof import("typescript/unstable/async");
type TsAst = typeof import("typescript/unstable/ast");

let tsModules: { async: TsAsync; ast: TsAst } | undefined;
/** Load the optional `typescript` peer on first use; throws a clear error if it isn't installed. */
async function loadTypeScript(): Promise<{ async: TsAsync; ast: TsAst }> {
  if (!tsModules) {
    try {
      const [async, ast] = await Promise.all([
        import("typescript/unstable/async"),
        import("typescript/unstable/ast"),
      ]);
      tsModules = { async, ast };
    } catch {
      throw new Error(
        "h3-route-tools/codegen: route type-gen needs the optional peer `typescript` (e.g. `npm i -D typescript`).",
      );
    }
  }
  return tsModules;
}

/** Walk up from `dir` to the nearest `tsconfig.json`, or `undefined` if none exists above it. */
function findNearestTsconfig(dir: string): string | undefined {
  let current = dir;
  for (;;) {
    const candidate = join(current, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * A transient tsconfig that inherits the app's real config (for its `lib`, `target`, `strict`, and
 * module-resolution settings) but scopes the program to `files` and overlays the given options.
 * With no base config it falls back to a strict standalone program.
 */
function virtualTsconfig(
  base: string | undefined,
  compilerOptions: Record<string, unknown>,
  files: string[],
): string {
  return JSON.stringify({
    ...(base ? { extends: base } : {}),
    compilerOptions: { ...(base ? {} : { strict: true }), ...compilerOptions },
    files,
    include: [],
  });
}

/** A partial virtual filesystem over `overlays`; unknown paths fall back to the real disk. */
function overlayFileSystem(overlays: Record<string, string>) {
  return {
    readFile: (name: string) => (name in overlays ? overlays[name] : undefined),
    fileExists: (name: string) => (name in overlays ? true : undefined),
  };
}

// The checker won't evaluate a lazy mapped/generic type unless forced, so the alias is wrapped in
// `__Expand` (deep, with built-ins as terminals so `Date` etc. aren't mangled) before `typeToString`.
const EXPAND_PRELUDE = `
type __BuiltIn = Date | RegExp | Error | URL | Map<unknown, unknown> | Set<unknown> | Promise<unknown> | ArrayBuffer | ArrayBufferView;
type __Expand<T> = T extends __BuiltIn
  ? T
  : T extends (...a: never[]) => unknown
    ? T
    : T extends object
      ? { [K in keyof T]: __Expand<T[K]> }
      : T;
`;

/** Options for {@link generateRoutesDts} / {@link writeRoutesDts}. */
export interface GenerateRoutesOptions {
  /** A `.ts` file exporting the route type alias, e.g. `export type AppRoutes = InferRoutes<typeof app>`. */
  file: string;
  /** Name of the exported type alias to flatten. */
  typeName: string;
  /** tsconfig used to resolve the program. Defaults to the nearest `tsconfig.json` to `file`. */
  tsconfig?: string;
  /** Name of the emitted type. Defaults to `typeName`. */
  exportAs?: string;
}

/** Names the generated literal references that aren't resolvable standalone (leaked user types). */
async function findLeakedNames(
  api: InstanceType<TsAsync["API"]>,
  base: string | undefined,
  overlays: Record<string, string>,
  checkFile: string,
  checkTsconfig: string,
  dts: string,
): Promise<string[]> {
  // The generated dts is self-contained — it only references lib built-ins (`Date`, …), never node or
  // package types. Drop `types` so the check program skips loading `@types/node`.
  overlays[checkFile] = dts;
  overlays[checkTsconfig] = virtualTsconfig(base, { noEmit: true, types: [] }, [checkFile]);
  const snapshot = await api.updateSnapshot({
    openProjects: [checkTsconfig],
    fileChanges: { created: [checkFile, checkTsconfig] },
  });
  const project = snapshot.getProject(checkTsconfig);
  if (!project) return [];
  const names = new Set<string>();
  for (const d of await project.program.getSemanticDiagnostics()) {
    if (d.code !== 2304) continue; // TS2304: Cannot find name 'X'.
    const match = d.text.match(/Cannot find name '(.+?)'/);
    if (match) names.add(match[1]!);
  }
  return [...names];
}

/**
 * Resolve and flatten the route type alias `typeName` exported from `file` into a self-contained,
 * import-free `.d.ts` source string. Built-ins (`Date`, `Map`, …) are kept as-is; a schema that
 * infers to a user-defined *named* type (via `z.custom`/brand) can't be inlined and throws.
 *
 * Loads the optional `typescript` peer on first call.
 *
 * @throws if `typescript` is missing, the alias can't be resolved, or the result references a name
 * not available standalone.
 *
 * @example
 * // routes.ts: export type AppRoutes = InferRoutes<typeof app>
 * const dts = await generateRoutesDts({ file: "routes.ts", typeName: "AppRoutes" })
 */
export async function generateRoutesDts(options: GenerateRoutesOptions): Promise<string> {
  const { file, typeName, tsconfig, exportAs = typeName } = options;
  const { async: ts, ast } = await loadTypeScript();

  const target = resolve(file);
  const dir = dirname(target);
  const base = tsconfig ? resolve(tsconfig) : findNearestTsconfig(dir);
  const flattenTsconfig = join(dir, "__h3tr_flatten.tsconfig.json");
  const checkFile = join(dir, "__h3tr_check__.ts");
  const checkTsconfig = join(dir, "__h3tr_check.tsconfig.json");

  // Append the flatten alias to a copy of the source module so `typeName` resolves in its own scope —
  // no cross-file import, so the target's real config (module resolution, lib) applies unchanged. The
  // program roots at the overlaid target; TypeScript pulls in the rest of the graph (lib + schemas).
  const original = await readFile(target, "utf8");
  const overlays: Record<string, string> = {
    [target]: `${original}\n${EXPAND_PRELUDE}\nexport type __Flat = __Expand<${typeName}>;\n`,
    [flattenTsconfig]: virtualTsconfig(base, { noEmit: true }, [target]),
  };

  const api = new ts.API({ fs: overlayFileSystem(overlays), cwd: dir });
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [flattenTsconfig] });
    const project = snapshot.getProject(flattenTsconfig);
    if (!project) throw new Error("generateRoutesDts: failed to load the flatten project.");
    const source = await project.program.getSourceFile(target);
    if (!source) throw new Error("generateRoutesDts: failed to load the flatten module.");

    let literal: string | undefined;
    for (const node of source.statements) {
      if (ast.isTypeAliasDeclaration(node) && node.name.text === "__Flat") {
        const type = await project.checker.getTypeAtLocation(node.name);
        if (type) {
          literal = await project.checker.typeToString(
            type,
            node,
            ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias,
          );
        }
        break;
      }
    }
    if (!literal || literal === "any") {
      throw new Error(
        `generateRoutesDts: could not resolve type \`${typeName}\` exported from ${file}.`,
      );
    }

    const dts = `export type ${exportAs} = ${literal};\n`;

    const leaked = await findLeakedNames(api, base, overlays, checkFile, checkTsconfig, dts);
    if (leaked.length) {
      throw new Error(
        `generateRoutesDts: the result references name(s) not available standalone: ${leaked.join(", ")}. ` +
          `A schema infers to a user-defined named type — make it structural, or define the type in the output file.`,
      );
    }
    if (/\bany\b/.test(literal)) {
      console.warn(
        `generateRoutesDts: some types degraded to \`any\` (usually a recursive schema — a TypeScript inference limit).`,
      );
    }

    return dts;
  } finally {
    await api.close();
  }
}

/** {@link generateRoutesDts} written to `outFile`, returning the source. */
export async function writeRoutesDts(
  options: GenerateRoutesOptions & { outFile: string },
): Promise<string> {
  const dts = await generateRoutesDts(options);
  await writeFile(options.outFile, dts);
  return dts;
}

/** Options for {@link writeOpenAPIDocument}. */
export interface WriteOpenAPIOptions {
  /** JSON indentation. Default `2`; pass `0` to minify. */
  indent?: number;
}

/**
 * Build the app's OpenAPI document (see `getOpenAPIDocument`) and write it to `path`, returning it.
 * Runs the app, so import a built/configured app instance.
 *
 * @throws {TypeError} if the app has no OpenAPI config.
 *
 * @example
 * import { app } from "../server"
 * await writeOpenAPIDocument(app, "openapi.json")
 */
export async function writeOpenAPIDocument(
  app: H3,
  path: string,
  options: WriteOpenAPIOptions = {},
): Promise<OpenAPIDocument> {
  const doc = getOpenAPIDocument(app);
  if (!doc) {
    throw new TypeError(
      "writeOpenAPIDocument: app has no OpenAPI config — call defineOpenAPI or pass `openapi` to H3Typed.",
    );
  }
  await writeFile(path, JSON.stringify(doc, null, options.indent ?? 2));
  return doc;
}
