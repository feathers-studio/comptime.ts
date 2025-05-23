import { process } from "./util.ts";

import type { Options } from "boxen";

export let box = (text: string, options?: Options, skip?: boolean): string => text;

if (!Boolean(process?.env.NO_BOX)) {
	try {
		if (!process) throw new Error();
		const boxen = (await import("boxen")).default;
		const pad = (text: string) => text.replace(/^.*$/gm, line => " " + line + " ");
		box = (text, options, skip) => (skip ? text : boxen(pad(text), options));
	} catch {}
}

export const COMPTIME_ERRORS = {
	CT_ERR_GET_EVALUATION: "CT_ERR_GET_EVALUATION",
	CT_ERR_SYNTAX_CHECK: "CT_ERR_SYNTAX_CHECK",
	CT_ERR_ERASE_TYPES: "CT_ERR_ERASE_TYPES",
	CT_ERR_CREATE_FUNCTION: "CT_ERR_CREATE_FUNCTION",
	CT_ERR_EVALUATE: "CT_ERR_EVALUATE",
	CT_ERR_NO_COMPTIME: "CT_ERR_NO_COMPTIME",
} as const;

export type ComptimeErrorKind = (typeof COMPTIME_ERRORS)[keyof typeof COMPTIME_ERRORS];

export const COMPTIME_ERRORS_MESSAGES = {
	[COMPTIME_ERRORS.CT_ERR_GET_EVALUATION]:
		"An error occurred while attempting to construct the comptime evaluation block.",
	[COMPTIME_ERRORS.CT_ERR_SYNTAX_CHECK]: "Syntax error in comptime evaluation block.",
	[COMPTIME_ERRORS.CT_ERR_ERASE_TYPES]: "Error occurred while erasing types.",
	[COMPTIME_ERRORS.CT_ERR_CREATE_FUNCTION]: "Error occurred while creating a new Function.",
	[COMPTIME_ERRORS.CT_ERR_EVALUATE]: "Error occurred while evaluating the expression.",
	[COMPTIME_ERRORS.CT_ERR_NO_COMPTIME]: [
		"This function must be called in a comptime context, but was called at runtime.",
		'Are you missing `with { type: "comptime" }` or a compile-step?\n',
	].join("\n\n"),
} as const;

export const getErr = (code: ComptimeErrorKind, context?: string) =>
	"\n\n" +
	box(
		[
			context,
			box(
				COMPTIME_ERRORS_MESSAGES[code] + "\nSee: https://comptime.js.org/errors#" + code.toLowerCase(),
				{},
				context ? false : true,
			),
		]
			.filter(Boolean)
			.join("\n\n"),
		{
			title: "Compile Error",
			titleAlignment: "right",
		},
	) +
	"\n";

export class ComptimeError extends Error {
	constructor(code: ComptimeErrorKind, context?: string, cause?: unknown) {
		super(getErr(code, context), { cause });
	}
}
