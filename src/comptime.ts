import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import MagicString from "magic-string";
import * as ts from "typescript";

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
		sorted.map(each => (ts.isImportSpecifier(each) ? getImportLine(each) : each.getText().trim())),
	);

	return declLines.join("\n") + "\n" + `return ${expression};`;
}

export async function getComptimeReplacements(opts?: { tsconfigPath?: string }): Promise<Replacements> {
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
				const comptimeImports = query<ts.ImportDeclaration>(file, ts.SyntaxKind.ImportDeclaration, each => {
					const elements = each.attributes?.elements;
					if (!elements) return false;

					const comptime = elements.some(elem => elem.value.getText().slice(1, -1) === "comptime");

					return comptime;
				});

				const comptimeConsumers = query<ts.Identifier>(file, ts.SyntaxKind.Identifier, each => {
					if (ts.isImportSpecifier(each.parent)) return false;

					const symbol = checker.getSymbolAtLocation(each);
					const decls = symbol?.declarations;
					if (!decls?.length) return false;

					return decls.some(decl => {
						if (ts.isImportSpecifier(decl)) {
							return comptimeImports.some(importDecl =>
								query<ts.ImportSpecifier>(importDecl, ts.SyntaxKind.ImportSpecifier).some(
									spec => spec.name.getText() === decl.name.getText(),
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

							// We deliberately chose not to include ParenthesizedExpression.
							// Advanced users can use this to opt-out of walking up the chain
							// (foo).bar will only evaluate foo
						) {
							current = parent;
						} else {
							break;
						}
					}
					const target = current;

					const expression = await getExpression(checker, file, target);
					const func = new Function(`return async function evaluate() { ${expression} };`)();
					const result = JSON.stringify(await func()) ?? "undefined";

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

		const repl = replacements[fullPath] ?? [];

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
