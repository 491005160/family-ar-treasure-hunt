"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CameraController, cameraErrorMessage } from "./core/camera.js";
import { captureFrame } from "./core/capture.js";
import { TARGETS, createConfiguredTargets, getTarget } from "./core/targets.js";
import { createEmbeddingMatcher, createMockMatcher, makeDebugMatch } from "./core/matcher.js";
import {
  clearStoredGame,
  createInitialGameState,
  getCurrentTargetId,
  gameReducer,
  readStoredGame,
  writeStoredGame,
} from "./core/game.js";
import { FAILURE_ASSIST_THRESHOLD, failureHelp, feedbackForMatch, formatConfidence } from "./core/ui.js";

type Feedback = { tone: string; title: string; detail: string };
type ZoomInfo = { min: number; max: number; step: number; value: number; presets: number[] };
type TorchInfo = { supported: boolean; enabled: boolean };
type SimilarityScore = { targetId: string; similarity: number | null; excluded?: boolean; referenceCount?: number };
type MatchResult = {
  matched: boolean;
  targetId: string | null;
  confidence: number;
  provider: string;
  reason?: string | null;
  scores?: SimilarityScore[];
  top1?: { targetId: string; similarity: number } | null;
  top2?: { targetId: string; similarity: number } | null;
  margin?: number | null;
};

const TARGET_IDS = TARGETS.map((target) => target.id);
type CustomReferences = Record<string, string[]>;

