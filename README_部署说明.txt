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

training.html 是已嵌入的“AI应用开发提示词术语训练平台”。
用户打开 index.html 后，点击页面右侧“培训”按钮，即可在全屏层打开培训小程序。

如果后续要替换培训小程序：
1. 把新的培训小程序 HTML 命名为 training.html；
2. 覆盖仓库里的 training.html；
3. 刷新 GitHub Pages 页面即可。

用户打开 GitHub Pages 链接后，如果浏览器支持 PWA 安装，会出现“安装 DeepSeek 增强助手”的提示。
如果用户已经通过桌面/主屏幕安装并以应用方式打开，则不会再提示。


程序已内置“帮助”按钮与首次使用说明弹窗。