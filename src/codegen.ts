import ts from "typescript";
import { basename, dirname, join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";

/*
  Flatten a route type alias to a self-contained `.d.ts` straight from the app's types — no OpenAPI,
  no runtime. The checker won't evaluate a lazy mapped/generic type unless forced, so we wrap the
  alias in `__Expand` (deep, but with built-ins as terminals so `Date` etc. aren't mangled) before
  `typeToString`. `typescript` is an optional peer dep; this entry is build-time only.
*/

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

function loadProject(
  file: string,
  tsconfig?: string,
): { options: ts.CompilerOptions; rootNames: string[] } {
  const configPath = tsconfig
    ? resolve(tsconfig)
    : ts.findConfigFile(dirname(resolve(file)), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) return { options: { strict: true, noEmit: true }, rootNames: [] };
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
  // Force `.ts` imports + noEmit so the virtual flatten module resolves the target regardless of
  // the project's own resolution settings.
  const options = { ...parsed.options, noEmit: true, allowImportingTsExtensions: true };
  return { options, rootNames: parsed.fileNames };
}

function withVirtualFile(
  options: ts.CompilerOptions,
  path: string,
  content: string,
): ts.CompilerHost {
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
function findLeakedNames(dts: string, options: ts.CompilerOptions): string[] {
  const path = "__h3tr_check__.ts";
  const host = withVirtualFile(options, path, dts);
  const program = ts.createProgram([path], options, host);
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
 * @throws if the alias can't be resolved, or the result references a name not available standalone.
 *
 * @example
 * // routes.ts: export type AppRoutes = InferRoutes<typeof app>
 * const dts = generateRoutesDts({ file: "routes.ts", typeName: "AppRoutes" })
 */
export function generateRoutesDts(options: GenerateRoutesOptions): string {
  const { file, typeName, tsconfig, exportAs = typeName } = options;
  const { options: compilerOptions, rootNames } = loadProject(file, tsconfig);

  const target = resolve(file);
  const virtualPath = join(dirname(target), "__h3tr_flatten__.ts");
  const importSpec = `./${basename(target)}`;
  const content = `${EXPAND_PRELUDE}\nexport type __Flat = __Expand<import(${JSON.stringify(importSpec)}).${typeName}>;\n`;

  const host = withVirtualFile(compilerOptions, virtualPath, content);
  const program = ts.createProgram([...rootNames, target, virtualPath], compilerOptions, host);
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
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
      );
    }
  });
  if (!literal || literal === "any") {
    throw new Error(
      `generateRoutesDts: could not resolve type \`${typeName}\` exported from ${file}.`,
    );
  }

  const dts = `export type ${exportAs} = ${literal};\n`;

  const leaked = findLeakedNames(dts, compilerOptions);
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
}

/** {@link generateRoutesDts} written to `outFile`, returning the source. */
export async function writeRoutesDts(
  options: GenerateRoutesOptions & { outFile: string },
): Promise<string> {
  const dts = generateRoutesDts(options);
  await writeFile(options.outFile, dts);
  return dts;
}
