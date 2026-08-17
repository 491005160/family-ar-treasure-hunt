"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CameraController, cameraErrorMessage } from "./core/camera.js";
import { captureFrame } from "./core/capture.js";
import { TARGETS, getTarget } from "./core/targets.js";
import { createMockMatcher, makeDebugMatch } from "./core/matcher.js";
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

const TARGET_IDS = TARGETS.map((target) => target.id);

export default function Home() {
  const [game, dispatch] = useReducer(gameReducer, undefined, createInitialGameState);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraCount, setCameraCount] = useState(0);
  const [isMatching, setIsMatching] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugEnabled] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1",
  );
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<CameraController | null>(null);
  const matcher = useMemo(() => createMockMatcher(), []);

  useEffect(() => {
    cameraRef.current = new CameraController();
    const restored = readStoredGame(TARGET_IDS);
    if (restored) dispatch({ type: "RESTORE", state: restored, targetIds: TARGET_IDS });
    return () => cameraRef.current?.stop();
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
      dispatch({ type: "START" });
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
    dispatch({ type: "START" });
  };

  const submitResult = (result: ReturnType<typeof makeDebugMatch>) => {
    const accepted = result.matched && TARGET_IDS.includes(result.targetId) && !game.foundIds.includes(result.targetId);
    const target = accepted ? getTarget(result.targetId) : null;
    dispatch({ type: "MATCH_RESULT", result, targetIds: TARGET_IDS });
    setFeedback(feedbackForMatch({ ...result, accepted }, target));
  };

  const takePhoto = async () => {
    if (isMatching) return;
    setIsMatching(true);
    try {
      const capture = await captureFrame(videoRef.current);
      setLastCapture(capture.dataUrl);
      const result = await matcher.match(capture, { targets: TARGETS, foundIds: game.foundIds });
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
      await cameraRef.current?.switchCamera();
    } catch (error) {
      setFeedback({ tone: "miss", title: "切换失败", detail: cameraErrorMessage(error) });
    }
  };

  const resetGame = (keepPlaying = false) => {
    matcher.reset();
    clearStoredGame();
    setFeedback(null);
    setLastCapture(null);
    setDebugOpen(false);
    dispatch({ type: "RESET", keepPlaying });
    if (!keepPlaying) {
      cameraRef.current?.stop();
      setCameraActive(false);
    }
  };

  const currentTargetId = getCurrentTargetId(TARGET_IDS, game.foundIds);

  if (game.phase === "complete") {
    return (
      <main className="app-shell complete-shell">
        <section className="complete-screen" aria-labelledby="complete-title">
          <div className="complete-burst" aria-hidden="true">★</div>
          <p className="eyebrow">任务完成 · 4/4</p>
          <h1 id="complete-title">宝藏<br />全部找到！</h1>
          <p className="intro">你发现了家里的所有秘密，<br />今天的寻宝家就是你。</p>
          <div className="complete-grid">
            {TARGETS.map((target) => (
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
          <p className="intro">仔细观察家里的每个角落，<br />找齐 4 件神秘宝藏。</p>
          <button className="primary-button" type="button" onClick={startCamera} disabled={starting}>
            <span>{starting ? "正在打开摄像头…" : "开始寻宝"}</span><span aria-hidden="true">→</span>
          </button>
          <p className="permission-note">开始后需要使用后置摄像头</p>
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
              {cameraCount > 1 && <button className="icon-button" type="button" aria-label="切换摄像头" onClick={switchCamera}>↻</button>}
            </div>
            <div className="treasure-slots" aria-label={`已找到 ${game.foundIds.length} 个宝藏，共 4 个`}>
              {TARGETS.map((target, index) => {
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
                    <span className="slot-visual" aria-label={found ? `已找到${target.name}` : current ? `当前目标：${target.name}` : "尚未解锁"}>
                      {found || current ? <img src={target.referenceImages[0]} alt="" /> : "?"}
                    </span>
                    <b>{found || current ? target.shortName : "未知"}</b>
                  </div>
                );
              })}
            </div>
          </header>

          <div className="focus-frame" aria-hidden="true"><i /><i /><i /><i /></div>

          <div className="hunt-footer">
            {failureHelp(game.consecutiveFailures) && (
              <div className="assist-card" role="status">
                <strong>{game.consecutiveFailures >= 5 ? "启用降级通道" : "试试这样拍"}</strong>
                <span>{failureHelp(game.consecutiveFailures)}</span>
                {debugEnabled && <button type="button" onClick={() => setDebugOpen(true)}>打开调试模式</button>}
              </div>
            )}
            <p className="capture-hint">{isMatching ? "正在辨认宝藏…" : "把目标放进取景框"}</p>
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
                  {TARGETS.map((target) => {
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
                  <div><span>confidence</span><strong>{formatConfidence(game.lastMatch?.confidence)}</strong></div>
                  <div><span>provider</span><strong>{game.lastMatch?.provider ?? "—"}</strong></div>
                  {lastCapture && <img src={lastCapture} alt="最近一次拍摄缩略图" />}
                </div>
                <button className="reset-button" type="button" onClick={() => resetGame(true)}>重置本局进度</button>
              </aside>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
