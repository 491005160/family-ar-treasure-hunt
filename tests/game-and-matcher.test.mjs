import assert from "node:assert/strict";
import test from "node:test";
import { createInitialGameState, gameReducer, getCurrentTargetId } from "../app/core/game.js";
import { buildZoomPresets, readTorchInfo, readZoomInfo } from "../app/core/camera.js";
import { calculateCoverCrop } from "../app/core/capture.js";
import { withTimeout } from "../app/core/async.js";
import { cosineSimilarity } from "../app/core/embedding.js";
import {
  createEmbeddingMatcher,
  createMockMatcher,
  makeDebugMatch,
  normalizeMatchResult,
} from "../app/core/matcher.js";
import { TARGETS, createConfiguredTargets } from "../app/core/targets.js";
import { decodeSharedHunt, decodeSharedHuntNames, encodeSharedHunt } from "../app/core/share.js";
import { failureHelp, formatConfidence } from "../app/core/ui.js";

const targetIds = TARGETS.map((target) => target.id);

test("超时保护会释放永久等待的识别任务", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, "单次识别超时，请重试"),
    /单次识别超时/,
  );
});

test("开始前只启用已上传的宝藏且每槽只保留一张", () => {
  const customUrls = Array.from({ length: 7 }, (_, index) => `blob:treasure-${index}`);
  const configured = createConfiguredTargets({ [TARGETS[0].id]: customUrls });
  assert.equal(configured.length, 1);
  assert.equal(configured[0].customized, true);
  assert.equal(configured[0].shortName, "神秘宝藏");
  assert.deepEqual(configured[0].referenceImages, customUrls.slice(0, 1));
});

test("创建者自定义名称会用于玩家端目标", () => {
  const targetId = TARGETS[0].id;
  const configured = createConfiguredTargets(
    { [targetId]: ["blob:treasure"] },
    { [targetId]: "  薯条冰箱贴  " },
  );
  assert.equal(configured[0].name, "薯条冰箱贴");
  assert.equal(configured[0].shortName, "薯条冰箱贴");
});

test("分享数据可以在另一端还原启用的宝藏", () => {
  const references = {
    [TARGETS[0].id]: ["data:image/jpeg;base64,AAA"],
    [TARGETS[2].id]: ["data:image/jpeg;base64,CCC"],
  };
  const payload = encodeSharedHunt(references, { [TARGETS[0].id]: "薯条冰箱贴", [TARGETS[2].id]: "" });
  assert.deepEqual(decodeSharedHunt(payload), references);
  assert.deepEqual(decodeSharedHuntNames(payload), {
    [TARGETS[0].id]: "薯条冰箱贴",
    [TARGETS[2].id]: "神秘宝藏",
  });
});

test("旧版分享链接未保存名称时兼容为神秘宝藏", () => {
  const legacy = Buffer.from(JSON.stringify({
    version: 1,
    images: [{ id: TARGETS[0].id, image: "data:image/jpeg;base64,AAA" }],
  })).toString("base64url");
  assert.deepEqual(decodeSharedHuntNames(legacy), { [TARGETS[0].id]: "神秘宝藏" });
});

test("只设置一个宝藏也能完成游戏", () => {
  const singleTargetIds = [targetIds[2]];
  const state = gameReducer(createInitialGameState(), {
    type: "MATCH_RESULT",
    result: makeDebugMatch(singleTargetIds[0]),
    targetIds: singleTargetIds,
  });
  assert.equal(state.phase, "complete");
  assert.deepEqual(state.foundIds, singleTargetIds);
});

test("四个调试匹配可以完成整局", () => {
  let state = gameReducer(createInitialGameState(), { type: "START" });
  for (const targetId of targetIds) {
    state = gameReducer(state, { type: "MATCH_RESULT", result: makeDebugMatch(targetId), targetIds });
  }
  assert.equal(state.phase, "complete");
  assert.deepEqual(state.foundIds, targetIds);
  assert.equal(state.attempts, 4);
});

test("重复目标不会重复增加进度", () => {
  const result = makeDebugMatch(targetIds[0]);
  let state = gameReducer(createInitialGameState(), { type: "MATCH_RESULT", result, targetIds });
  state = gameReducer(state, { type: "MATCH_RESULT", result, targetIds });
  assert.equal(state.foundIds.length, 1);
  assert.equal(state.lastMatch.accepted, false);
});

test("当前章节依次显示对应目标", () => {
  assert.equal(getCurrentTargetId(targetIds, []), targetIds[0]);
  assert.equal(getCurrentTargetId(targetIds, [targetIds[0]]), targetIds[1]);
  assert.equal(getCurrentTargetId(targetIds, targetIds), null);
});

test("刷新恢复进度时先回开始页重新请求摄像头", () => {
  const restored = gameReducer(createInitialGameState(), {
    type: "RESTORE",
    state: { phase: "playing", foundIds: targetIds.slice(0, 2) },
    targetIds,
  });
  assert.equal(restored.phase, "start");
  assert.deepEqual(restored.foundIds, targetIds.slice(0, 2));
});

