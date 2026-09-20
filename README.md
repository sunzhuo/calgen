# 日程生成器 (CalGen)

一个基于原生 Web 技术构建的单网页日程生成应用，接入 Cloudflare Workers AI **`@cf/google/gemma-4-26b-a4b-it`** 大模型进行深度自然语言日程语义解析，同时支持本地规则快速回退、自动生成并下载标准 `.ics` (iCalendar) 日历文件、日程自动存储与过期清理，并已完整配置 PWA（支持安装至桌面/主屏幕及直接接收系统分享文本）。

提供打包好的APK安装程序，在手机上可以接收微信等APP分享的文字信息自动处理成日历日程格式保存到系统中。

---

## 🌟 功能特性

1. **Cloudflare Workers AI Gemma 4 大模型深度解析 (`functions/api/parse.js`)**：
   - 使用 Cloudflare 托管的高性能开源大模型 **`@cf/google/gemma-4-26b-a4b-it`**（256K 超长上下文）。
   - 将用户自然语言日程文本（中文/英文）精准结构化输出为标准 JSON（包含主题、ISO 8601 起止时间、全天标记、地点、会议链接等）。
   - 结合客户端本地时区与当前时间，自动计算如「下周三」、「后天下午」等相对日期。
   - **双引擎自适应回退**：在线部署时优先使用 Gemma 4 模型解析；离线或未绑定 AI 时无缝使用本地规则解析器，保障 100% 可用性与极速响应。
2. **标准 iCalendar 格式生成 (`ics.js`)**：
   - 兼容 RFC 5545 标准，支持 Apple Calendar（Mac/iPhone）、Google Calendar、Outlook 等所有主流日历客户端。
   - 自动包含事件 UID、开始时间、结束时间、主题、地点、原文本描述、会议链接，以及默认 15 分钟弹窗提醒。
3. **输入即自动解析与下载**：
   - 输入或粘贴日程文本时，提供实时解析预览卡片，显示引擎标识（`🤖 Gemma 4 26B` / `⚡ 本地解析`）。
   - 开启「自动下载 .ics」开关后，输入完成或粘贴时防抖自动触发 `.ics` 下载，并自动归档至下方列表。
   - 提供「生成并下载 .ics」手动按钮与快捷预设示例。
4. **所有日程管理与过期自动清理**：
   - 使用本地 `localStorage` 离线保存所有日程，数据不出浏览器，保障个人隐私。
   - 页面加载、切换回页面或定时自动检查日程，**自动删除已过时的日程**（结束时间早于当前时间）。
   - 提供「清理已过期」手动按钮，以及各日程的「复制」、「重新下载 .ics」、「删除」操作。
5. **完整 PWA 支持与接收系统分享文本**：
   - 注册 Service Worker (`sw.js`) 实现全资源离线缓存，无网络亦可秒级打开使用。
   - 配置 `manifest.webmanifest` 与 Web Share Target API：
     - 在 Android/桌面系统安装后，在其他应用（微信、浏览器、备忘录等）中选中日程文字点击「分享」，在应用列表选择「日程生成器」，即可自动接收并直接解析生成日程。
   - 提供桌面与移动端 PWA 安装提示横幅与按钮。

---

## 📁 项目结构

```text
d:\code\calgen/
├── index.html            # 单网页主页面
├── styles.css            # 现代化响应式自适应样式（支持暗色模式）
├── app.js                # 主应用控制器（事件绑定、实时预览、分享接收、PWA 安装）
├── parser.js             # 智能自然语言日程解析器（支持 Gemma 4 AI 与本地解析）
├── ics.js                # RFC 5545 iCalendar .ics 协议生成器
├── sw.js                 # PWA Service Worker 离线缓存
├── manifest.webmanifest  # PWA 清单文件（配置 share_target）
├── wrangler.toml         # Cloudflare Pages 配置文件（配置 Workers AI 绑定）
├── _headers              # Cloudflare Pages 响应头配置
├── functions/
│   └── api/
│       └── parse.js      # Cloudflare Pages Function: 运行 @cf/google/gemma-4-26b-a4b-it
└── icons/
    ├── favicon.svg       # SVG 矢量日历图标
    ├── icon-192.png      # 192x192 PWA 图标
    ├── icon-512.png      # 512x512 PWA 图标
    └── icon-maskable.png # 512x512 自适应蒙版图标
```

---

## 🚀 部署至 Cloudflare Pages

本项目为 Cloudflare Pages Full-stack（静态前端 + Pages Functions 后端），零构建依赖，可直接秒级部署：

### 方法一：Git 仓库自动部署（推荐）
1. 将当前项目推送至 GitHub / GitLab 仓库。
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
3. 选择你的仓库，配置项如下：
   - **Framework preset**（框架预设）: `None`
   - **Build command**（构建命令）: 留空（无需构建）
   - **Build output directory**（输出目录）: 留空或填写 `.`（根目录）
4. **绑定 Workers AI（关键步骤）**：
   - 进入部署好的 Pages 项目 -> **Settings** -> **Functions** -> **Workers AI bindings**。
   - 点击 **Add binding**：
     - Variable name（变量名）: `AI`
   - 保存即可！Pages Functions (`functions/api/parse.js`) 会自动通过 `env.AI` 免密调用 `@cf/google/gemma-4-26b-a4b-it`。

### 方法二：Wrangler 命令行部署
```bash
# 登录 Cloudflare
npx wrangler login

# 部署当前目录至 Cloudflare Pages（已预置 wrangler.toml）
npx wrangler pages deploy . --project-name=calgen
```

---

## 📱 PWA 与 Android 原生应用 (Capacitor)

1. **Android 原生应用 (Capacitor APK)**：
   - 采用 **Capacitor 8** 原生打包，内置 **`@capgo/capacitor-calendar`** 插件。
   - 在原生 Android App 内运行时，点击「生成并加入日历」或文本解析完成会自动调用底层原生系统日历接口（`CapacitorCalendar.createEventWithPrompt`），直接弹出系统日历创建弹窗（预填标题、起止时间、地点与备注），彻底解决 Web 无法直接唤起系统日历的问题。
   - **全格式分享与微信 ZIP 自动解压提取**：
     - 放宽系统分享过滤器至 `*/*`，支持接收任意文本和文件流（`ACTION_SEND`、`ACTION_SEND_MULTIPLE`、`ACTION_VIEW`）。
     - 支持微信/QQ等应用分享的 `.zip` 压缩包（或 "其他应用打开"），原生后台自动解压、智能过滤并提取其中的文本内容（支持 UTF-8 与 GBK 自动纠错），无缝送入日程解析引擎生成日历！
   - 安装包直接位于 `app/calgen.apk`，在应用内或网页端点击「下载 APK」即可获取。

2. **本地编译与打包命令**：
   ```bash
   # 安装依赖
   npm install

   # 构建前端并同步至 Capacitor
   npm run cap:build

   # 编译生成 Android Debug APK
   cd android && .\gradlew.bat assembleDebug
   ```

3. **PWA 安装**：
   - **Android Chrome / Edge**: 访问网页后，点击顶部的「安装应用」按钮，或点击浏览器菜单中的「添加到主屏幕」/「安装应用」。
   - **iOS Safari**: 访问网页后，点击底部的分享按钮（方框带向上箭头），选择「添加到主屏幕」。
   - 在 Web 浏览器中运行时，系统会自动平滑回退为下载标准 `.ics` 文件。