export default function Home() {
  const [game, dispatch] = useReducer(gameReducer, undefined, createInitialGameState);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraCount, setCameraCount] = useState(0);
  const [zoomInfo, setZoomInfo] = useState<ZoomInfo | null>(null);
  const [torchInfo, setTorchInfo] = useState<TorchInfo | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugEnabled] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1",
  );
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [lastRecognition, setLastRecognition] = useState<string | null>(null);
  const [customReferences, setCustomReferences] = useState<CustomReferences>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const focusFrameRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<CameraController | null>(null);
  const customReferenceUrlsRef = useRef<CustomReferences>({});
  const activeTargets = useMemo(() => createConfiguredTargets(customReferences), [customReferences]);
  const matcher = useMemo(
    () => debugEnabled ? createMockMatcher() : createEmbeddingMatcher(),
    [debugEnabled],
  );

  useEffect(() => {
    cameraRef.current = new CameraController();
    const restored = readStoredGame(TARGET_IDS);
    if (restored) dispatch({ type: "RESTORE", state: restored, targetIds: TARGET_IDS });
    return () => {
      cameraRef.current?.stop();
      revokeReferenceUrls(customReferenceUrlsRef.current);
    };
  }, []);

  useEffect(() => {
    writeStoredGame(game);
  }, [game]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const startCamera = async () => {
    setStarting(true);
    setCameraError(null);
    try {
      const info = await cameraRef.current?.start(videoRef.current);
      setCameraActive(true);
      setCameraCount(info?.deviceCount ?? 1);
      setZoomInfo(info?.zoom ?? null);
      setTorchInfo(info?.torch ?? null);
      dispatch({ type: "START" });
      void matcher.prepare?.(activeTargets).catch(() => undefined);
    } catch (error) {
      setCameraActive(false);
      setCameraError(cameraErrorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  const enterDemoMode = () => {
    setCameraError(null);
    setCameraActive(false);
    setZoomInfo(null);
    setTorchInfo(null);
    dispatch({ type: "START" });
  };

  const submitResult = (result: MatchResult) => {
    const accepted = result.matched && TARGET_IDS.includes(result.targetId) && !game.foundIds.includes(result.targetId);
    const target = accepted ? getTarget(result.targetId, activeTargets) : null;
    dispatch({ type: "MATCH_RESULT", result, targetIds: TARGET_IDS });
    setFeedback(feedbackForMatch({ ...result, accepted }, target));
  };

  const takePhoto = async () => {
    if (isMatching) return;
    setIsMatching(true);
    try {
      const capture = await captureFrame(videoRef.current, { frameElement: focusFrameRef.current });
      setLastCapture(capture.fullDataUrl);
      setLastRecognition(capture.recognitionDataUrl);
      const result = await matcher.match(capture, { targets: activeTargets, foundIds: game.foundIds });
      submitResult(result);
    } catch (error) {
      const result = { matched: false, targetId: null, confidence: 0, provider: "error", reason: cameraErrorMessage(error) };
      dispatch({ type: "MATCH_RESULT", result, targetIds: TARGET_IDS });
      setFeedback({ tone: "miss", title: "这次没拍好", detail: "请稳住手机再试一次" });
    } finally {
      setIsMatching(false);
    }
  };

  const switchCamera = async () => {
    try {
      const info = await cameraRef.current?.switchCamera();
      setCameraCount(info?.deviceCount ?? cameraCount);
      setZoomInfo(info?.zoom ?? null);
      setTorchInfo(info?.torch ?? null);
    } catch (error) {
      setFeedback({ tone: "miss", title: "切换失败", detail: cameraErrorMessage(error) });
    }
  };

  const changeZoom = async (value: number) => {
    try {
      const zoom = await cameraRef.current?.setZoom(value);
      setZoomInfo(zoom ?? null);
    } catch (error) {
      setFeedback({ tone: "miss", title: "变焦失败", detail: cameraErrorMessage(error) });
    }
  };

  const toggleTorch = async () => {
    try {
      const torch = await cameraRef.current?.setTorch(!torchInfo?.enabled);
      setTorchInfo(torch ?? null);
    } catch (error) {
      setFeedback({ tone: "miss", title: "补光开启失败", detail: cameraErrorMessage(error) });
    }
  };

  const resetGame = (keepPlaying = false) => {
    matcher.reset();
    clearStoredGame();
    setFeedback(null);
    setLastCapture(null);
    setLastRecognition(null);
    setPreviewTargetId(null);
    setDebugOpen(false);
    dispatch({ type: "RESET", keepPlaying });
    if (!keepPlaying) {
      cameraRef.current?.stop();
      setCameraActive(false);
      setZoomInfo(null);
      setTorchInfo(null);
    }
  };

  const chooseTreasurePhotos = (targetId: string, files: FileList | null) => {
    const selected = Array.from(files ?? []).filter((file) => file.type.startsWith("image/")).slice(0, 5);
    if (!selected.length) return;

    revokeReferenceUrls({ [targetId]: customReferenceUrlsRef.current[targetId] ?? [] });
    const urls = selected.map((file) => URL.createObjectURL(file));
    customReferenceUrlsRef.current = { ...customReferenceUrlsRef.current, [targetId]: urls };
    matcher.reset();
    clearStoredGame();
    dispatch({ type: "RESET", keepPlaying: false });
    setCustomReferences((current) => ({ ...current, [targetId]: urls }));
  };

  const restoreDefaultTreasure = (targetId: string) => {
    revokeReferenceUrls({ [targetId]: customReferenceUrlsRef.current[targetId] ?? [] });
    const nextUrls = { ...customReferenceUrlsRef.current };
    delete nextUrls[targetId];
    customReferenceUrlsRef.current = nextUrls;
    matcher.reset();
    clearStoredGame();
    dispatch({ type: "RESET", keepPlaying: false });
    setCustomReferences((current) => {
      const next = { ...current };
      delete next[targetId];
      return next;
    });
  };

  const currentTargetId = getCurrentTargetId(TARGET_IDS, game.foundIds);
  const previewTarget = previewTargetId ? getTarget(previewTargetId, activeTargets) : null;

  if (game.phase === "complete") {
    return (
      <main className="app-shell complete-shell">
        <section className="complete-screen" aria-labelledby="complete-title">
          <div className="complete-burst" aria-hidden="true">★</div>
          <p className="eyebrow">任务完成 · 4/4</p>
          <h1 id="complete-title">宝藏<br />全部找到！</h1>
          <p className="intro">你发现了家里的所有秘密，<br />今天的寻宝家就是你。</p>
          <div className="complete-grid">
            {activeTargets.map((target) => (
              <div className="complete-treasure" key={target.id}>
                <span aria-hidden="true"><img src={target.referenceImages[0]} alt="" /></span>
                <small>{target.shortName}</small>
              </div>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={() => resetGame(false)}>
            <span>再玩一次</span><span aria-hidden="true">↻</span>
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${game.phase === "playing" ? "camera-shell" : ""}`}>
      <video ref={videoRef} className={cameraActive ? "camera-video is-active" : "camera-video"} playsInline muted autoPlay />

      {game.phase === "start" ? (
        <section className="start-screen" aria-labelledby="start-title">
          <div className="brand-mark" aria-hidden="true"><span className="brand-map">⌖</span><span className="brand-spark">✦</span></div>
          <p className="eyebrow">家庭探险 · 01</p>
          <h1 id="start-title">准备好<br />寻宝了吗？</h1>
          <p className="intro">
            {game.foundIds.length > 0
              ? <>上次已找到 {game.foundIds.length}/4 件宝藏，<br />重新打开摄像头继续出发。</>
              : <>仔细观察家里的每个角落，<br />找齐 4 件神秘宝藏。</>}
          </p>
          <div className="treasure-picker" aria-label="开始前选择宝藏照片">
            {activeTargets.map((target, index) => {
              const customCount = customReferences[target.id]?.length ?? 0;
              return (
                <div className={`treasure-pick ${customCount ? "is-custom" : ""}`} key={target.id}>
                  <img src={target.referenceImages[0]} alt={`宝藏 ${index + 1} 参考图`} />
                  <span>{customCount ? `宝藏 ${index + 1} · ${customCount}张` : `示例 ${index + 1}`}</span>
                  <label>
                    {customCount ? "重新选择" : "更换照片"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => {
                        chooseTreasurePhotos(target.id, event.currentTarget.files);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {customCount > 0 && <button type="button" onClick={() => restoreDefaultTreasure(target.id)}>恢复示例</button>}
                </div>
              );
            })}
          </div>
          <p className="local-photo-note">每个宝藏可选 1～5 张 · 照片只在当前页面使用</p>
          <button className="primary-button" type="button" onClick={startCamera} disabled={starting}>
            <span>{starting ? "正在打开摄像头…" : game.foundIds.length > 0 ? `继续寻宝 ${game.foundIds.length}/4` : "开始寻宝"}</span><span aria-hidden="true">→</span>
          </button>
          <p className="permission-note">开始后需要使用后置摄像头</p>
          {game.foundIds.length > 0 && (
            <button className="restart-button" type="button" onClick={() => resetGame(false)}>清除进度，重新开始</button>
          )}
          {cameraError && (
            <div className="permission-card" role="alert">
              <strong>还没看到摄像头</strong>
              <p>{cameraError}</p>
              <div className="permission-actions">
                <button type="button" onClick={startCamera}>重试权限</button>
                <button type="button" onClick={enterDemoMode}>先玩演示版</button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="hunt-screen" aria-label="寻宝相机">
          {!cameraActive && (
            <div className="demo-camera" aria-hidden="true"><span>⌖</span><p>演示取景画面</p></div>
          )}
          <div className="camera-shade" aria-hidden="true" />

          <header className="hunt-header">
            <div className="hud-row">
              <div className="progress-pill"><strong>{game.foundIds.length}</strong><span>/4</span></div>
              <div className="mode-pill">{debugEnabled ? "MOCK 演示识别" : "寻找当前宝藏"}</div>
              {cameraCount > 1 && <button className="icon-button" type="button" aria-label="切换摄像头" onClick={switchCamera}>镜头</button>}
            </div>
            <div className="treasure-slots" aria-label={`已找到 ${game.foundIds.length} 个宝藏，共 4 个`}>
              {activeTargets.map((target, index) => {
                const found = game.foundIds.includes(target.id);
                const current = target.id === currentTargetId;
                const slotClassName = [
                  "treasure-slot",
                  found ? "is-found" : "",
                  current ? "is-current" : "",
                ].filter(Boolean).join(" ");
                return (
                  <div className={slotClassName} key={target.id} style={{ "--slot-color": target.color } as React.CSSProperties}>
                    <small>0{index + 1}</small>
                    <button
                      className="slot-visual"
                      type="button"
                      aria-label={found ? `查看已找到的${target.name}` : current ? `放大当前目标：${target.name}` : "尚未解锁"}
                      disabled={!found && !current}
                      onClick={() => setPreviewTargetId(target.id)}
                    >
                      {found || current ? <img src={target.referenceImages[0]} alt="" /> : "?"}
                    </button>
                    <b>{found || current ? target.shortName : "未知"}</b>
                  </div>
                );
              })}
            </div>
          </header>

          <div className="focus-frame" ref={focusFrameRef} aria-hidden="true"><i /><i /><i /><i /></div>

          <div className="hunt-footer">
            {(zoomInfo?.presets.length ?? 0) > 1 || torchInfo?.supported ? (
              <div className="camera-tools">
                {zoomInfo && zoomInfo.presets.length > 1 && (
                  <div className="zoom-controls" aria-label="摄像头焦段">
                    {zoomInfo.presets.map((value) => (
                      <button
                        className={Math.abs(zoomInfo.value - value) < zoomInfo.step / 2 + 0.001 ? "is-active" : ""}
                        type="button"
                        key={value}
                        aria-label={`切换到 ${formatZoom(value)} 倍焦段`}
                        aria-pressed={Math.abs(zoomInfo.value - value) < zoomInfo.step / 2 + 0.001}
                        onClick={() => changeZoom(value)}
                      >
                        {formatZoom(value)}×
                      </button>
                    ))}
                  </div>
                )}
                {torchInfo?.supported && (
                  <button className={`torch-control ${torchInfo.enabled ? "is-active" : ""}`} type="button" aria-label={torchInfo.enabled ? "关闭补光" : "打开补光"} aria-pressed={torchInfo.enabled} onClick={toggleTorch}>
                    <span aria-hidden="true">⚡</span>补光
                  </button>
                )}
              </div>
            ) : null}
            {failureHelp(game.consecutiveFailures) && (
              <div className="assist-card" role="status">
                <strong>{game.consecutiveFailures >= 5 ? (debugEnabled ? "启用降级通道" : "识别未通过") : "试试这样拍"}</strong>
                <span>{failureHelp(game.consecutiveFailures)}</span>
                {debugEnabled && <button type="button" onClick={() => setDebugOpen(true)}>打开调试模式</button>}
              </div>
            )}
            <p className="capture-hint">{isMatching ? "正在提取宝藏特征…" : "将你认为的宝藏放入框内"}</p>
            <button className={`capture-button ${isMatching ? "is-busy" : ""}`} type="button" aria-label="拍摄并识别" onClick={takePhoto} disabled={isMatching}><span /></button>
            {debugEnabled && (
              <button className="debug-trigger" type="button" onClick={() => setDebugOpen(true)} aria-label="打开调试模式">
                调试{game.consecutiveFailures >= FAILURE_ASSIST_THRESHOLD && <i />}
              </button>
            )}
          </div>

          {feedback && (
            <div className={`feedback-toast ${feedback.tone}`} role="status" aria-live="polite">
              <span aria-hidden="true">{feedback.tone === "success" ? "★" : "↗"}</span>
              <div><strong>{feedback.title}</strong><small>{feedback.detail}</small></div>
            </div>
          )}

          {previewTarget && (
            <div className="preview-backdrop" role="dialog" aria-modal="true" aria-label="目标参考图预览">
              <button className="preview-dismiss-layer" type="button" aria-label="关闭图片预览" onClick={() => setPreviewTargetId(null)} />
              <div className="preview-card">
                <button className="preview-close" type="button" aria-label="关闭图片预览" onClick={() => setPreviewTargetId(null)}>×</button>
                <img src={previewTarget.referenceImages[0]} alt={previewTarget.name} />
                <strong>{previewTarget.name}</strong>
                <p>{previewTarget.clue}</p>
              </div>
            </div>
          )}

          {debugEnabled && debugOpen && (
            <div className="debug-backdrop">
              <button className="debug-dismiss-layer" type="button" aria-label="关闭调试模式" onClick={() => setDebugOpen(false)} />
              <aside className="debug-panel" role="dialog" aria-modal="true" aria-labelledby="debug-title">
                <div className="debug-heading">
                  <div><span>INTERNAL TEST</span><h2 id="debug-title">调试模式</h2></div>
                  <button type="button" onClick={() => setDebugOpen(false)} aria-label="关闭调试模式">×</button>
                </div>
                <p className="debug-copy">直接点亮目标，用于测试进度、反馈与完成页。</p>
                <div className="debug-targets">
                  {activeTargets.map((target) => {
                    const found = game.foundIds.includes(target.id);
                    return (
                      <button type="button" key={target.id} disabled={found} onClick={() => submitResult(makeDebugMatch(target.id))}>
                        <span><img src={target.referenceImages[0]} alt="" /></span><b>{target.name}</b><small>{found ? "已找到" : "模拟成功"}</small>
                      </button>
                    );
                  })}
                </div>
                <div className="match-inspector">
                  <div><span>最近结果</span><strong>{game.lastMatch ? (game.lastMatch.accepted ? "MATCH" : "MISS") : "—"}</strong></div>
                  <div><span>Top1</span><strong>{formatMatchRank(game.lastMatch?.top1, activeTargets)}</strong></div>
                  <div><span>Top2</span><strong>{formatMatchRank(game.lastMatch?.top2, activeTargets)}</strong></div>
                  <div><span>margin</span><strong>{formatConfidence(game.lastMatch?.margin)}</strong></div>
                  <div><span>provider</span><strong>{game.lastMatch?.provider ?? "—"}</strong></div>
                  <div><span>reason</span><strong>{game.lastMatch?.reason ?? "—"}</strong></div>
                </div>
                {game.lastMatch?.scores?.length > 0 && (
                  <div className="similarity-table" aria-label="四个目标相似度">
                    {game.lastMatch.scores.map((score: SimilarityScore) => (
                      <div key={score.targetId}>
                        <span>{getTarget(score.targetId, activeTargets)?.shortName ?? score.targetId}</span>
                        <strong>{score.excluded ? "已排除" : formatConfidence(score.similarity)}</strong>
                      </div>
                    ))}
                  </div>
                )}
                {(lastCapture || lastRecognition) && (
                  <div className="debug-captures">
                    {lastRecognition && <figure><img src={lastRecognition} alt="中央框实际识别图片" /><figcaption>实际识别裁剪</figcaption></figure>}
                    {lastCapture && <figure><img src={lastCapture} alt="最近一次完整截图" /><figcaption>完整截图（仅 Debug）</figcaption></figure>}
                  </div>
                )}
                <button className="reset-button" type="button" onClick={() => resetGame(true)}>重置本局进度</button>
              </aside>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function formatZoom(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatMatchRank(rank: { targetId: string; similarity: number } | null | undefined, targets: ReturnType<typeof createConfiguredTargets>) {
  if (!rank) return "—";
  return `${getTarget(rank.targetId, targets)?.shortName ?? rank.targetId} ${formatConfidence(rank.similarity)}`;
}

function revokeReferenceUrls(references: CustomReferences) {
  for (const urls of Object.values(references)) {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