test("mock matcher 固定一次失败、一次成功", async () => {
  const matcher = createMockMatcher();
  const context = { targets: TARGETS, foundIds: [] };
  const miss = await matcher.match({}, context);
  const match = await matcher.match({}, context);
  assert.equal(miss.matched, false);
  assert.equal(match.matched, true);
  assert.equal(match.targetId, targetIds[0]);
});

test("embedding matcher 同时要求 Top1 强度和 Top1-Top2 差距", async () => {
  let captureEmbedding = [1, 0];
  const referenceEmbeddings = new Map([
    [TARGETS[0].referenceImages[0], [0.8, 0.6]],
    [TARGETS[1].referenceImages[0], [0.65, Math.sqrt(1 - 0.65 ** 2)]],
    [TARGETS[2].referenceImages[0], [0.3, Math.sqrt(1 - 0.3 ** 2)]],
    [TARGETS[3].referenceImages[0], [0.1, Math.sqrt(1 - 0.1 ** 2)]],
  ]);
  const matcher = createEmbeddingMatcher({
    embedder: {
      embedBlob: async () => captureEmbedding,
      embedUrl: async (url) => referenceEmbeddings.get(url),
    },
    rules: { minimumSimilarity: 0.62, minimumMargin: 0.1 },
  });
  const context = { targets: TARGETS, foundIds: [] };
  const clearMatch = await matcher.match({ blob: {} }, context);
  assert.equal(clearMatch.matched, true);
  assert.equal(clearMatch.targetId, targetIds[0]);
  assert.equal(Number(clearMatch.margin.toFixed(2)), 0.15);

  referenceEmbeddings.set(TARGETS[1].referenceImages[0], [0.74, Math.sqrt(1 - 0.74 ** 2)]);
  const ambiguous = await matcher.match({ blob: {} }, context);
  assert.equal(ambiguous.matched, false);
  assert.equal(ambiguous.reason, "top1-top2-margin-too-small");

  captureEmbedding = [-1, 0];
  const weak = await matcher.match({ blob: {} }, context);
  assert.equal(weak.matched, false);
  assert.equal(weak.reason, "top1-below-minimum");
});

test("embedding 余弦相似度完全相同时为 1", () => {
  assert.equal(cosineSimilarity([0.6, 0.8], [0.6, 0.8]), 1);
});

test("已找到目标从 embedding 候选集中排除", async () => {
  const matcher = createEmbeddingMatcher({
    embedder: {
      embedBlob: async () => [1, 0],
      embedUrl: async (url) => url === TARGETS[0].referenceImages[0] ? [1, 0] : [0.8, 0.6],
    },
    rules: { minimumSimilarity: 0.62, minimumMargin: 0.1 },
  });
  const result = await matcher.match({ blob: {} }, { targets: TARGETS, foundIds: [targetIds[0]] });
  assert.equal(result.scores.find((score) => score.targetId === targetIds[0]).excluded, true);
  assert.notEqual(result.top1.targetId, targetIds[0]);
});

test("截图区域按 object-fit cover 映射到相机源画面", () => {
  const crop = calculateCoverCrop(
    { width: 1920, height: 1080 },
    { left: 0, top: 0, width: 390, height: 844 },
    { left: 86, top: 306, width: 218, height: 218 },
  );
  assert.equal(Math.round(crop.width), 279);
  assert.equal(Math.round(crop.height), 279);
  assert.ok(crop.x > 700 && crop.x < 900);
  assert.ok(crop.y > 350 && crop.y < 450);
});

test("摄像头焦段只显示设备实际支持的倍率", () => {
  assert.deepEqual(buildZoomPresets(0.5, 3, 0.1), [1, 2]);
  assert.deepEqual(buildZoomPresets(1, 2, 0.1), [1, 2]);
  assert.deepEqual(buildZoomPresets(1, 1.5, 0.1), [1]);
  assert.deepEqual(buildZoomPresets(1, 1, 0.1), []);
});

test("可从摄像头轨道读取当前焦段", () => {
  const track = {
    getCapabilities: () => ({ zoom: { min: 1, max: 4, step: 0.1 } }),
    getSettings: () => ({ zoom: 1.5 }),
  };
  assert.deepEqual(readZoomInfo(track), { min: 1, max: 4, step: 0.1, value: 1.5, presets: [1, 2] });
});

test("只在摄像头明确支持时显示补光", () => {
  const supportedTrack = {
    getCapabilities: () => ({ torch: true }),
    getSettings: () => ({ torch: false }),
  };
  const unsupportedTrack = {
    getCapabilities: () => ({}),
    getSettings: () => ({}),
  };
  assert.deepEqual(readTorchInfo(supportedTrack), { supported: true, enabled: false });
  assert.equal(readTorchInfo(unsupportedTrack), null);
});

test("matcher 结果被约束到稳定接口", () => {
  assert.deepEqual(normalizeMatchResult({ matched: true, targetId: "book", confidence: 3 }), {
    matched: true,
    targetId: "book",
    confidence: 1,
    provider: "custom",
    reason: null,
  });
  assert.equal(formatConfidence(0.914), "91%");
});

test("连续三次失败后出现降级提示", () => {
  assert.equal(failureHelp(2), null);
  assert.match(failureHelp(3), /换个角度/);
  assert.match(failureHelp(5), /家人帮忙/);
});
