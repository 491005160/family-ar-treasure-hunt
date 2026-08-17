# 家庭实景寻宝 MVP

面向手机竖屏的单页寻宝原型。首轮目标为黑橙礼帽摆件、黄色鸭子摆件、招财虎摆件和棕色皮包，并已接入四张家庭实拍参考图。当前使用可预测的 mock matcher：第一次拍摄失败、第二次拍摄找到下一个未完成目标，用于完整验证失败提示、进度点亮和 4/4 完成页。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev -- --host 0.0.0.0
```

电脑打开 `http://localhost:3000`。摄像头 API 需要安全上下文：桌面 `localhost` 可用，但手机通过局域网 HTTP 地址访问时通常不会获得摄像头权限；家庭真机测试应使用 HTTPS 托管地址。

项目已配置为静态导出，并包含 GitHub Pages 自动发布工作流。推送到仓库的默认分支后，Actions 会构建 `dist/client/` 并部署到 HTTPS Pages 地址。

## 模块

- `app/core/camera.js`：摄像头权限、后置优先、切换和视频流清理
- `app/core/capture.js`：当前视频帧截图与演示帧兜底
- `app/core/targets.js`：4 个目标、多参考图路径与线索
- `app/core/matcher.js`：统一 matcher 协议、mock 实现和 HTTP 真实识别适配器
- `app/core/game.js`：进度、失败计数、本地恢复和完成状态
- `app/core/ui.js`：反馈文案、confidence 格式与连续失败降级规则

## 接入真实识别

1. 把每个物品的 2–5 张家庭实拍图放到 `public/references/`。
2. 更新 `targets.js` 的 `referenceImages`。
3. 用 `createHttpMatcher({ endpoint })` 替换页面中的 `createMockMatcher()`。后端只需返回：

```json
{ "matched": true, "targetId": "red-cup", "confidence": 0.93 }
```

页面和游戏状态不依赖具体识别服务。
