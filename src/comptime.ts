import { w } from "w";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import MagicString from "magic-string";
import * as ts from "typescript";
import { formatSourceError } from "./formatSourceError.ts";
import { box, COMPTIME_ERRORS, type ComptimeError, getErr } from "./errors.ts";
import { format } from "node:util";
import { getModuleResolver, type ModuleResolver } from "./resolve.ts";

export interface ComptimeFunction {
	name: string;
	fn: (...args: unknown[]) => unknown;
	start: number;
	end: number;
}
export interface Replacement {
	start: number;
	end: number;
	replacement: string;
}

export type Replacements = Record<string, Replacement[]>;

// Using a custom tsconfig for eval block to avoid extra transformations
const evalBlockTsConfig = {
	compilerOptions: {
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		target: ts.ScriptTarget.ESNext,
		verbatimModuleSyntax: true,
		noEmitOnError: true,
	},
};

export function assertNoSyntaxErrors(tsCode: string) {
	const fileName = "eval.ts";
	const host = ts.createCompilerHost(evalBlockTsConfig.compilerOptions);
	host.getSourceFile = (fileName_, languageVersion) =>
		fileName_ === fileName
			? ts.createSourceFile(fileName, tsCode, languageVersion, true, ts.ScriptKind.TS)
			: undefined;

	const program = ts.createProgram([fileName], evalBlockTsConfig.compilerOptions, host);
	const diagnostics = program.getSyntacticDiagnostics();

	if (diagnostics.length > 0) {
		throw new Error(ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, "\n"));
	}
}

export function eraseTypes(tsCode: string): string {
	return ts.transpileModule(tsCode, evalBlockTsConfig).outputText.trim();
}

export function query<R extends ts.Node>(root: ts.Node, query: ts.SyntaxKind, filter?: (node: R) => boolean): R[] {
	const results: R[] = [];
	const visit = (node: ts.Node) => {
		if (node.kind === query) {
			const n = node as R;
			if (filter) {
				if (filter(n)) results.push(n);
			} else results.push(n);
		}
		ts.forEachChild(node, visit);
	};
	visit(root);
	return results;
}

export function getEnclosingImportDeclaration(node: ts.Node): ts.ImportDeclaration {
	while (node && !ts.isImportDeclaration(node)) node = node.parent!;
	return node;
}

export function getEnclosingStatement(node: ts.Node): ts.Statement {
	while (node && !ts.isStatement(node)) node = node.parent!;
	return node as ts.Statement;
}

type ImportNode = ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport;
type DeclarationNode = ts.Statement | ImportNode;

export const isImportNode = (node: ts.Node): node is ImportNode =>
	ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || (ts.isImportClause(node) && Boolean(node.name));

function recursivelyGetIdentifierDeclarations(
	seen: Set<DeclarationNode>,
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	idn: ts.Identifier,
): DeclarationNode[] {
	const decls = checker.getSymbolAtLocation(idn)?.declarations;
	if (!decls) return [];

	return decls
		.filter(decl => {
			const declFile = decl.getSourceFile();
			// remove ambient declaration files (d.ts)
			if (declFile.isDeclarationFile) return false;
			// avoid recursing into other files
			if (declFile.fileName !== sourceFile.fileName) return false;

			const allowed =
				ts.isVariableDeclaration(decl) ||
				ts.isFunctionDeclaration(decl) ||
				ts.isClassDeclaration(decl) ||
				ts.isEnumDeclaration(decl) ||
				isImportNode(decl);

			if (!allowed) return false;

			// remove declare statements
			if ("modifiers" in decl && decl.modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) return false;
			if (ts.isInterfaceDeclaration(decl)) return false;
			if (ts.isTypeAliasDeclaration(decl)) return false;
			if (ts.isTypeLiteralNode(decl)) return false;
			if (ts.isTypeParameterDeclaration(decl)) return false;

			return true;
		})
		.flatMap(each => {
			if (isImportNode(each)) {
				if ("isTypeOnly" in each && each.isTypeOnly) return [];
				if (seen.has(each)) return [];
				seen.add(each);
				return [each];
			}

			/*
				Find the statement that contains the current declaration.

				Example, with the following code:
				const func = () => void 0;

				`each` here would just be `func = () => void 0`,
				but we want to return the entire statement.
			*/
			const enclosingStatement = getEnclosingStatement(each);

			if (seen.has(enclosingStatement)) return [];
			seen.add(enclosingStatement);

			const nested = query<ts.Identifier>(enclosingStatement, ts.SyntaxKind.Identifier, idn => {
				const parent = idn.parent;
				// filter identifiers that are right hand side of a property access expression
				return parent && ts.isPropertyAccessExpression(parent) && parent.name === idn;
			});

			return nested
				.flatMap(idn => recursivelyGetIdentifierDeclarations(seen, checker, sourceFile, idn))
				.concat(enclosingStatement);
		});
}

