import * as ts from "typescript";
import { getEnclosingStatement } from "./comptime.ts";
import { box } from "./errors.ts";

const getSourceSlice = (sourceFile: ts.SourceFile, target: ts.Node, enclosing: ts.Statement) => {
	const get = (pos: number) => ts.getLineAndCharacterOfPosition(sourceFile, pos);

	const stmtStart = get(enclosing.getStart(sourceFile));
	const targetStart = get(target.getStart(sourceFile));
	const targetEnd = get(target.getEnd());

	return {
		// get first line of the target in the source file
		source:
			sourceFile.text
				.replaceAll("\t", " ") // simplify column numbers
				.split("\n")[stmtStart.line] ?? "",
		start: {
			line: targetStart.line - stmtStart.line,
			column: targetStart.character,
		},
		end: {
			line: targetEnd.line - stmtStart.line,
			column: targetEnd.character,
		},
	};
};

/**
 * This may look overly complex just for reporting errors,
 * but without enough information it may be very hard to debug comptime errors
 * because they are run in a constructed environment.
 *
 * We remedy that by producing well-formatted and very detailed error messages.
 */
export function formatSourceError(
	sourceFile: ts.SourceFile,
	target: ts.Node,
	error: unknown,
	evalProgram?: string,
	transpiled?: string,
) {
	const fileName = sourceFile.fileName;
	const marker = `${fileName}:${target.getStart(sourceFile)}:${target.getEnd()}`;

	const stmt = getEnclosingStatement(target);

	let text = "";

	{
		const { source, start, end } = getSourceSlice(sourceFile, target, stmt);

		let sourceMarker = "";

		if (start.line === end.line) {
			const length = end.column - start.column;
			sourceMarker = "~".repeat(length);
		} else {
			const length = source.length - start.column;
			sourceMarker = "~".repeat(length);
		}

		text = source + "\n" + " ".repeat(start.column) + sourceMarker + " <- Error occurred with this expression";
	}

	const message = [];

	message.push(
		["We attempted to evaluate the following expression at compile time:", box(text), "    at " + marker].join(
			"\n",
		),
	);

	const source = transpiled || evalProgram;
	const stripped = transpiled ? " (types stripped)" : evalProgram ? "" : "never";

	if (source) {
		message.push(["Then we constructed this evaluation context" + stripped + ":", box(source)].join("\n"));
	}

	if (error && typeof error === "object") {
		if ("stack" in error && typeof error.stack === "string") message.push(error.stack);
		else if ("message" in error && typeof error.message === "string") message.push(error.message);
	} else message.push(String(error));

	return message.map((m, i) => i + 1 + ". " + m).join("\n\n");
}
