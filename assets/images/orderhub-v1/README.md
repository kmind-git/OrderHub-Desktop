# OrderHub 前端图片资源 v1

本组资源使用 **imagegen 技能的内置 image_gen 模式**生成，日期 2026-10-19。4 张最终图片已保存到项目目录，可供后续 React/Tauri 开发使用。风格为石墨金属、雾面玻璃与低饱和青色细节；这是一组装饰素材，不是完整界面设计，也不代表任何真实业务状态。

[打开本地素材预览](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/preview.html>) · [资源清单](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/asset-manifest.json>) · [完整生成及修订提示词](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/generation-record.json>)

| 文件 | 实际尺寸 | 格式 | 建议使用场景 | 建议显示宽度 |
| --- | --- | --- | --- | --- |
| [connection-hero.png](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/connection-hero.png>) | 1536 × 1024 | 不透明 PNG | 连接设置、初次配置、关于页辅助视觉 | 420–720px |
| [update-package.png](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/update-package.png>) | 1254 × 1254 | 透明 PNG | 发现新版本、等待下载或安装的辅助说明 | 200–280px |
| [query-placeholder.png](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/query-placeholder.png>) | 1254 × 1254 | 透明 PNG | 后台暂未提供查询接口、模块尚未接入 | 180–240px |
| [connection-recovery-v2.png](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/connection-recovery-v2.png>) | 1254 × 1254 | 透明 PNG | 连接中断、重连或状态重新同步 | 280–360px |

## 使用约定

- **连接页主视觉**：只在配置页或关于页的独立装饰面板中使用，保留完整画面时用 `object-fit: contain`；如作背景允许受控裁切。不要铺在订单表格或输入框后面。
- **更新包插画**：表示更新功能或待处理软件包；实际下载进度、签名结果和安装状态由文字/组件表达，不能靠图片暗示更新成功。
- **查询预留页插画**：配合“后台暂未提供该查询接口”等真实说明。不要把未接入状态展示成“没有订单”或“查询成功”。
- **连接恢复插画**：使用 `connection-recovery-v2.png`，显示在连接中断、重连或重新同步的辅助区域。图片区不覆盖错误原因、重试按钮或服务端状态。
- 三张透明图使用 `object-fit: contain`，保持比例，不设置 `mix-blend-mode`、反色或整体透明度，不添加与图片边缘冲突的重阴影。小于建议尺寸时优先减弱或省略装饰图。
- 图片均无文字；标题、状态、按钮、错误说明由 React 实现，支持中文、键盘与读屏。装饰性 `img` 使用 `alt=""`，不能承担唯一状态信息。
- 图中青色属于材质装饰，不是“服务可用”“订单成功”等状态色。买卖、警告和故障颜色由真实业务组件独立定义。
- PNG 原图保留；构建时可另产 WebP 等派生资源，保持透明通道并重新检查边缘。按页面加载，设置 width/height 或 aspect-ratio，避免布局跳动。
- 所有资源随安装包本地交付，不依赖远程图片 URL；config 中的地址、Token 和证书不得进入图片或预览页面。
- `drafts/connection-recovery-v1.png` 是未选用的初稿，仅留作追溯，不进入应用资源清单。

## React 使用方式

后续工程创建后，将所需的最终 PNG 复制到应用静态资源目录，保持文件名；资源映射以 manifest 为准。本文不是已实现的 React 代码。

```tsx
<img
  src="/assets/orderhub/query-placeholder.png"
  alt=""
  width={220}
  height={220}
  style={{ objectFit: 'contain' }}
/>
<p>后台暂未提供该查询接口</p>
```

## 预览

### 连接页主视觉

![连接页主视觉](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/connection-hero.png>)

### 更新包插画

![更新包插画](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/update-package.png>)

### 查询预留页插画

![查询预留页插画](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/query-placeholder.png>)

### 连接恢复插画

![连接恢复插画](<D:/projects/codexworkspace/OrderHub/OrderHub desktop/assets/images/orderhub-v1/connection-recovery-v2.png>)

## 验证边界

已目检四张最终图的内容，并检查实际像素尺寸和透明通道；最终文件尺寸及 SHA-256 记录在 manifest。preview.html 已准备浅色/深色背景和显示尺寸对照，但 Chrome 当前不可用，内置浏览器的 URL 安全策略拒绝本地 file 协议，因此尚未完成浏览器渲染验证，没有尝试绕过该限制。后续开发在本地打开预览页时检查透明边缘、实际缩放和对比度。最终应用尚未实现。完整生成提示词和单次定向修订提示词均保存于 generation-record.json。