const getImportLine = async (
	resolver: ModuleResolver,
	imp: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport,
) => {
	const decl = getEnclosingImportDeclaration(imp);
	const specifier = decl.moduleSpecifier.getText().slice(1, -1);

	const importer = decl.getSourceFile().fileName;
	const importPath = await resolver(specifier, importer);
	if (!importPath) throw new Error("Could not resolve module: " + specifier + " from " + importer);

	if (ts.isImportSpecifier(imp)) {
		// Named import: import { foo } from ... or import { foo as bar } from ...
		const imported = imp.propertyName ? imp.propertyName.getText() : imp.name.getText();
		const local = imp.name.getText();
		const binding = imported === local ? local : `${imported}: ${local}`;
		return `const { ${binding} } = await import("${importPath}");`;
	} else if (ts.isNamespaceImport(imp)) {
		// Namespace import: import * as foo from ...
		return `const ${imp.name.getText()} = await import("${importPath}");`;
	} else if (ts.isImportClause(imp) && imp.name) {
		// Default import: import foo from ...
		return `const { default: ${imp.name.getText()} } = await import("${importPath}");`;
	}
	throw new Error("Unsupported import type for comptime evaluation.");
};

function stripExportModifier(node: ts.Statement): string {
	let text = node.getText();

	const modifiers = ("modifiers" in node && node.modifiers ? node.modifiers : undefined) as
		| ts.NodeArray<ts.ModifierLike>
		| undefined;

	if (!modifiers?.length) return text;

	const bounds = modifiers
		.filter(m => m.kind === ts.SyntaxKind.ExportKeyword)
		.map(m => ({ start: m.getStart(), end: m.getEnd() }))
		.sort((a, b) => a.start - b.start);

	if (!bounds.length) return text;

	const stmtStart = node.getStart();
	const start = bounds.at(0)!.start - stmtStart;
	const end = bounds.at(-1)!.end - stmtStart;

	return text.slice(0, start) + text.slice(end).trim();
}

async function getEvaluation(
	resolver: ModuleResolver,
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	node: ts.Node,
) {
	const identifiers = query<ts.Identifier>(node, ts.SyntaxKind.Identifier);
	const seen = new Set<DeclarationNode>();
	const decls = identifiers.flatMap(idn => recursivelyGetIdentifierDeclarations(seen, checker, sourceFile, idn));

	const sorted = decls.sort((a, b) => {
		const x = sourceFile.getLineAndCharacterOfPosition(a.getStart(sourceFile));
		const y = sourceFile.getLineAndCharacterOfPosition(b.getStart(sourceFile));
		return x.line - y.line;
	});

	const declLines = await Promise.all(
		sorted.map(each => (isImportNode(each) ? getImportLine(resolver, each) : stripExportModifier(each))),
	);

	let evalProgram = "";
	for (const line of declLines) evalProgram += "  " + line + "\n";
	evalProgram += "  return " + node.getText();
	return evalProgram;
}

function isNodeModules(filePath: string): boolean {
	return filePath.split(path.sep).includes("node_modules");
}

interface BaseConfig {
	resolver?: ModuleResolver;
}

interface ConfigByConfig extends BaseConfig {
	rootDir: string;
	tsconfig: ts.CompilerOptions;
	tsConfigPath?: never;
}

interface ConfigByPath extends BaseConfig {
	rootDir?: never;
	tsconfig?: never;
	tsconfigPath: string;
}

interface ConfigByImplicitConfig extends BaseConfig {
	rootDir?: never;
	tsconfig?: never;
	tsconfigPath?: never;
}

type Filterable<T> = T & { filter?: (id: string) => boolean };

export type GetComptimeReplacementsOpts = ConfigByConfig | ConfigByPath | ConfigByImplicitConfig;

function getTsConfig(opts?: GetComptimeReplacementsOpts): { configDir: string; tsConfig: ts.CompilerOptions } {
	if (opts?.tsconfig) {
		// explicitly passed tsconfig and rootDir

		const configDir = path.resolve(opts.rootDir);
		return { configDir, tsConfig: opts.tsconfig };
	}

	if (opts?.tsconfigPath) {
		// explicitly passed tsconfig path

		const configPath = path.resolve(opts.tsconfigPath);
		const configDir = path.dirname(configPath);

		const tsConfig = ts.readConfigFile(configPath, ts.sys.readFile).config;
		if (!tsConfig) throw new Error("Could not find tsconfig.json at " + configPath);
		return { configDir, tsConfig };
	}

	{
		// implicitly read a tsconfig from the current directory

		const configDir = path.resolve(".");
		const config = ts.findConfigFile(configDir, ts.sys.fileExists, "tsconfig.json");
		if (!config) throw new Error("Could not locate tsconfig.json in " + configDir);
		return { configDir, tsConfig: ts.readConfigFile(config, ts.sys.readFile).config };
	}
}

