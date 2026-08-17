export class CameraController {
  constructor() {
    this.stream = null;
    this.videoElement = null;
  }

  async start(videoElement) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头访问，请使用最新版手机浏览器。");
    }

    this.stop();
    this.videoElement = videoElement;
    const video = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };

    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    videoElement.srcObject = this.stream;
    await videoElement.play();

    const track = this.stream.getVideoTracks()[0];
    let zoom = readZoomInfo(track);
    if (zoom?.presets.includes(1) && Math.abs(zoom.value - 1) >= zoom.step / 2) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: 1 }] });
        zoom = readZoomInfo(track);
      } catch {
        // 个别浏览器会公开 zoom 能力但拒绝初始化约束，保留系统默认焦段即可。
      }
    }
    return {
      zoom,
      torch: readTorchInfo(track),
    };
  }

  async setZoom(value) {
    const track = this.stream?.getVideoTracks()[0];
    const zoom = readZoomInfo(track);
    if (!track || !zoom) return null;

    const nextValue = snapZoom(value, zoom.min, zoom.max, zoom.step);
    await track.applyConstraints({ advanced: [{ zoom: nextValue }] });
    return readZoomInfo(track);
  }

  async setTorch(enabled) {
    const track = this.stream?.getVideoTracks()[0];
    const torch = readTorchInfo(track);
    if (!track || !torch?.supported) return null;

    await track.applyConstraints({ advanced: [{ torch: Boolean(enabled) }] });
    return readTorchInfo(track);
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.videoElement) this.videoElement.srcObject = null;
  }

  get isActive() {
    return Boolean(this.stream?.active);
  }
}

export function readZoomInfo(track) {
  if (!track?.getCapabilities || !track?.getSettings) return null;
  const capabilities = track.getCapabilities();
  const range = capabilities?.zoom;
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min) return null;

  const min = Number(range.min);
  const max = Number(range.max);
  const step = Number.isFinite(range.step) && range.step > 0 ? Number(range.step) : 0.1;
  const current = snapZoom(Number(track.getSettings().zoom ?? min), min, max, step);
  return { min, max, step, value: current, presets: buildZoomPresets(min, max, step) };
}

export function buildZoomPresets(min, max, step = 0.1) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  return [...new Set([1, 2]
    .filter((value) => value >= min && value <= max)
    .map((value) => snapZoom(value, min, max, step)))]
    .sort((first, second) => first - second);
}

export function readTorchInfo(track) {
  if (!track?.getCapabilities || !track?.getSettings) return null;
  const supported = track.getCapabilities()?.torch === true;
  if (!supported) return null;
  return { supported: true, enabled: track.getSettings()?.torch === true };
}

function snapZoom(value, min, max, step) {
  const safeValue = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const steps = Math.round((safeValue - min) / step);
  return Number(Math.min(max, Math.max(min, min + steps * step)).toFixed(3));
}

export function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "摄像头权限被拒绝了。请在浏览器地址栏的权限设置中允许摄像头。";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "没有找到可用摄像头，你仍可进入演示模式测试玩法。";
  }
  if (error?.name === "NotReadableError") {
    return "摄像头正被其他应用占用，请关闭占用后重试。";
  }
  return error?.message || "暂时无法启动摄像头，请重试。";
}
