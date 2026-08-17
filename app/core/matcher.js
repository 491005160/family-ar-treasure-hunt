/**
 * Matcher 统一返回：
 * { matched, targetId, confidence, provider, reason }
 * 页面与游戏状态只依赖这个结构，因此可无痛替换为本地模型或远程识别服务。
 */

export const LOCAL_MATCH_THRESHOLD = 0.88;

export function createReferenceMatcher({
  threshold = LOCAL_MATCH_THRESHOLD,
  describeCapture = describeBlob,
  describeReference = describeImageUrl,
} = {}) {
  const referenceCache = new Map();

  return {
    provider: "local-reference",
    async match(capture, context) {
      if (capture?.demo) return noMatch("local-reference", 0, "camera-inactive");

      const currentTarget = context.targets.find((target) => !context.foundIds.includes(target.id));
      if (!currentTarget) return noMatch("local-reference", 1, "all-complete");

      const captureDescriptor = await describeCapture(capture.blob);
      let bestScore = 0;

      for (const referenceUrl of currentTarget.referenceImages) {
        if (!referenceCache.has(referenceUrl)) {
          referenceCache.set(referenceUrl, Promise.resolve(describeReference(referenceUrl)));
        }
        const referenceDescriptor = await referenceCache.get(referenceUrl);
        bestScore = Math.max(bestScore, compareImageDescriptors(captureDescriptor, referenceDescriptor));
      }

      const confidence = clamp(bestScore, 0, 1);
      if (confidence < threshold) {
        return noMatch("local-reference", confidence, "below-threshold");
      }

      return {
        matched: true,
        targetId: currentTarget.id,
        confidence,
        provider: "local-reference",
        reason: "reference-similarity",
      };
    },
    reset() {},
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

export function compareImageDescriptors(first, second) {
  if (!first || !second) return 0;
  const histogramSimilarity = vectorSimilarity(first.histogram, second.histogram, 6);
  const colorSimilarity = vectorSimilarity(first.colorGrid, second.colorGrid, first.colorGrid.length);
  const structureSimilarity = vectorSimilarity(first.structureGrid, second.structureGrid, first.structureGrid.length * 3);
  return clamp(
    histogramSimilarity * 0.45 + colorSimilarity * 0.35 + structureSimilarity * 0.2,
    0,
    1,
  );
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

function vectorSimilarity(first, second, maximumDistance) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length || !first.length) return 0;
  const distance = first.reduce((total, value, index) => total + Math.abs(value - second[index]), 0);
  return 1 - clamp(distance / maximumDistance, 0, 1);
}

async function describeBlob(blob) {
  if (!blob) throw new Error("缺少待识别图片");
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      return describeDrawable(bitmap);
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return describeDrawable(await loadImage(objectUrl));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function describeImageUrl(url) {
  return describeDrawable(await loadImage(url));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("参考图加载失败：" + url));
    image.src = url;
  });
}

function describeDrawable(image) {
  const sampleSize = 32;
  const canvas = document.createElement("canvas");
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("无法分析图片");

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const cropSize = Math.min(width, height) * 0.82;
  const sourceX = (width - cropSize) / 2;
  const sourceY = (height - cropSize) / 2;
  context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, sampleSize, sampleSize);
  return descriptorFromPixels(context.getImageData(0, 0, sampleSize, sampleSize).data, sampleSize);
}

function descriptorFromPixels(pixels, sampleSize) {
  const histogram = Array(24).fill(0);
  const colorGrid = [];
  const luminance = [];
  const pixelCount = sampleSize * sampleSize;
  const rawPixels = [];

  for (let offset = 0; offset < pixels.length; offset += 4) {
    rawPixels.push([pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255]);
  }

  const rawAverage = rawPixels.reduce(
    (total, [red, green, blue]) => total + red * 0.299 + green * 0.587 + blue * 0.114,
    0,
  ) / rawPixels.length;
  const exposureGain = clamp(0.5 / (rawAverage || 0.5), 0.65, 1.65);
  const normalizedPixels = rawPixels.map(([red, green, blue]) => [
    clamp(red * exposureGain, 0, 1),
    clamp(green * exposureGain, 0, 1),
    clamp(blue * exposureGain, 0, 1),
  ]);

  for (const [red, green, blue] of normalizedPixels) {
    histogram[Math.min(7, Math.floor(red * 8))] += 1 / pixelCount;
    histogram[8 + Math.min(7, Math.floor(green * 8))] += 1 / pixelCount;
    histogram[16 + Math.min(7, Math.floor(blue * 8))] += 1 / pixelCount;
    luminance.push(red * 0.299 + green * 0.587 + blue * 0.114);
  }

  const blockSize = 4;
  for (let blockY = 0; blockY < 8; blockY += 1) {
    for (let blockX = 0; blockX < 8; blockX += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let y = 0; y < blockSize; y += 1) {
        for (let x = 0; x < blockSize; x += 1) {
          const pixelIndex = (blockY * blockSize + y) * sampleSize + blockX * blockSize + x;
          red += normalizedPixels[pixelIndex][0];
          green += normalizedPixels[pixelIndex][1];
          blue += normalizedPixels[pixelIndex][2];
        }
      }
      colorGrid.push(red / 16, green / 16, blue / 16);
    }
  }

  const average = luminance.reduce((total, value) => total + value, 0) / luminance.length;
  const deviation = Math.sqrt(
    luminance.reduce((total, value) => total + (value - average) ** 2, 0) / luminance.length,
  ) || 1;
  const structureGrid = colorGrid
    .filter((_, index) => index % 3 === 0)
    .map((_, index) => {
      const startX = (index % 8) * blockSize;
      const startY = Math.floor(index / 8) * blockSize;
      let blockLuminance = 0;
      for (let y = 0; y < blockSize; y += 1) {
        for (let x = 0; x < blockSize; x += 1) {
          blockLuminance += luminance[(startY + y) * sampleSize + startX + x];
        }
      }
      return clamp((blockLuminance / 16 - average) / deviation, -3, 3);
    });

  return { histogram, colorGrid, structureGrid };
}
