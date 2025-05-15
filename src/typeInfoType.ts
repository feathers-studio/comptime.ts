export type TypeInfo =
	| TypeInfo.StringInfo
	| TypeInfo.NumberInfo
	| TypeInfo.BooleanInfo
	| TypeInfo.BigIntInfo
	| TypeInfo.SymbolInfo
	| TypeInfo.NullInfo
	| TypeInfo.UndefinedInfo
	| TypeInfo.AnyInfo
	| TypeInfo.UnknownInfo
	| TypeInfo.NeverInfo
	| TypeInfo.LiteralInfo
	| TypeInfo.ArrayInfo
	| TypeInfo.TupleInfo
	| TypeInfo.ObjectInfo
	| TypeInfo.UnionInfo
	| TypeInfo.IntersectionInfo
	| TypeInfo.EnumInfo
	| TypeInfo.VoidInfo
	| TypeInfo.Unrepresentable;
// | TypeInfo.CircularReference
// | TypeInfo.FunctionInfo
// | TypeInfo.ClassInfo

export declare namespace TypeInfo {
	export interface StringInfo {
		type: "string";
	}

	export interface NumberInfo {
		type: "number";
	}

	export interface BooleanInfo {
		type: "boolean";
	}

	export interface BigIntInfo {
		type: "bigint";
	}

	export interface SymbolInfo {
		type: "symbol";
	}

	export interface NullInfo {
		type: "null";
	}

	export interface UndefinedInfo {
		type: "undefined";
	}

	export interface AnyInfo {
		type: "any";
	}

	export interface UnknownInfo {
		type: "unknown";
	}

	export interface NeverInfo {
		type: "never";
	}

	export interface LiteralInfo {
		type: "literal";
		value: string | number | bigint | boolean;
	}

	export interface ArrayInfo {
		type: "array";
		elementType: TypeInfo;
	}

	export interface TupleInfo {
		type: "tuple";
		members: TypeInfo[];
		readonly?: true;
	}

	export type TupleElementType =
		| "required"
		| "optional"
		| "rest"
		| "variadic"
		| "fixed"
		| "variable"
		| "nonRequired"
		| "nonRest";

	export interface TupleElementInfo {
		type: TypeInfo;
		flags: TupleElementType;
	}

	export interface ObjectInfo {
		type: "object";
		members: Record<string, PropertyInfo>;
		indexSignatures?: IndexSignatureInfo[];
	}

	export interface PropertyInfo {
		type: TypeInfo;
		optional?: true;
		readonly?: true;
	}

	export interface IndexSignatureInfo {
		keyType: "string" | "number" | "symbol";
		valueType: TypeInfo;
	}

	export interface UnionInfo {
		type: "union";
		members: TypeInfo[];
	}

	export interface IntersectionInfo {
		type: "intersection";
		members: TypeInfo[];
	}

	export interface EnumInfo {
		type: "enum";
		name: string;
		values: { name: string; value: string | number }[];
	}

	export interface VoidInfo {
		type: "void";
	}

	export interface Unrepresentable {
		type: "unrepresentable";
	}

	// TODO: circular reference by IDs, like { type: "ref", name: "T", id: "a3102f" }

	// export interface CircularReference {
	// 	type: "circularReference";
	// 	name: string;
	// 	id: string;
	// }

	// TODO: Support MappedTypeInfo?

	// export interface FunctionInfo {
	// 	type: "function";
	// 	typeParams?: TypeParamInfo[];
	// 	parameters: FunctionParameterInfo[];
	// 	returnType: TypeInfo;
	// }

	// export interface FunctionParameterInfo {
	// 	name: string;
	// 	type: TypeInfo;
	// 	optional?: true;
	// 	rest?: true;
	// }

	// export interface TypeParamInfo {
	// 	type: "typeParam";
	// 	name: string;
	// 	constraint?: TypeInfo;
	// 	default?: TypeInfo;
	// }

	// export interface ClassInfo {
	// 	type: "class";
	// 	name: string;
	// 	members: Record<string, PropertyInfo>;
	// 	methods: Record<string, FunctionInfo>;
	// 	baseClass?: TypeInfo;
	// 	implements?: TypeInfo[];
	// }
}
