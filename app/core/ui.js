export const FAILURE_ASSIST_THRESHOLD = 3;

export function feedbackForMatch(result, target) {
  if (result?.accepted && target) {
    return { tone: "success", title: "找到宝藏！", detail: target.name };
  }
  return { tone: "miss", title: "还差一点", detail: "换个角度，让物品完整出现在画面里" };
}

export function failureHelp(count) {
  if (count < FAILURE_ASSIST_THRESHOLD) return null;
  if (count < 5) return "识别有点困难：靠近一点、保持光线充足，或换个角度再拍。";
  return "先别着急：让目标占据取景框中央，请家人帮忙调整光线后再试。";
}

export function formatConfidence(confidence) {
  if (!Number.isFinite(confidence)) return "—";
  return `${Math.round(confidence * 100)}%`;
}
