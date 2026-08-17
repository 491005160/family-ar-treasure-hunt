/**
 * Matcher 统一返回：
 * { matched, targetId, confidence, provider, reason }
 * 页面与游戏状态只依赖这个结构，因此可无痛替换为本地模型或远程识别服务。
 */

export function createMockMatcher() {
  let attempt = 0;
  return {
    provider: "mock",
    async match(_capture, context) {
      attempt += 1;
      const available = context.targets.filter((target) => !context.foundIds.includes(target.id));
      if (!available.length) return noMatch("mock", 0.99, "all-complete");

      // 固定为“一次失败、一次成功”，方便测试失败提示和完整通关流程。
      if (attempt % 2 === 1) return noMatch("mock", 0.36, "demo-miss");
      return {
        matched: true,
        targetId: available[0].id,
        confidence: 0.91,
        provider: "mock",
        reason: "demo-sequence",
      };
    },
    reset() { attempt = 0; },
  };
}

export function createHttpMatcher({ endpoint, fetchImpl = fetch }) {
  if (!endpoint) throw new Error("真实 matcher 需要配置 endpoint");
  return {
    provider: "http",
    async match(capture, context) {
      const formData = new FormData();
      formData.append("image", capture.blob, "capture.jpg");
      formData.append("targets", JSON.stringify(context.targets));
      formData.append("foundIds", JSON.stringify(context.foundIds));
      const response = await fetchImpl(endpoint, { method: "POST", body: formData });
      if (!response.ok) throw new Error(`识别服务返回 ${response.status}`);
      return normalizeMatchResult(await response.json(), "http");
    },
    reset() {},
  };
}

export function normalizeMatchResult(result, provider = "custom") {
  const confidence = clamp(Number(result?.confidence) || 0, 0, 1);
  const targetId = typeof result?.targetId === "string" ? result.targetId : null;
  return {
    matched: Boolean(result?.matched && targetId),
    targetId,
    confidence,
    provider: result?.provider || provider,
    reason: result?.reason || null,
  };
}

export function makeDebugMatch(targetId) {
  return { matched: true, targetId, confidence: 1, provider: "debug", reason: "manual-debug" };
}

function noMatch(provider, confidence, reason) {
  return { matched: false, targetId: null, confidence, provider, reason };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

