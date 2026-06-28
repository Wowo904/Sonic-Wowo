# Sonic Topography

Sonic Topography 是一个本地音乐可视化播放器。它使用 React、Three.js、Vite、Web Audio、Express 和 Electron 构建，可以播放本地音乐、显示 `.lrc` 歌词，并用音频频谱驱动 3D 地形、波纹和流星效果。

界面已改为中文，并带有 `ALEX-W.` 品牌标识和 macOS App 图标。

作者 / 维护者：ALEX-W.

## 功能

- 3D 音频响应式地形可视化
- 内置 Demo 音频和同步 LRC 歌词
- 支持上传本地音频和 `.lrc` 歌词
- 网易云音乐搜索
- 网易云每日推荐歌曲
- 搜索结果会显示全部歌曲，不可播放歌曲会标灰并显示“不可播放”
- 本地歌单保存
- 支持上一首、下一首
- 支持顺序播放和随机播放
- 支持全屏模式
- 支持打包为 macOS `.app`

## 直接打开

如果你已经有打包好的 macOS App，直接双击：

```text
Sonic Topography.app
```

如果 macOS 提示“无法验证开发者”或“不允许打开”，可以：

1. 右键点击 `Sonic Topography.app`
2. 选择“打开”
3. 在弹窗里再次选择“打开”

这是因为当前 App 是本地自用未公证版本。

## 本地源码运行

前提：电脑需要安装 Node.js。

安装依赖：

```bash
npm install
```

构建前端：

```bash
npm run build
```

启动本地服务：

```bash
npm start
```

然后打开：

```text
http://127.0.0.1:4173
```

## 开发模式

开发前端界面：

```bash
npm run dev
```

开发服务器默认地址：

```text
http://127.0.0.1:3000
```

如果要同时测试网易云代理、歌单保存等本地服务功能，请使用：

```bash
npm run build
npm start
```

## 打包为 macOS App

生成 macOS `.app`：

```bash
npm run dist:mac
```

打包结果会出现在：

```text
release/mac-arm64/Sonic Topography.app
```

生成 DMG 安装包：

```bash
npm run dist:dmg
```

说明：当前配置默认跳过 macOS 代码签名，适合本机自用。如果要公开分发，需要 Apple Developer 证书、签名和公证流程。

## GitHub 自动打包

仓库包含 GitHub Actions 工作流。推送到 GitHub 后，可以在 Actions 页面手动运行 `Build macOS App`，它会：

1. 安装依赖
2. 运行类型检查
3. 构建前端
4. 打包 macOS App
5. 上传 `Sonic Topography-mac-arm64.zip` 作为可下载 artifact

建议把软件包放在 GitHub Release 附件里，不建议直接提交 `.app` 到 git 仓库，因为 Electron App 体积较大。

## Demo 文件

内置 Demo 文件位于：

```text
public/demo.mp3
public/demo.lrc
```

如果要替换 Demo，请保持文件名不变。

## 网易云搜索说明

网易云搜索使用非官方网页接口，只适合作为辅助功能。

搜索接口能返回歌曲信息，但播放接口不一定能拿到真实音频地址。常见原因包括：

- 版权限制
- 会员歌曲
- 地区限制
- 匿名接口不可播放
- 网易云接口风控

因此，应用会显示全部搜索结果，但不可播放的歌曲会标灰，并显示“不可播放”。本地上传音乐是最稳定的播放方式。

### 使用网易云登录 Cookie

如果你有网易云会员，可以在本机配置 Cookie，提高部分歌曲的可播放概率，并启用“每日推荐”。Cookie 只应该保存在自己的电脑上，不要上传 GitHub，不要发给别人。

源码运行时，在项目根目录新建 `.env.local`：

```bash
NETEASE_COOKIE="MUSIC_U=...; __csrf=...; NMTID=..."
```

macOS App 运行时，配置文件位置是：

```text
~/Library/Application Support/sonic-topography/.env.local
```

文件内容同样是：

```bash
NETEASE_COOKIE="MUSIC_U=...; __csrf=...; NMTID=..."
```

配置后需要完全退出并重新打开 App。即使配置 Cookie，也仍然可能因为版权、地区或接口限制导致部分歌曲不可播放。

## 常用命令

```bash
npm run lint
npm run build
npm start
npm run electron
npm run dist:mac
```

## 项目结构

```text
src/                  前端界面和 3D 可视化
src/lib/AudioEngine.ts 音频播放、频谱分析和触发器
local-server.mjs       本地 Express 服务和网易云代理
electron/main.cjs      Electron 主进程
assets/icon/           App 图标资源
public/                Demo 音频和歌词
```
