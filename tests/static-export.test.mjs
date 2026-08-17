import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("静态导出包含家庭寻宝开始页", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>家庭实景寻宝<\/title>/i);
  assert.match(html, /准备好/);
  assert.match(html, /开始寻宝/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});

test("GitHub Pages 产物包含可发布的核心资源", async () => {
  const outputDirectory = new URL("../dist/client/", import.meta.url);
  const outputDirectoryPath = fileURLToPath(outputDirectory);
  const html = await readFile(new URL("index.html", outputDirectory), "utf8");
  const assetPaths = [...html.matchAll(/["']\/[^"']+\/_next\/[^"']+["']/g)]
    .map(([match]) => match.slice(1, -1))
    .map((assetPath) => assetPath.replace(/^\/[^/]+\//, ""));

  assert.ok(assetPaths.length > 0, "首页应引用至少一个 _next 资源");
  await access(new URL(".nojekyll", outputDirectory));

  for (const assetPath of new Set(assetPaths)) {
    await access(path.join(outputDirectoryPath, assetPath));
  }
});
