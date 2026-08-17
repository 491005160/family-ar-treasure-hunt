# 家庭实景寻宝 MVP

面向手机竖屏的单页寻宝原型。首轮目标为黑橙礼帽摆件、黄色鸭子摆件、招财虎摆件和棕色皮包，并已接入四张家庭实拍参考图。正式玩法只截取中央识别框，使用浏览器本地 MobileNet 图像 embedding 与四组参考图比较；调试模式仍保留可预测的 mock matcher，用于验证进度和完成页。

开始页支持为四个槽分别选择 1～5 张自定义宝藏照片；照片只在当前页面和当前设备内使用，不会上传服务器，刷新页面后恢复内置示例图。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev -- --host 0.0.0.0
```

电脑打开 `http://localhost:3000`。摄像头 API 需要安全上下文：桌面 `localhost` 可用，但手机通过局域网 HTTP 地址访问时通常不会获得摄像头权限；家庭真机测试应使用 HTTPS 托管地址。

项目已配置为静态导出，并包含 GitHub Pages 自动发布工作流。推送到仓库的默认分支后，Actions 会构建 `dist/client/` 并部署到 HTTPS Pages 地址。

## 模块

- `app/core/camera.js`：摄像头权限、后置优先、切换和视频流清理
- `app/core/capture.js`：完整 Debug 截图、中央识别框裁剪与演示帧兜底
- `app/core/targets.js`：4 个目标、多参考图路径与线索
- `app/core/embedding.js`：自托管 MobileNet 模型加载、参考特征缓存与余弦相似度
- `app/core/matcher.js`：Top1 + Top2 margin 判定、候选排除、mock 和 HTTP 适配器
- `app/core/game.js`：进度、失败计数、本地恢复和完成状态
- `app/core/ui.js`：反馈文案、confidence 格式与连续失败降级规则

## 增加参考图

1. 把每个物品的 3–5 张家庭实拍图放到 `public/references/`。
2. 更新 `targets.js` 的 `referenceImages`。
3. 正式 matcher 会为每张参考图生成本地特征，每组取最高相似度，再同时检查 Top1 强度与 Top1/Top2 差距。

如后续需要替换 matcher，可继续使用统一返回结构：

```json
{ "matched": true, "targetId": "red-cup", "confidence": 0.93 }
```

页面和游戏状态不依赖具体模型或识别服务。执行 `npm.cmd run test:embedding` 可运行本地对照校准；额外的手机正负样本通过环境变量传入，不会进入公开仓库。
