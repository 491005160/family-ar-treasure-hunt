export async function captureFrame(videoElement, options = {}) {
  const {
    frameElement = null,
    maxWidth = 960,
    recognitionSize = 384,
    quality = 0.84,
  } = options;
  if (!videoElement || videoElement.readyState < 2 || !videoElement.videoWidth) {
    return createDemoCapture();
  }

  const fullScale = Math.min(1, maxWidth / videoElement.videoWidth);
  const fullWidth = Math.round(videoElement.videoWidth * fullScale);
  const fullHeight = Math.round(videoElement.videoHeight * fullScale);
  const fullCanvas = createCanvas(fullWidth, fullHeight);
  fullCanvas.context.drawImage(videoElement, 0, 0, fullWidth, fullHeight);

  const crop = calculateCoverCrop(
    { width: videoElement.videoWidth, height: videoElement.videoHeight },
    normalizeRect(videoElement.getBoundingClientRect()),
    frameElement ? normalizeRect(frameElement.getBoundingClientRect()) : null,
  );
  const recognitionCanvas = createCanvas(recognitionSize, recognitionSize);
  recognitionCanvas.context.drawImage(
    videoElement,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    recognitionSize,
    recognitionSize,
  );

  const [full, recognition] = await Promise.all([
    canvasResult(fullCanvas.canvas, quality),
    canvasResult(recognitionCanvas.canvas, quality),
  ]);
  return {
    blob: recognition.blob,
    dataUrl: recognition.dataUrl,
    recognitionBlob: recognition.blob,
    recognitionDataUrl: recognition.dataUrl,
    fullBlob: full.blob,
    fullDataUrl: full.dataUrl,
    width: recognitionSize,
    height: recognitionSize,
    fullWidth,
    fullHeight,
    crop,
    takenAt: new Date().toISOString(),
    demo: false,
  };
}

export function calculateCoverCrop(videoSize, displayRect, frameRect) {
  const fallbackSize = Math.min(videoSize.width, videoSize.height) * 0.56;
  if (!displayRect?.width || !displayRect?.height || !frameRect?.width || !frameRect?.height) {
    return squareCrop(videoSize, (videoSize.width - fallbackSize) / 2, (videoSize.height - fallbackSize) / 2, fallbackSize);
  }

  const scale = Math.max(displayRect.width / videoSize.width, displayRect.height / videoSize.height);
  const renderedWidth = videoSize.width * scale;
  const renderedHeight = videoSize.height * scale;
  const hiddenX = (renderedWidth - displayRect.width) / 2;
  const hiddenY = (renderedHeight - displayRect.height) / 2;
  const frameSize = Math.min(frameRect.width, frameRect.height);
  const sourceX = (frameRect.left - displayRect.left + hiddenX) / scale;
  const sourceY = (frameRect.top - displayRect.top + hiddenY) / scale;
  const sourceSize = frameSize / scale;
  return squareCrop(videoSize, sourceX, sourceY, sourceSize);
}

async function createDemoCapture() {
  const { canvas, context } = createCanvas(720, 720);
  const gradient = context.createLinearGradient(0, 0, 720, 720);
  gradient.addColorStop(0, "#163847");
  gradient.addColorStop(1, "#09151c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 720, 720);
  const result = await canvasResult(canvas, 0.75);
  return {
    blob: result.blob,
    dataUrl: result.dataUrl,
    recognitionBlob: result.blob,
    recognitionDataUrl: result.dataUrl,
    fullBlob: result.blob,
    fullDataUrl: result.dataUrl,
    width: 720,
    height: 720,
    fullWidth: 720,
    fullHeight: 720,
    crop: { x: 0, y: 0, width: 720, height: 720 },
    takenAt: new Date().toISOString(),
    demo: true,
  };
}

function squareCrop(videoSize, x, y, size) {
  const safeSize = Math.max(1, Math.min(size, videoSize.width, videoSize.height));
  return {
    x: Math.max(0, Math.min(videoSize.width - safeSize, x)),
    y: Math.max(0, Math.min(videoSize.height - safeSize, y)),
    width: safeSize,
    height: safeSize,
  };
}

function normalizeRect(rect) {
  return rect ? {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  } : null;
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建截图画布");
  return { canvas, context };
}

function canvasResult(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("截图生成失败"));
      resolve({
        blob,
        dataUrl: canvas.toDataURL("image/jpeg", Math.min(quality, 0.72)),
      });
    }, "image/jpeg", quality);
  });
}
