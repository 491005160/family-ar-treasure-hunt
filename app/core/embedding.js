const DEFAULT_MODEL_PATH = "./models/mobilenet-v2-050/model.json";

export function createMobileNetEmbedder({ modelUrl = DEFAULT_MODEL_PATH } = {}) {
  let modelPromise = null;
  const referenceCache = new Map();

  const getModel = async () => {
    if (!modelPromise) {
      modelPromise = Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/mobilenet"),
      ]).then(async ([tf, mobilenet]) => {
        await tf.ready();
        const resolvedModelUrl = new URL(modelUrl, document.baseURI).href;
        return mobilenet.load({
          version: 2,
          alpha: 0.5,
          modelUrl: resolvedModelUrl,
          inputRange: [0, 1],
        });
      });
    }
    return modelPromise;
  };

  const embedDrawable = async (drawable) => {
    const model = await getModel();
    const canvas = drawSquare(drawable, 224);
    const tensor = model.infer(canvas, true);
    try {
      return normalizeEmbedding(Array.from(await tensor.data()));
    } finally {
      tensor.dispose();
    }
  };

  const embedUrl = async (url) => {
    const resolvedUrl = new URL(url, document.baseURI).href;
    if (!referenceCache.has(resolvedUrl)) {
      referenceCache.set(resolvedUrl, loadImage(resolvedUrl).then(embedDrawable));
    }
    return referenceCache.get(resolvedUrl);
  };

  return {
    id: "mobilenet-v2-050",
    async embedBlob(blob) {
      if (!blob) throw new Error("缺少待识别图片");
      if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        try {
          return await embedDrawable(bitmap);
        } finally {
          bitmap.close();
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      try {
        return await embedDrawable(await loadImage(objectUrl));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    async embedUrl(url) {
      return embedUrl(url);
    },
    async prepare(targets) {
      await getModel();
      for (const target of targets) {
        for (const referenceUrl of target.referenceImages) {
          await embedUrl(referenceUrl);
        }
      }
    },
    reset() {
      referenceCache.clear();
    },
  };
}

export function cosineSimilarity(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length || !first.length) return -1;
  return first.reduce((sum, value, index) => sum + value * second[index], 0);
}

export function normalizeEmbedding(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function drawSquare(image, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法准备识别图片");

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const cropSize = Math.min(width, height);
  context.drawImage(
    image,
    (width - cropSize) / 2,
    (height - cropSize) / 2,
    cropSize,
    cropSize,
    0,
    0,
    size,
    size,
  );
  return canvas;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("识别资源加载失败：" + url));
    image.src = url;
  });
}
