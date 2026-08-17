import { access, cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputDirectory = path.resolve("dist/client");
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];

if (!repositoryName) {
  throw new Error("GITHUB_REPOSITORY is required, for example owner/repository.");
}

const prefixedAssets = path.join(outputDirectory, repositoryName, "_next");
const publicAssets = path.join(outputDirectory, "_next");

await access(prefixedAssets);
await mkdir(publicAssets, { recursive: true });
await cp(prefixedAssets, publicAssets, { recursive: true, force: true });
await writeFile(path.join(outputDirectory, ".nojekyll"), "");

console.log(`Prepared GitHub Pages assets for /${repositoryName}/.`);
