/**
 * 四个预设目标。真实识别接入后，把家庭实拍参考图放到 public/references，
 * 并在 referenceImages 中继续追加路径即可。
 */
export const TARGETS = Object.freeze([
  {
    id: "black-orange-figure",
    name: "黑橙礼帽摆件",
    shortName: "礼帽摆件",
    clue: "戴着高高的礼帽，黑色外套上藏着橙色图案",
    icon: "🎃",
    color: "#ff6b4a",
    referenceImages: ["./references/01-black-orange-figure.jpg"],
  },
  {
    id: "yellow-duck",
    name: "黄色鸭子摆件",
    shortName: "黄色鸭子",
    clue: "圆圆的黄色脑袋，两只大眼睛正在四处张望",
    icon: "🐥",
    color: "#ffc83d",
    referenceImages: ["./references/02-yellow-duck.jpg"],
  },
  {
    id: "lucky-tiger",
    name: "招财虎摆件",
    shortName: "招财虎",
    clue: "笑眯眯的小老虎，举着写有好运的牌子",
    icon: "🐯",
    color: "#58b883",
    referenceImages: ["./references/03-lucky-tiger.jpg"],
  },
  {
    id: "brown-satchel",
    name: "棕色皮包",
    shortName: "棕色皮包",
    clue: "方方正正的棕色包，前面有两枚金色搭扣",
    icon: "💼",
    color: "#6f91e8",
    referenceImages: ["./references/04-brown-satchel.jpg"],
  },
]);

export function getTarget(targetId) {
  return TARGETS.find((target) => target.id === targetId) ?? null;
}
