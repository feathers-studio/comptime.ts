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

function recursivelyGetIdentifierDeclarations(
	seen: Set<ts.ImportSpecifier | ts.VariableDeclaration>,
	checker: ts.TypeChecker,
	sourceFile: ts.SourceFile,
	idn: ts.Identifier,
): (ts.ImportSpecifier | ts.VariableDeclaration)[] {
	const decls = checker.getSymbolAtLocation(idn)?.declarations;
	if (!decls) return [];

	return decls
		.filter(decl => ts.isVariableDeclaration(decl) || ts.isImportSpecifier(decl))
		.flatMap(each => {
			if (seen.has(each)) return [];
			seen.add(each);

			if (ts.isImportSpecifier(each)) {
				if (each.isTypeOnly) return [];
				return [each];
			}
			if (ts.isVariableDeclaration(each)) {
				if (each.type) return [];
				// find other identifiers used in this declaration
				const identifiers = query<ts.Identifier>(each, ts.SyntaxKind.Identifier).filter(idn2 => idn !== idn2); // exclude the current identifier
				return identifiers.flatMap(idn => recursivelyGetIdentifierDeclarations(seen, checker, sourceFile, idn));
			}

			throw new Error("Unreachable");
		});
}

const getImportLine = async (imp: ts.ImportSpecifier) => {
	const decl = imp.parent.parent.parent as ts.ImportDeclaration;

	const specifier = decl.moduleSpecifier.getText().slice(1, -1);

	let importPath: string;

	if (specifier.startsWith("./") || specifier.startsWith("../")) {
		importPath = path.resolve(path.dirname(decl.getSourceFile().fileName), specifier);
	} else {
		importPath = (await import.meta.resolve(specifier)).slice("file://".length);
	}

	return `const {${imp.name.getText()}} = await import("${importPath}");`;
};

async function getExpression(checker: ts.TypeChecker, sourceFile: ts.SourceFile, node: ts.Node) {
	const expression = node.getText();
	const identifiers = query<ts.Identifier>(node, ts.SyntaxKind.Identifier);
	const seen = new Set<ts.ImportSpecifier | ts.VariableDeclaration>();
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
					const target = consumer.parent;

					const expression = await getExpression(checker, file, target);
					const func = new Function(`return async function evaluate() { ${expression} };`)();
					const result = JSON.stringify(await func());

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
