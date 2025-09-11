import { createWriteStream, WriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { marked } from "marked";

const writeP = (ws: WriteStream, chunk: any) =>
	new Promise<void>((resolve, reject) => ws.write(chunk, err => (err ? reject(err) : resolve())));

const head = await readFile("docs/head.html", "utf8");
const tail = await readFile("docs/tail.html", "utf8");

const split = (text: string, delimiter: string) => {
	const i = text.indexOf(delimiter);
	if (i === -1) return [text, ""];
	return [text.slice(0, i), text.slice(i + delimiter.length)];
};

function parseFrontMatter(source: string): { frontmatter: Record<string, string>; markdown: string } {
	if (!source.startsWith("---\n")) return { frontmatter: {}, markdown: source };
	const [frontmatter, markdown] = split(source.slice(4), "---");
	return {
		frontmatter: frontmatter
			.trim()
			.split("\n")
			.reduce((acc, line) => {
				const [key, value] = split(line, ":");
				acc[key.trim()] = value.trim();
				return acc;
			}, {} as Record<string, string>),
		markdown: markdown.trim(),
	};
}

const README = {
	title: "comptime.ts — compile-time expressions for TypeScript",
	description: "A simple-to-use compiler, Vite, and Bun plugin to evaluate TypeScript expressions at compile time.",
	featuredImage: "https://comptime.js.org/comptime.ts.jpg",
	out: "docs/index.html",
};

async function render(source: string) {
	const sourcefile = await readFile(source, "utf8");

	const { frontmatter, markdown } = parseFrontMatter(sourcefile);
	const title = frontmatter.title || README.title;
	const description = frontmatter.description || README.description;
	const featuredImage = frontmatter["featured-image"] || README.featuredImage;
	const out = source === "README.md" ? README.out : frontmatter.out;
	if (!out) throw new Error(`No output file specified for ${source}`);

	const html = marked.parse(markdown, { async: false });

	const index = createWriteStream(out);
	await writeP(index, '<!DOCTYPE html>\n<html lang="en">\n');
	await writeP(
		index,
		head
			.replaceAll("{{TITLE}}", title)
			.replaceAll("{{DESCRIPTION}}", description)
			.replaceAll("{{FEATURED_IMAGE}}", featuredImage),
	);
	await writeP(index, "<body>\n<main>\n");
	await writeP(index, html.replaceAll("ERRORS.md", "./errors").replaceAll("SERIALISATION.md", "./serialisation"));
	await writeP(index, "</main>\n");
	await writeP(index, tail);
	await writeP(index, "</body>\n</html>\n");
	index.end();
}

await render("README.md");
await render("ERRORS.md");
await render("SERIALISATION.md");
