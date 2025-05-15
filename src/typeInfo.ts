import * as ts from "typescript";
import {
	getTsConfig,
	isNodeModules,
	query,
	type Filterable,
	type GetComptimeReplacementsOpts,
	type Replacement,
	type Replacements,
} from "./comptime.ts";
import { resolve } from "node:path";
import type { TypeInfo } from "./typeInfoType.ts";
import { stringify } from "./stringify.ts";

export function isReadonlyProperty(symbol: ts.Symbol): boolean {
	if (!symbol.declarations) return false;

	return symbol.declarations.some(decl => {
		const flags = ts.getCombinedModifierFlags(decl);
		return (flags & ts.ModifierFlags.Readonly) !== 0;
	});
}

export function isReadonlyIndexSignature(decl: ts.Declaration): boolean {
	return Boolean(
		ts.isIndexSignatureDeclaration(decl) && decl.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ReadonlyKeyword),
	);
}

export function isIndexSignature(decl: ts.Declaration): boolean {
	return Boolean(ts.isIndexSignatureDeclaration(decl));
}

export type RemoveFalse<T> = {
	[key in keyof T]: T[key] extends boolean ? true : T[key] extends false | undefined ? never : T[key];
};

export function removeFalseAndUndefined<T>(value: T): RemoveFalse<T> {
	for (const key in value) if (value[key] === false || value[key] === undefined) delete value[key];
	return value as RemoveFalse<T>;
}

export function getTypeInfo(sourceFile: ts.SourceFile, checker: ts.TypeChecker, type: ts.Type): TypeInfo | undefined {
	if (type.isLiteral()) {
		let value = type.value as string | number | bigint | ts.PseudoBigInt;
		if (typeof value === "object" && "base10Value" in value) {
			value = BigInt(value.base10Value) * (value.negative ? -1n : 1n);
		}
		return { type: "literal", value };
	} else if (type.isUnion()) {
		return { type: "union", members: type.types.map(t => getTypeInfo(sourceFile, checker, t)!) };
	} else if (type.isIntersection()) {
		return { type: "intersection", members: type.types.map(t => getTypeInfo(sourceFile, checker, t)!) };
	} else if (type.isClassOrInterface()) {
		const indexSignatures: TypeInfo.IndexSignatureInfo[] = [];

		const numberIndexType = type.getNumberIndexType();
		if (numberIndexType) {
			const typeInfo = getTypeInfo(sourceFile, checker, numberIndexType);
			if (!typeInfo) throw new Error("Could not get type info for number index type");
			indexSignatures.push({ keyType: "number", valueType: typeInfo });
		}

		const stringIndexType = type.getStringIndexType();
		if (stringIndexType) {
			const typeInfo = getTypeInfo(sourceFile, checker, stringIndexType);
			if (!typeInfo) throw new Error("Could not get type info for string index type");
			indexSignatures.push({ keyType: "string", valueType: typeInfo });
		}

		const members: Record<string, TypeInfo.PropertyInfo> = Object.fromEntries(
			type.getProperties().map(prop => {
				const propType = checker.getTypeOfSymbolAtLocation(prop, sourceFile);
				const typeInfo = getTypeInfo(sourceFile, checker, propType);
				// TODO: improve errors
				if (!typeInfo) throw new Error("Could not get type info for property");

				return [
					prop.name,
					removeFalseAndUndefined({
						type: typeInfo,
						optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
						readonly: isReadonlyProperty(prop),
					}),
				] as const;
			}),
		);

		return { type: "object", members, indexSignatures };
	} else {
		const flags = type.getFlags();
		if (flags & ts.TypeFlags.String) {
			return { type: "string" };
		} else if (flags & ts.TypeFlags.Number) {
			return { type: "number" };
		} else if (flags & ts.TypeFlags.Boolean) {
			return { type: "boolean" };
		} else if (flags & ts.TypeFlags.BigInt) {
			return { type: "bigint" };
		} else if (flags & ts.TypeFlags.ESSymbolLike) {
			// ESSymbolLike includes ESSymbol and UniqueSymbol
			return { type: "symbol" };
		} else if (flags & ts.TypeFlags.Null) {
			return { type: "null" };
		} else if (flags & ts.TypeFlags.Undefined) {
			return { type: "undefined" };
		} else if (flags & ts.TypeFlags.Any) {
			return { type: "any" };
		} else if (flags & ts.TypeFlags.Unknown) {
			return { type: "unknown" };
		} else if (flags & ts.TypeFlags.Never) {
			return { type: "never" };
		} else if (flags & ts.TypeFlags.Void) {
			return { type: "void" };
		} else if ((type.flags & ts.TypeFlags.Enum) !== 0) {
			const enumType = type as ts.EnumType;
			const enumName = enumType.symbol.name;
			const enumValues: TypeInfo.EnumInfo["values"] = [];

			if (enumType.symbol.exports) {
				enumType.symbol.exports.forEach((memberSymbol, _key) => {
					if (memberSymbol.flags & ts.SymbolFlags.EnumMember) {
						const declaration = memberSymbol.valueDeclaration;
						if (declaration && ts.isEnumMember(declaration)) {
							const memberName = memberSymbol.name;
							const memberValue = checker.getConstantValue(declaration);
							if (typeof memberValue === "string" || typeof memberValue === "number") {
								enumValues.push({ name: memberName, value: memberValue });
							} else {
								console.warn(
									`Enum member ${enumName}.${memberName} has a non-constant or unresolvable value. Type: ${typeof memberValue}`,
								);
							}
						}
					}
				});
			}
			return { type: "enum", name: enumName, values: enumValues };
		} else if (flags & ts.TypeFlags.Object) {
			const objectType = type as ts.ObjectType;

			// Array check
			if (checker.isArrayType(objectType)) {
				// Use getIndexTypeOfType with IndexKind.Number for arrays
				const elementType = checker.getIndexTypeOfType(objectType, ts.IndexKind.Number);
				if (elementType) {
					const elementTypeInfo = getTypeInfo(sourceFile, checker, elementType);
					if (!elementTypeInfo) {
						throw new Error(
							"Could not get type info for array element type, even though element type was found.",
						);
					}
					return { type: "array", elementType: elementTypeInfo };
				}
				// This would mean it's an array type but has no number index signature
				throw new Error(
					"Array element type could not be determined: getIndexTypeOfType returned undefined for an array type.",
				);
			}

			// Tuple check
			if (checker.isTupleType(objectType)) {
				const tupleType = objectType as ts.TupleType;

				const elementTypes = tupleType.typeArguments;

				if (!elementTypes) {
					throw new Error("Tuple type did not have type arguments");
				}

				const members = elementTypes.map(elType => {
					const memberInfo = getTypeInfo(sourceFile, checker, elType);
					if (!memberInfo) throw new Error("Could not get type info for tuple element");
					return memberInfo;
				});

				// console.log({
				// 	readonly: tupleType.readonly,
				// 	labeledElementDeclarations: tupleType.labeledElementDeclarations,
				// 	elementFlags: tupleType.elementFlags,
				// 	hasVariadic: (tupleType.combinedFlags & ts.ElementFlags.Variable) !== 0,
				// });

				// tupleType.elementFlags;

				// this works by accident, but it seems tupleType is not actually a ts.TupleType
				// all properties/methods that should exist on TupleType are missing, including readonly
				return removeFalseAndUndefined({ type: "tuple", members, readonly: tupleType.readonly });
			}

			// If it's an ObjectType but not Array, Tuple, or Enum, and wasn't caught by isClassOrInterface,
			// it will fall through to the final 'return undefined'.
		}
	}

	// allow compilation for unsupported types for now
	// maybe a CLI option will cause this to throw an error instead
	return { type: "unrepresentable" };
}

