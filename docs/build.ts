import { spawn as child_process_spawn } from "node:child_process";
import { createReadStream, createWriteStream, WriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const spawn = platform() === "win32"
	? (cmd: string, args: string[]) =>
		child_process_spawn("cmd.exe", ["/c", cmd, ...args], { stdio: "pipe" })
	: (cmd: string, args: string[]) =>
		child_process_spawn(cmd, args, { stdio: "pipe" });

const writeP = (ws: WriteStream, chunk: any) =>
	new Promise<void>((resolve, reject) =>
		ws.write(chunk, (err) => err ? reject(err) : resolve())
	);

const collect = (rs: Readable) =>
	new Promise<string>((resolve, reject) => {
		let s = "";
		const onEnd = () => {
			rs.off("error", onError);
			resolve(s);
		};
		const onError = (err: Error) => {
			rs.off("end", onEnd);
			reject(err);
		};
		rs
			.setEncoding("utf8")
			.once("error", onError)
			.once("end", onEnd)
			.once("data", (chunk) => s += chunk as string);
	});

const head = await readFile("docs/head.html", "utf8");

const index = createWriteStream("docs/index.html");

await writeP(index, '<!DOCTYPE html>\n<html lang="en">\n');
await writeP(index, head);
await writeP(index, "<body>\n<main>\n");
const marked = spawn("npx", ["-y", "marked", "--gfm"]);
createReadStream("README.md").pipe(marked.stdin);
const readmeHTML = await collect(marked.stdout);
await writeP(index, readmeHTML.replaceAll("ERRORS.md", "./errors"));
await writeP(index, "</main>\n");
await pipeline(createReadStream("docs/tail.html"), index, { end: false });
await writeP(index, "</body>\n</html>\n");
index.end();

const errors = createWriteStream("docs/errors.html");
await writeP(errors, '<!DOCTYPE html>\n<html lang="en">\n');
await writeP(
	errors,
	head.replace(
		/<title>.*<\/title>/g,
		"<title>List of comptime.ts errors</title>",
	),
);
await writeP(errors, "<body>\n<main>\n");
const markedErrors = spawn("npx", ["-y", "marked", "--gfm"]);
createReadStream("ERRORS.md").pipe(markedErrors.stdin);
await pipeline(markedErrors.stdout, errors, { end: false });
await writeP(errors, "</main>\n");
await pipeline(createReadStream("docs/tail.html"), errors, { end: false });
await writeP(errors, "</body>\n</html>\n");
errors.end();
