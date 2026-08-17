import { cosineSimilarity, createMobileNetEmbedder } from "./embedding.js";

/**
 * matcher 稳定返回：
 * { matched, targetId, confidence, provider, reason, scores, top1, top2, margin }
 * 页面与游戏状态只依赖该结构，后续仍可替换成其他本地模型或远程服务。
 */

// 来自 scripts/calibrate-embedding.mjs 的首轮四目标对照数据。
export const EMBEDDING_MATCH_RULES = Object.freeze({
  minimumSimilarity: 0.62,
  minimumMargin: 0.1,
});

export function createEmbeddingMatcher({
  embedder = createMobileNetEmbedder(),
  rules = EMBEDDING_MATCH_RULES,
} = {}) {
  return {
    provider: "semantic-embedding",
    async prepare(targets) {
      await embedder.prepare?.(targets);
    },
    async match(capture, context) {
      if (capture?.demo) return noMatch("semantic-embedding", 0, "camera-inactive");

      const availableTargets = context.targets.filter((target) => !context.foundIds.includes(target.id));
      if (!availableTargets.length) return noMatch("semantic-embedding", 1, "all-complete");

      const captureEmbedding = await embedder.embedBlob(capture.blob);
      const activeScores = [];
      const scores = [];

      for (const target of context.targets) {
        if (context.foundIds.includes(target.id)) {
          scores.push({ targetId: target.id, similarity: null, excluded: true, referenceCount: target.referenceImages.length });
          continue;
        }

        const similarities = [];
        for (const referenceUrl of target.referenceImages) {
          similarities.push(cosineSimilarity(captureEmbedding, await embedder.embedUrl(referenceUrl)));
        }
        if (!similarities.length) {
          scores.push({ targetId: target.id, similarity: null, excluded: true, referenceCount: 0 });
          continue;
        }
        const similarity = Math.max(...similarities);
        const score = {
          targetId: target.id,
          similarity,
          excluded: false,
          referenceCount: similarities.length,
        };
        scores.push(score);
        activeScores.push(score);
      }

      activeScores.sort((first, second) => second.similarity - first.similarity);
      const top1 = activeScores[0] ?? null;
      const top2 = activeScores[1] ?? null;
      const margin = top1 && top2 ? top1.similarity - top2.similarity : null;
      const similarityPass = Boolean(top1 && top1.similarity >= rules.minimumSimilarity);
      const marginPass = Boolean(top1 && (!top2 || margin >= rules.minimumMargin));
      const matched = similarityPass && marginPass;
      const reason = !similarityPass
        ? "top1-below-minimum"
        : !marginPass
          ? "top1-top2-margin-too-small"
          : "embedding-match";

      return {
        matched,
        targetId: matched ? top1.targetId : null,
        confidence: top1?.similarity ?? 0,
        provider: "semantic-embedding",
        reason,
        scores,
        top1: top1 ? { targetId: top1.targetId, similarity: top1.similarity } : null,
        top2: top2 ? { targetId: top2.targetId, similarity: top2.similarity } : null,
        margin,
        rules,
      };
    },
    reset() {
      embedder.reset?.();
    },
  };
}

export function createMockMatcher() {
  let attempt = 0;
  return {
    provider: "mock",
    async match(_capture, context) {
      attempt += 1;
      const available = context.targets.filter((target) => !context.foundIds.includes(target.id));
      if (!available.length) return noMatch("mock", 0.99, "all-complete");
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
    ...result,
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
  return {
    matched: false,
    targetId: null,
    confidence,
    provider,
    reason,
    scores: [],
    top1: null,
    top2: null,
    margin: null,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