export function typeInfo(program: ts.Program, checker: ts.TypeChecker, sourceFile: ts.SourceFile, node: ts.TypeNode) {
	const type = checker.getTypeFromTypeNode(node);
	return getTypeInfo(sourceFile, checker, type);
}

export function getTypeInfoReplacements(opts?: Filterable<GetComptimeReplacementsOpts>): Replacements {
	const { configDir, tsConfig } = getTsConfig(opts);
	const options = ts.parseJsonConfigFileContent(tsConfig, ts.sys, configDir);
	const program = ts.createProgram(
		options.fileNames.map(f => resolve(configDir, f)),
		options.options,
	);
	const checker = program.getTypeChecker();

	const allowedFiles = new Set(options.fileNames.map(f => resolve(f)));
	const filter = opts?.filter;

	return Object.fromEntries(
		program.getSourceFiles().map(sourceFile => {
			const resolved = resolve(sourceFile.fileName);
			if (!allowedFiles.has(resolved)) return [resolved, []];
			if (isNodeModules(resolved)) return [resolved, []];
			if (filter && !filter(resolved)) return [resolved, []];

			// only continue if sourceFile has import { typeInfo } from "comptime.ts"; and it's not aliased
			const hasTypeInfoImport = sourceFile.statements.some(stmt => {
				if (!ts.isImportDeclaration(stmt)) return false;
				const specifier = stmt.moduleSpecifier;
				if (!ts.isStringLiteral(specifier)) return false;
				if (specifier.text !== "comptime.ts") return false;
				const specifiers = query<ts.ImportSpecifier>(stmt, ts.SyntaxKind.ImportSpecifier);
				return specifiers.some(spec => spec.name.getText(sourceFile) === "typeInfo");
			});

			if (!hasTypeInfoImport) return [];

			const replacements: Replacement[] = query<ts.Identifier>(
				sourceFile,
				ts.SyntaxKind.Identifier,
				node => node.getText(sourceFile) === "typeInfo",
			)
				.map(ident => {
					const lineChar = ts.getLineAndCharacterOfPosition(sourceFile, ident.getStart(sourceFile));

					const endLineChar = ts.getLineAndCharacterOfPosition(sourceFile, ident.getEnd());

					const line = sourceFile.text.split("\n");
					const sameLineEnds = endLineChar.line === lineChar.line;
					console.log(line[lineChar.line]);
					const rest = sameLineEnds
						? endLineChar.character - lineChar.character
						: line.length - lineChar.character;
					console.log(" ".repeat(lineChar.character) + "^".repeat(rest));

					const node = ident.parent;

					if (ts.isImportSpecifier(node)) return;

					if (!ts.isCallExpression(node))
						throw new Error("typeInfo found, but not called. Did you forget to call it?");

					const args = node.arguments;
					if (args.length) throw new Error("typeInfo does not accept any arguments.");

					const typeArgs = node.typeArguments;

					if (!typeArgs) throw new Error("typeInfo must be called with 1-2 type arguments.");

					if (typeArgs.length < 1 || typeArgs.length > 2)
						throw new Error(
							"Expected typeInfo to be called with 1-2 type arguments. Found " + typeArgs.length,
						);

					const typeNode = typeArgs[0]!;
					const resolved = typeInfo(program, checker, sourceFile, typeNode);

					return {
						start: node.getStart(sourceFile),
						end: node.getEnd(),
						replacement: stringify(resolved),
					};
				})
				.filter(x => x != null);

			return [sourceFile.fileName, replacements];
		}),
	);
}
