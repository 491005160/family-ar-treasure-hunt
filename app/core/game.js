export const GAME_STORAGE_KEY = "family-treasure-hunt-v2";

export function createInitialGameState() {
  return {
    phase: "start",
    foundIds: [],
    consecutiveFailures: 0,
    attempts: 0,
    lastMatch: null,
  };
}

export function getCurrentTargetId(targetIds, foundIds) {
  return targetIds.find((targetId) => !foundIds.includes(targetId)) ?? null;
}

export function gameReducer(state, action) {
  switch (action.type) {
    case "START":
      return { ...state, phase: "playing" };
    case "MATCH_RESULT": {
      const result = action.result;
      const validTarget = action.targetIds.includes(result.targetId);
      const isNewMatch = result.matched && validTarget && !state.foundIds.includes(result.targetId);
      const foundIds = isNewMatch ? [...state.foundIds, result.targetId] : state.foundIds;
      return {
        ...state,
        phase: foundIds.length === action.targetIds.length ? "complete" : "playing",
        foundIds,
        consecutiveFailures: isNewMatch ? 0 : state.consecutiveFailures + 1,
        attempts: state.attempts + 1,
        lastMatch: { ...result, accepted: isNewMatch, at: new Date().toISOString() },
      };
    }
    case "RESTORE":
      return sanitizeRestoredState(action.state, action.targetIds);
    case "RESET":
      return { ...createInitialGameState(), phase: action.keepPlaying ? "playing" : "start" };
    default:
      return state;
  }
}

export function readStoredGame(targetIds, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(GAME_STORAGE_KEY);
    return raw ? sanitizeRestoredState(JSON.parse(raw), targetIds) : null;
  } catch {
    return null;
  }
}

export function writeStoredGame(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(GAME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 本地存储不可用不影响本轮游戏。
  }
}

export function clearStoredGame(storage = globalThis.localStorage) {
  try { storage?.removeItem(GAME_STORAGE_KEY); } catch { return; }
}

function sanitizeRestoredState(value, targetIds) {
  const foundIds = Array.isArray(value?.foundIds)
    ? [...new Set(value.foundIds.filter((id) => targetIds.includes(id)))]
    : [];
  return {
    phase: foundIds.length === targetIds.length ? "complete" : value?.phase === "start" ? "start" : "playing",
    foundIds,
    consecutiveFailures: Math.max(0, Number(value?.consecutiveFailures) || 0),
    attempts: Math.max(0, Number(value?.attempts) || 0),
    lastMatch: value?.lastMatch ?? null,
  };
}
