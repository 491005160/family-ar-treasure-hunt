import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("静态导出包含家庭寻宝开始页", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>家庭实景寻宝<\/title>/i);
  assert.match(html, /准备好/);
  assert.match(html, /开始寻宝/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});
