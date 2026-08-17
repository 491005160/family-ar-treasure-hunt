import assert from "node:assert/strict";
import test from "node:test";
import { createInitialGameState, gameReducer } from "../app/core/game.js";
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
  assert.match(failureHelp(3), /调试模式/);
  assert.match(failureHelp(5), /别卡在这里/);
});

