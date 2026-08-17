export async function captureFrame(videoElement, options = {}) {
  const { maxWidth = 960, quality = 0.84 } = options;
  if (!videoElement || videoElement.readyState < 2 || !videoElement.videoWidth) {
    return createDemoCapture();
  }

  const scale = Math.min(1, maxWidth / videoElement.videoWidth);
  const width = Math.round(videoElement.videoWidth * scale);
  const height = Math.round(videoElement.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建截图画布");
  context.drawImage(videoElement, 0, 0, width, height);
  return canvasResult(canvas, width, height, quality, false);
}

async function createDemoCapture() {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 960;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建演示截图");
  const gradient = context.createLinearGradient(0, 0, 720, 960);
  gradient.addColorStop(0, "#163847");
  gradient.addColorStop(1, "#09151c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 720, 960);
  return canvasResult(canvas, 720, 960, 0.75, true);
}

function canvasResult(canvas, width, height, quality, demo) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("截图生成失败"));
      resolve({
        blob,
        dataUrl: canvas.toDataURL("image/jpeg", Math.min(quality, 0.68)),
        width,
        height,
        takenAt: new Date().toISOString(),
        demo,
      });
    }, "image/jpeg", quality);
  });
}

