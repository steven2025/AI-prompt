# DeepSeek 增强助手 PWA 部署说明

把本文件夹里的全部文件上传到 GitHub 仓库根目录，然后开启 GitHub Pages。

必须上传：
- index.html
- training.html
- manifest.json
- service-worker.js
- icon-192.png
- icon-512.png
- icon-180.png
- favicon.png
- demand 文件夹（需要完整上传，不能只上传其中的 index.html）
- knowledge 文件夹（需要完整上传）
- events 文件夹（需要完整上传）

training.html 是已嵌入的“AI应用开发培训平台”。
用户打开 index.html 后，可以从顶部导航进入培训、知识库、活动、需求、协作和作品模块。

需求对接模块部署：
1. 部署 cloud-function-demand.zip，配置包内 README_DEPLOY.md 列出的环境变量；
2. 复制新云函数的 HTTP 触发器 URL；
3. 填入 demand/config.js 中的 apiUrl；
4. 将 demand 文件夹和主程序文件一起上传 GitHub。

需求模块继续使用现有 COS 桶，数据和附件保存到 ai-demand 目录，不需要新建桶。

知识库模块部署：
1. 部署 cloud-function-knowledge.zip；
2. 按 cloud-function-knowledge/env.txt 配置环境变量；
3. 复制 HTTP 触发器 URL，填入 knowledge/config.js；
4. 上传 knowledge 文件夹、service-worker.js 和更新后的 index.html。

知识库可以继续使用现有 COS 桶，数据和附件保存在 ai-knowledge 目录，不需要新建桶。
未配置知识库云函数时仍可阅读平台内置指南，但不能提交、审核或下载成员附件。

活动与交流模块部署：
1. 部署 cloud-function-events.zip；
2. 按 cloud-function-events/env.txt 配置环境变量；
3. 复制 HTTP 触发器 URL，填入 events/config.js；
4. 上传 events 文件夹、service-worker.js 和更新后的 index.html。

活动模块继续使用现有 COS 桶，照片、封面及数据保存在 ai-events 目录。
视频不上传到活动云函数，成员优先提交任意对象存储平台的HTTPS视频文件直链。

如果后续要替换培训小程序：
1. 把新的培训小程序 HTML 命名为 training.html；
2. 覆盖仓库里的 training.html；
3. 刷新 GitHub Pages 页面即可。

用户打开 GitHub Pages 链接后，如果浏览器支持 PWA 安装，会出现“安装 DeepSeek 增强助手”的提示。
如果用户已经通过桌面/主屏幕安装并以应用方式打开，则不会再提示。


程序已内置“帮助”按钮与首次使用说明弹窗。
