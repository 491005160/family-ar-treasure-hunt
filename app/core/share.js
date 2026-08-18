import { TARGETS } from "./targets.js";

const SHARE_PREFIX = "#hunt=";
const MAX_LINK_LENGTH = 180_000;

export async function compressTreasureImage(file, { maxSide = 384, quality = 0.72 } = {}) {
  if (!file?.type?.startsWith("image/")) throw new Error("请选择图片文件");

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("当前浏览器无法处理这张照片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

export function encodeSharedHunt(customReferences) {
  const images = TARGETS.flatMap((target) => {
    const image = customReferences?.[target.id]?.[0];
    return typeof image === "string" && image.startsWith("data:image/")
      ? [{ id: target.id, image }]
      : [];
  });
  if (!images.length) throw new Error("请先设置至少一个宝藏");
  return base64UrlEncode(JSON.stringify({ version: 1, images }));
}

export function decodeSharedHunt(payload) {
  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (parsed?.version !== 1 || !Array.isArray(parsed.images)) return {};
    const allowedIds = new Set(TARGETS.map((target) => target.id));
    return Object.fromEntries(
      parsed.images
        .filter(({ id, image }) => allowedIds.has(id) && typeof image === "string" && image.startsWith("data:image/"))
        .slice(0, 4)
        .map(({ id, image }) => [id, [image]]),
    );
  } catch {
    return {};
  }
}

export function parseSharedHunt(hash = globalThis.location?.hash ?? "") {
  return hash.startsWith(SHARE_PREFIX) ? decodeSharedHunt(hash.slice(SHARE_PREFIX.length)) : {};
}

export function sharedHuntStorageKey(hash = globalThis.location?.hash ?? "") {
  let value = 2166136261;
  for (let index = 0; index < hash.length; index += 1) {
    value ^= hash.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return `family-treasure-hunt-shared-${(value >>> 0).toString(36)}`;
}

export function buildShareUrl(customReferences, href = globalThis.location?.href) {
  if (!href) throw new Error("当前页面无法生成分享链接");
  const url = new URL(href);
  url.search = "";
  url.hash = `${SHARE_PREFIX.slice(1)}${encodeSharedHunt(customReferences)}`;
  if (url.href.length > MAX_LINK_LENGTH) throw new Error("图片生成的链接过长，请换一张构图更简单的照片");
  return url.href;
}

function base64UrlEncode(value) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