export interface ComptimeContext {
	sourceFile: string;
	position: {
		start: number;
		end: number;
	};
}

const logs = {
	evalContext: w("comptime:eval"),
};

export async function getComptimeReplacements(opts?: Filterable<GetComptimeReplacementsOpts>): Promise<Replacements> {
	const { configDir, tsConfig } = getTsConfig(opts);
	const options = ts.parseJsonConfigFileContent(tsConfig, ts.sys, configDir);
	const program = ts.createProgram(
		options.fileNames.map(f => path.resolve(configDir, f)),
		options.options,
	);
	const checker = program.getTypeChecker();

	const allowedFiles = new Set(options.fileNames.map(f => path.resolve(f)));
	const filter = opts?.filter;

	return Object.fromEntries(
		await Promise.all(
			program.getSourceFiles().map(async file => {
				const resolved = path.resolve(file.fileName);
				if (!allowedFiles.has(resolved)) return [resolved, []];
				if (isNodeModules(resolved)) return [resolved, []];
				if (filter && !filter(resolved)) return [resolved, []];

				const comptimeImports = query<ts.ImportDeclaration>(file, ts.SyntaxKind.ImportDeclaration, each => {
					const elements = each.attributes?.elements;
					if (!elements) return false;

					const comptime = elements.some(elem => elem.value.getText().slice(1, -1) === "comptime");

					return comptime;
				});

				const comptimeConsumers = query<ts.Identifier>(file, ts.SyntaxKind.Identifier, each => {
					const parent = each.parent;
					// exclude import declarations from being considered consumers
					if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) {
						return false;
					}

					const symbol = checker.getSymbolAtLocation(each);
					const decls = symbol?.declarations;
					if (!decls?.length) return false;

					return decls.some(decl => {
						if (ts.isImportSpecifier(decl)) {
							// Named import: import { foo } from ...
							return comptimeImports.some(importDecl =>
								query<ts.ImportSpecifier>(importDecl, ts.SyntaxKind.ImportSpecifier).some(
									spec => spec === decl,
								),
							);
						} else if (ts.isNamespaceImport(decl)) {
							// Namespace import: import * as foo from ...
							return comptimeImports.some(importDecl =>
								query<ts.NamespaceImport>(importDecl, ts.SyntaxKind.NamespaceImport).some(
									ns => ns === decl,
								),
							);
						} else if (ts.isImportClause(decl) && decl.name) {
							// Default import: import foo from ...
							return comptimeImports.some(importDecl =>
								query<ts.ImportClause>(importDecl, ts.SyntaxKind.ImportClause).some(
									clause => clause === decl,
								),
							);
						}
						return false;
					});
				});

				const targetExpressions = comptimeConsumers.map(consumer => {
					let current: ts.Node = consumer;
					while (current.parent) {
						const parent = current.parent;
						if (
							// Choose foo.bar instead of foo
							(ts.isPropertyAccessExpression(parent) && parent.expression === current) ||
							// Choose foo[bar] instead of foo
							(ts.isElementAccessExpression(parent) && parent.expression === current) ||
							// Choose foo() instead of foo
							(ts.isCallExpression(parent) && parent.expression === current) ||
							// Choose foo`bar` instead of foo
							(ts.isTaggedTemplateExpression(parent) && parent.tag === current) ||
							// Choose foo++ instead of foo
							(ts.isPostfixUnaryExpression(parent) && parent.operand === current) ||
							// Choose ++foo instead of foo
							(ts.isPrefixUnaryExpression(parent) && parent.operand === current) ||
							// Choose new Class() instead of Class
							(ts.isNewExpression(parent) && parent.expression === current)

							/*
								We deliberately chose not to include ParenthesizedExpression.
								Advanced users can use this to opt-out of walking up the chain
								(foo).bar will only evaluate foo
							*/
						) {
							current = parent;
						} else {
							break;
						}
					}

					return current;
				});

				const sortedTargets = targetExpressions
					.map(node => ({ node, start: node.getStart(file), end: node.getEnd() }))
					.sort((a, b) => a.start - b.start);

				/*
					Remove nested targets, so only the outermost comptime expressions are evaluated.
					
					Example: comptime((comptime(1 + 2) + 3) + 4) will only evaluate the outer comptime() function call
					
					This prevents double evaluation of the same expression and also double replacement
					of the same codeblock, which breaks MagicString
				*/
				const filteredTargets: typeof sortedTargets = [];
				let lastEnd = -1;
				for (const t of sortedTargets) {
					if (t.start >= lastEnd) {
						filteredTargets.push(t);
						lastEnd = t.end;
					}
				}

				const removeImports = comptimeImports.map(i => ({
					start: i.getStart(file),
					end: i.getEnd(),
					replacement: "",
				}));

				const replacements = [];

				const resolver = getModuleResolver(opts?.resolver);

				// safe to do all this work async
				const evaluations = await Promise.all(
					filteredTargets.map(async ({ node: target }) => {
						let errCode: ComptimeError = COMPTIME_ERRORS.CT_ERR_GET_EVALUATION;

						let evalProgram: string = "";
						let transpiled: string = "";

						try {
							const evaluation = await getEvaluation(resolver, checker, file, target);
							evalProgram = `async function evaluate() {\n${evaluation}\n}`;
							errCode = COMPTIME_ERRORS.CT_ERR_SYNTAX_CHECK;
							assertNoSyntaxErrors(evalProgram);
							errCode = COMPTIME_ERRORS.CT_ERR_ERASE_TYPES;
							transpiled = eraseTypes(evalProgram);
						} catch (e) {
							const message = formatSourceError(file, target, e, evalProgram, transpiled);
							throw new Error(getErr(errCode, message), { cause: e });
						}

						return {
							target,
							evalProgram,
							transpiled,
							sourceFile: file.fileName,
							position: {
								start: target.getStart(file),
								end: target.getEnd(),
							},
						};
					}),
				);

				// evaluate in series to avoid race conditions
				for (const { target, evalProgram, transpiled, ...context } of evaluations) {
					let errCode: ComptimeError = COMPTIME_ERRORS.CT_ERR_CREATE_FUNCTION;

					let resolved: unknown;
					try {
						if (logs.evalContext.enabled) {
							const lineChar = ts.getLineAndCharacterOfPosition(file, target.getStart(file));
							const marker = `${file.fileName}:${lineChar.line + 1}:${lineChar.character + 1}`;
							logs.evalContext(
								"\n\n" +
									box(
										[
											box(transpiled),
											"-- with comptime context: " + format(context),
											"From: " + marker,
										].join("\n\n"),
										{
											title: "evaluation block",
										},
									),
								"\n",
							);
						}
						const func = new Function(
							"__comptime_context",
							"AsyncLocalStorage",
							"const local = new AsyncLocalStorage();\n" +
								transpiled +
								"\nreturn local.run({ __comptime_context }, evaluate);",
						);
						errCode = COMPTIME_ERRORS.CT_ERR_EVALUATE;
						resolved = await func(context, AsyncLocalStorage);
					} catch (e) {
						const message = formatSourceError(file, target, e, evalProgram, transpiled);
						throw new Error(getErr(errCode, message), { cause: e });
					}

					// TODO: if this node will become an unused statement, remove it entirely instead of replacing it
					let result;
					if (resolved === undefined) result = "undefined";
					else if (Array.isArray(resolved)) result = JSON.stringify(resolved);
					// prevent bare object becoming a statement and becoming invalid syntax
					else if (typeof resolved === "object") result = "(" + JSON.stringify(resolved) + ")";
					// fallback to JSON.stringify for other types
					else result = JSON.stringify(resolved);

					replacements.push({ start: target.getStart(file), end: target.getEnd(), replacement: result });
				}

				return [resolved, [...removeImports, ...(await Promise.all(replacements))]] as const;
			}),
		),
	);
}

