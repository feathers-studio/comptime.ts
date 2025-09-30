import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import path from "path";

type MaybePromise<T> = T | Promise<T>;

export type ModuleResolver = (specifier: string, importer: string) => MaybePromise<string | null | undefined>;

const isWin = platform() === "win32";
const protocol = /^[a-zA-Z][a-zA-Z\d+\-.]+:/;
// Windows wants file:// for absolute paths, otherwise it assumes drive letter is a protocol
export const formatPath = (path: string) =>
	(isWin && !protocol.test(path) ? "file://" : "") + path.replaceAll("\\", "\\\\");

export function getModuleResolver(userResolver?: ModuleResolver): ModuleResolver {
	const require = createRequire(fileURLToPath(import.meta.url));

	return (specifier, importer) => {
		// 1. User-provided resolver (e.g. from Vite plugin context)
		if (userResolver) {
			return userResolver(specifier, importer);
		}

		// 2. Bun native resolution
		if (typeof Bun !== "undefined" && Bun.resolveSync) {
			const importerDir = path.dirname(importer);
			return Bun.resolveSync(specifier, importerDir);
		}

		// 3. Fallback to Node CJS resolution
		const importerDir = path.dirname(importer);
		return require.resolve(specifier, { paths: [importerDir] });

		// we would use import.meta.resolve, but it needs --experimental-import-meta-resolve
		// to accept a parent parameter
	};
}
