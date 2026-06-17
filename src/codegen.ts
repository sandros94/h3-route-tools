import type { CompilerOptions, CompilerHost } from "typescript";
import { basename, dirname, join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import type { H3 } from "h3";

import { type OpenAPIDocument, getOpenAPIDocument } from "h3-route-tools";

/*
  Build-time tooling for the `h3-route-tools/codegen` entry (Node-only, never imported at runtime):
  - generateRoutesDts / writeRoutesDts: flatten a route type alias to a self-contained `.d.ts` from the
    app's types. Loads the optional `typescript` peer on demand, so the rest of the entry needs no TS.
  - writeOpenAPIDocument: run a configured app and emit its OpenAPI document to a file.
*/

type TsModule = typeof import("typescript");

let tsModule: TsModule | undefined;
/** Load the optional `typescript` peer on first use; throws a clear error if it isn't installed. */
async function loadTypeScript(): Promise<TsModule> {
  if (!tsModule) {
    try {
      tsModule = (await import("typescript")).default;
    } catch {
      throw new Error(
        "h3-route-tools/codegen: route type-gen needs the optional peer `typescript` (e.g. `npm i -D typescript`)."
      );
    }
  }
  return tsModule;
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

/** Resolve the project's compiler options from the nearest (or given) tsconfig. */
function loadProject(ts: TsModule, file: string, tsconfig?: string): CompilerOptions {
  const configPath = tsconfig
    ? resolve(tsconfig)
    : ts.findConfigFile(dirname(resolve(file)), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) return { strict: true, noEmit: true };
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
  // Force `.ts` imports + noEmit so the virtual flatten module resolves the target regardless of
  // the project's own resolution settings.
  return { ...parsed.options, noEmit: true, allowImportingTsExtensions: true };
}

function withVirtualFile(
  ts: TsModule,
  options: CompilerOptions,
  path: string,
  content: string
): CompilerHost {
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, shouldCreate) =>
    name === path
      ? ts.createSourceFile(name, content, version, true)
      : getSourceFile(name, version, onError, shouldCreate);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === path || fileExists(name);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => (name === path ? content : readFile(name));
  return host;
}

/** Names the generated literal references that aren't resolvable standalone (leaked user types). */
function findLeakedNames(ts: TsModule, dts: string, options: CompilerOptions): string[] {
  const path = "__h3tr_check__.ts";
  // The generated dts is self-contained — it only references lib built-ins (`Date`, …), never node or
  // package types. Drop `types` so the check program skips loading `@types/node`.
  const checkOptions: CompilerOptions = { ...options, types: [] };
  const host = withVirtualFile(ts, checkOptions, path, dts);
  const program = ts.createProgram([path], checkOptions, host);
  const names = new Set<string>();
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (d.code !== 2304) continue; // TS2304: Cannot find name 'X'.
    const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    const match = text.match(/Cannot find name '(.+?)'/);
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
  const ts = await loadTypeScript();
  const compilerOptions = loadProject(ts, file, tsconfig);

  const target = resolve(file);
  const virtualPath = join(dirname(target), "__h3tr_flatten__.ts");
  const importSpec = `./${basename(target)}`;
  const content = `${EXPAND_PRELUDE}\nexport type __Flat = __Expand<import(${JSON.stringify(importSpec)}).${typeName}>;\n`;

  // The program only needs the flatten module + the target it imports — TypeScript pulls in the rest of
  // the graph (the lib + schemas) by resolution, so we don't seed it with the whole project's files.
  const host = withVirtualFile(ts, compilerOptions, virtualPath, content);
  const program = ts.createProgram([target, virtualPath], compilerOptions, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(virtualPath);
  if (!source) throw new Error("generateRoutesDts: failed to load the flatten module.");

  let literal: string | undefined;
  ts.forEachChild(source, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "__Flat") {
      const type = checker.getTypeAtLocation(node.name);
      literal = checker.typeToString(
        type,
        node,
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias
      );
    }
  });
  if (!literal || literal === "any") {
    throw new Error(
      `generateRoutesDts: could not resolve type \`${typeName}\` exported from ${file}.`
    );
  }

  const dts = `export type ${exportAs} = ${literal};\n`;

  const leaked = findLeakedNames(ts, dts, compilerOptions);
  if (leaked.length) {
    throw new Error(
      `generateRoutesDts: the result references name(s) not available standalone: ${leaked.join(", ")}. ` +
        `A schema infers to a user-defined named type — make it structural, or define the type in the output file.`
    );
  }
  if (/\bany\b/.test(literal)) {
    console.warn(
      `generateRoutesDts: some types degraded to \`any\` (usually a recursive schema — a TypeScript inference limit).`
    );
  }

  return dts;
}

/** {@link generateRoutesDts} written to `outFile`, returning the source. */
export async function writeRoutesDts(
  options: GenerateRoutesOptions & { outFile: string }
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
  options: WriteOpenAPIOptions = {}
): Promise<OpenAPIDocument> {
  const doc = getOpenAPIDocument(app);
  if (!doc) {
    throw new TypeError(
      "writeOpenAPIDocument: app has no OpenAPI config — call defineOpenAPI or pass `openapi` to H3Typed."
    );
  }
  await writeFile(path, JSON.stringify(doc, null, options.indent ?? 2));
  return doc;
}