export type ApplyComptimeReplacementsOpts = GetComptimeReplacementsOpts & {
	/** Default: `$configDir/build` */
	outdir?: string;
};

export async function applyComptimeReplacements(opts: ApplyComptimeReplacementsOpts, replacements: Replacements) {
	const { configDir, tsConfig } = getTsConfig(opts);
	const options = ts.parseJsonConfigFileContent(tsConfig, ts.sys, configDir);
	const program = ts.createProgram(
		options.fileNames.map(f => path.resolve(configDir, f)),
		options.options,
	);

	const outdir = opts.outdir ?? path.join(configDir, "build");

	for await (const file of program.getSourceFiles()) {
		const resolved = path.resolve(file.fileName);
		if (resolved.includes("/node_modules/")) continue;

		const s = new MagicString(file.getFullText());
		const fullPath = path.resolve(configDir, resolved);

		const repl = replacements[fullPath];
		if (!repl) continue;

		for (const replacement of repl) {
			s.overwrite(replacement.start, replacement.end, replacement.replacement);
		}

		const relative = path.relative(configDir, fullPath);
		const outFile = path.join(outdir, relative);

		const dir = path.dirname(outFile);
		await mkdir(dir, { recursive: true });

		console.log("Writing", outFile);
		await writeFile(outFile, s.toString());
	}
}
