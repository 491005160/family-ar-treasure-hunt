import assert from "node:assert/strict";
import test from "node:test";
import { createInitialGameState, gameReducer, getCurrentTargetId } from "../app/core/game.js";
import { createMockMatcher, makeDebugMatch, normalizeMatchResult } from "../app/core/matcher.js";
import { TARGETS } from "../app/core/targets.js";
import { failureHelp, formatConfidence } from "../app/core/ui.js";

const targetIds = TARGETS.map((target) => target.id);

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
