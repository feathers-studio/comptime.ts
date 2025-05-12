import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import MagicString from "magic-string";
import * as ts from "typescript";
import { type FilterPattern, createFilter } from "vite";

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

export function assertNoSyntaxErrors(tsCode: string) {
	const fileName = "eval.ts";
	const compilerOptions: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext };
	const host = ts.createCompilerHost(compilerOptions);
	host.getSourceFile = (fileName_, languageVersion) =>
		fileName_ === fileName
			? ts.createSourceFile(fileName, tsCode, languageVersion, true, ts.ScriptKind.TS)
			: undefined;

	const program = ts.createProgram([fileName], compilerOptions, host);
	const diagnostics = program.getSyntacticDiagnostics();

	if (diagnostics.length > 0) {
		throw new Error(
			"Syntax error in comptime eval block:\n" +
				diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"),
		);
	}
}

export function eraseTypes(tsCode: string): string {
	return ts
		.transpileModule(tsCode, {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, noEmitOnError: true },
		})
		.outputText.trim();
}
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

function getEnclosingImportDeclaration(node: ts.Node): ts.ImportDeclaration {
	while (node && !ts.isImportDeclaration(node)) node = node.parent!;
	return node;
}

function getEnclosingStatement(node: ts.Node): ts.Statement {
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

const getImportLine = async (imp: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport) => {
	const decl = getEnclosingImportDeclaration(imp);
	const specifier = decl.moduleSpecifier.getText().slice(1, -1);

	let importPath: string;

	if (specifier.startsWith("./") || specifier.startsWith("../")) {
		importPath = path.resolve(path.dirname(decl.getSourceFile().fileName), specifier);
	} else {
		importPath = (await import.meta.resolve(specifier)).slice("file://".length);
	}

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

async function getEvaluation(checker: ts.TypeChecker, sourceFile: ts.SourceFile, node: ts.Node) {
	const expression = node.getText();
	const identifiers = query<ts.Identifier>(node, ts.SyntaxKind.Identifier);
	const seen = new Set<DeclarationNode>();
	const decls = identifiers.flatMap(idn => recursivelyGetIdentifierDeclarations(seen, checker, sourceFile, idn));

	const sorted = decls.sort((a, b) => {
		const x = sourceFile.getLineAndCharacterOfPosition(a.getStart(sourceFile));
		const y = sourceFile.getLineAndCharacterOfPosition(b.getStart(sourceFile));
		return x.line - y.line;
	});

	const declLines = await Promise.all(
		sorted.map(each => (isImportNode(each) ? getImportLine(each) : each.getText().trim())),
	);

	return declLines.join("\n") + "\n" + `return ${expression};`;
}

function isNodeModules(filePath: string): boolean {
	return filePath.split(path.sep).includes("node_modules");
}

export async function getComptimeReplacements(opts?: {
	tsconfigPath?: string;
	include?: FilterPattern;
	exclude?: FilterPattern;
}): Promise<Replacements> {
	const filter = createFilter(opts?.include, opts?.exclude);

	const config = opts?.tsconfigPath
		? path.resolve(opts.tsconfigPath)
		: ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
	if (!config) throw new Error("Could not find tsconfig.json");

	const tsConfig = ts.readConfigFile(config, ts.sys.readFile);
	const configDir = path.dirname(config);
	const options = ts.parseJsonConfigFileContent(tsConfig.config, ts.sys, configDir);
	const program = ts.createProgram(
		options.fileNames.map(f => path.resolve(configDir, f)),
		options.options,
	);
	const checker = program.getTypeChecker();

	return Object.fromEntries(
		await Promise.all(
			program.getSourceFiles().map(async file => {
				if (isNodeModules(file.fileName)) return [file.fileName, []];
				if (!filter(file.fileName)) return [file.fileName, []];

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

				const replacements = comptimeConsumers.map(async consumer => {
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
							(ts.isTaggedTemplateExpression(parent) && parent.tag === current)

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

				const replacements = filteredTargets.map(async ({ node: target }) => {
					let evalProgram: string = "";
					let transpiled: string = "";
					let resolved: unknown;
					try {
						evalProgram = await getEvaluation(checker, file, target);
						assertNoSyntaxErrors(evalProgram);
						transpiled = eraseTypes(evalProgram);
						const func = new Function(`return async function evaluate() { ${transpiled} };`)();
						resolved = await func();
					} catch (e) {
						console.error("An error occurred while evaluating the following code:");
						if (e instanceof Error) console.error(e.message);
						if (evalProgram || transpiled) {
							console.error("---");
							console.error(transpiled || evalProgram);
							console.error("---\n");
						}

						const marker = `${file.fileName}:${target.getStart(file)}:${target.getEnd()}`;
						throw new Error(`Error evaluating ${target.getText()} at ${marker}: ${e}`);
					}
					const result = JSON.stringify(resolved) ?? "undefined";
					return { start: target.getStart(file), end: target.getEnd(), replacement: result };
				});

				return [file.fileName, await Promise.all(replacements)] as const;
			}),
		),
	);
}

export async function applyComptimeReplacements(
	opts: { tsconfigPath?: string; outdir: string },
	replacements: Replacements,
) {
	let config = opts.tsconfigPath ?? ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
	if (!config) throw new Error("Could not find tsconfig.json");

	config = path.resolve(path.dirname(config), "tsconfig.json");

	const tsConfig = ts.readConfigFile(config, ts.sys.readFile);
	const options = ts.parseJsonConfigFileContent(tsConfig.config, ts.sys, path.dirname(config));
	const program = ts.createProgram(options.fileNames, options.options);

	console.log("Skipping node_modules");

	for await (const file of program.getSourceFiles()) {
		if (file.fileName.includes("/node_modules/")) continue;

		const s = new MagicString(file.getFullText());
		const fullPath = path.resolve(path.dirname(config), file.fileName);

		const repl = replacements[fullPath];
		if (!repl) continue;

		for (const replacement of repl) {
			s.overwrite(replacement.start, replacement.end, replacement.replacement);
		}

		const relative = path.relative(path.dirname(config), fullPath);
		const outFile = path.join(opts.outdir, relative);

		const dir = path.dirname(outFile);
		await mkdir(dir, { recursive: true });

		console.log("Writing", outFile);
		await writeFile(outFile, s.toString());
	}
}
