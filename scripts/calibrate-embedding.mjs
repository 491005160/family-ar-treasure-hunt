import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tf from "@tensorflow/tfjs";
import * as mobilenet from "@tensorflow-models/mobilenet";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelDirectory = path.join(root, "public", "models", "mobilenet-v2-050");
const modelJson = JSON.parse(await readFile(path.join(modelDirectory, "model.json"), "utf8"));
const shardBuffers = await Promise.all(
  modelJson.weightsManifest[0].paths.map((name) => readFile(path.join(modelDirectory, name))),
);
const combinedWeights = Buffer.concat(shardBuffers);
const modelHandler = tf.io.fromMemory({
  modelTopology: modelJson.modelTopology,
  weightSpecs: modelJson.weightsManifest[0].weights,
  weightData: combinedWeights.buffer.slice(
    combinedWeights.byteOffset,
    combinedWeights.byteOffset + combinedWeights.byteLength,
  ),
});
const model = await mobilenet.load({
  version: 2,
  alpha: 0.5,
  modelUrl: modelHandler,
  inputRange: [0, 1],
});

const references = [
  ["black-orange-figure", "public/references/01-black-orange-figure.jpg"],
  ["yellow-duck", "public/references/02-yellow-duck.jpg"],
  ["lucky-tiger", "public/references/03-lucky-tiger.jpg"],
  ["brown-satchel", "public/references/04-brown-satchel.jpg"],
];

const referenceEmbeddings = new Map();
for (const [id, relativePath] of references) {
  referenceEmbeddings.set(id, await embed(await readFile(path.join(root, relativePath))));
}

const cases = [];
for (const [id, relativePath] of references) {
  const source = await readFile(path.join(root, relativePath));
  cases.push([id, "same", source]);
  cases.push([id, "near", await sharp(source).resize(280, 360, { fit: "cover" }).extract({ left: 28, top: 68, width: 224, height: 224 }).jpeg().toBuffer()]);
  cases.push([id, "angle", await sharp(source).rotate(12, { background: "#b9b5aa" }).jpeg().toBuffer()]);
  cases.push([id, "far-background", await makeFarView(source, id)]);
}

// 可选的本机实拍样本通过环境变量传入，避免把家庭场景或个人路径提交到公开仓库。
const phoneScreenshot = process.env.PHONE_POSITIVE_SCREENSHOT;
try {
  if (!phoneScreenshot) throw new Error("未配置手机正样本");
  const phoneCrop = await sharp(phoneScreenshot).extract({ left: 218, top: 1035, width: 842, height: 842 }).jpeg().toBuffer();
  cases.push(["black-orange-figure", "real-phone-frame", phoneCrop]);
} catch {
  // 手机截图只用于本机校准，不作为项目运行依赖。
}

for (const [variant, screenshot] of [
  ["wrong-tv", process.env.WRONG_TV_SCREENSHOT],
  ["wrong-empty-frame", process.env.WRONG_EMPTY_SCREENSHOT],
]) {
  try {
    if (!screenshot) throw new Error("未配置负样本");
    const crop = await sharp(screenshot).extract({ left: 218, top: 1035, width: 842, height: 842 }).jpeg().toBuffer();
    cases.push([null, variant, crop]);
  } catch {
    // 负样本截图不存在时跳过，不影响产品运行。
  }
}

const rows = [];
for (const [expected, variant, image] of cases) {
  const embedding = await embed(image);
  const scores = references
    .map(([id]) => ({ targetId: id, similarity: cosine(embedding, referenceEmbeddings.get(id)) }))
    .sort((first, second) => second.similarity - first.similarity);
  rows.push({
    expected,
    variant,
    top1: scores[0].targetId,
    top1Similarity: round(scores[0].similarity),
    top2: scores[1].targetId,
    top2Similarity: round(scores[1].similarity),
    margin: round(scores[0].similarity - scores[1].similarity),
    scores: Object.fromEntries(scores.map(({ targetId, similarity }) => [targetId, round(similarity)])),
  });
}

console.log(JSON.stringify(rows, null, 2));

async function embed(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(224, 224, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, info.channels], "int32");
  const output = model.infer(tensor, true);
  const values = Array.from(await output.data());
  tensor.dispose();
  output.dispose();
  return normalize(values);
}

async function makeFarView(source, id) {
  const colors = {
    "black-orange-figure": "#d7e5e4",
    "yellow-duck": "#35465b",
    "lucky-tiger": "#e6d6c1",
    "brown-satchel": "#c9d4bd",
  };
  const foreground = await sharp(source).resize(140, 186, { fit: "cover" }).jpeg().toBuffer();
  return sharp({ create: { width: 224, height: 224, channels: 3, background: colors[id] } })
    .composite([{ input: foreground, left: 42, top: 19 }])
    .jpeg()
    .toBuffer();
}

function normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function cosine(first, second) {
  return first.reduce((sum, value, index) => sum + value * second[index], 0);
}

function round(value) {
  return Number(value.toFixed(4));
}
