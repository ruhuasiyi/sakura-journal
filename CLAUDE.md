# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Hexo 静态博客「夜樱手帐」，自研主题 `themes/pinkblog`（EJS + 原生 CSS/JS，无打包器）。Node 包管理用 pnpm（`pnpm@11.26.0`），站点部署到 Cloudflare（`wrangler.jsonc` 指向 `public/`）。

## 常用命令

```bash
pnpm dev        # hexo server，http://localhost:4000
pnpm build      # hexo generate，输出到 public/
pnpm clean      # hexo clean

npx hexo new post "标题"    # 新建文章（post_asset_folder 开启，会生成同名资源目录）
```

没有测试与 lint 配置。**本地迭代只改文件，不要随手跑 build**（用户按 API 用量计费，构建留给推送/上线前）。

## 架构要点

### 内容与主题分离

- `source/` 是内容：`_posts/`、`about/`、`links/`、`projects/`、`board/`。页面通过 front matter 选布局，例如 `layout: links` / `layout: projects`；`board/index.md` 与文章页使用 `waline: true` 启用评论区。
- `themes/pinkblog/` 是全部视觉与交互。可调项集中在 `_config.yml`（站点）和 `themes/pinkblog/_config.yml`（菜单、特效开关、Waline、Umami、友链、项目、封面池等）。
- 样式由 `css/tokens.css`（亮/暗两套 CSS 变量）→ `base.css`（基础布局、跨文档 View Transitions）→ `components.css`（卡片、文章列表等）组成，暗色主题通过 `<html data-theme="dark">` 整体换变量，不要为组件写两套配色。

### 构建期图片处理（`scripts/avif.js`）

Hexo 脚本，注册在 `before_generate` filter 上（`hexo generate` 和 `hexo server` 的首次/热重建都会走到）。注意不要写成 `generateBefore`——那是 EventEmitter 事件名，注册成 filter 不会执行；也不要直接在模块顶层调用 `convertAll()`，它是异步的且不会被等待，页面会先渲染完，封面池还是空的。

1. 扫描 `source/` 下 jpg/jpeg/png/webp，用 sharp 生成同名 `.avif`（最长边 800、q65），缓存记录在 `.avif-cache.json` 以跳过未变文件。
2. 把所有已生成的封面池挂到 `hexo.config.pb_covers`，模板在 `<head>` 里输出为 `window.PB_COVERS`。
3. `after_render:html` 过滤器把 `<img>` 改写为 `<picture>`（AVIF 优先、原图兜底）。URL 反查源文件的逻辑依赖「目录 → 文章源文件」映射（`buildPostDirMap`），因为 `Post.path` 是虚拟字段。

注意：dev server 运行中新增的图片需要重启 `pnpm dev` 才会转换。

### 前端 SPA 路由 + View Transitions（关键耦合）

`layout.ejs` 内联了一段站内路由：点击站内链接时 `fetch` 目标页、替换 `main.container`，失败则整页跳转；配合 `document.startViewTransition` 实现卡片 morph 到文章页。由此产生三处必须同步的约定：

- `window.pbInitPage()`（定义在 `js/toc.js`，页面底部先执行一次）负责换页后重初始化：代码块语言标签、Waline 实例（先 destroy 再重建）、最近评论、封面分配、TOC、横向滚动归零。新增依赖 DOM 的初始化逻辑都应加在这里，而不是写成一次性 DOMContentLoaded。
- `window.pbVtName(path)`（`toc.js`）与 `post.ejs` 里内联的 `vtName()` 是同一套 DJB2 哈希，服务端静态名与客户端点击时挂的 `viewTransitionName` 必须一致，否则 morph 失效。**不要在别处再写第三份。**
- 卡片点击时只给当前被点卡片临时挂过渡名，避免多个命名组互相冲突；换页后 `main.container` 之外的 DOM（导航、页脚）不会更新。
- 路由实现在 `js/router.js`：内存缓存（16 条 / 10 分钟 TTL）+ `fetch()` 预取（`<link rel=prefetch>` 在这里无效，线上目录索引 HTML 没有 ETag）。**关键时序**：缓存命中才立即 `startViewTransition`；未命中先 fetch 并显示顶部进度条（`html[data-pb-busy]`），取到后再启动过渡——不要把网络请求放进过渡的 update callback，否则整段 RTT 会冻结画面。`layout.ejs` 里的 `window.PB_BOOT` 必须在 `js('js/toc')` 之前采集（此时 DOM 还是服务端原始 HTML），缓存重放才不会重复包裹代码块/封面。
- `pushState` 只在 DOM 替换成功后调用一次（Umami 依赖 history 钩子上报 pageview）。`toc.js` 的 `pbPageToken` 用于丢弃换页后过期的 `import()` 结果。

### 无封面文章的封面分配

`post-card.ejs` 只为 front matter 里写了 `cover:` 的文章渲染封面。没写的文章由 `pbInitPage` 用文章路径哈希从 `window.PB_COVERS` 确定性抽选（同文恒定、同页尽量不重复），并回填 `.post-card-cover`。

### 第三方资源

- Waline 评论与 live2d 看板娘**全部本地自托管**在 `themes/pinkblog/source/waline/`、`source/live2d/`，不走 CDN（考虑部分网络对 jsDelivr 的连通性）。Waline 的 JS 模块路径在 `layout.ejs` 里以 `module: '/waline/waline.js'` 注入 `window.PB_WALINE`。
- 字体走 jsDelivr CDN（LXGW WenKai Screen、JetBrains Mono）。
- `live2d.js` 刻意不改写全局 `window.Image`（上游 autoload 的做法会破坏 Waline 跨域头像加载）。
- 特效脚本（`sakura.js`/`trail.js`/`live2d.js`）都先检查 `prefers-reduced-motion`，移动端减少或跳过。

### 评论相关约定

- 文章页/留言板的 Waline 由 `pbInitPage` 动态 `import` 并初始化；编辑框占位文案会被后处理补上「昵称/邮箱必填、邮箱仅用于头像」的说明。
- 侧栏「最近评论」直接请求 Waline `/api/comment?type=recent&count=3`，返回值会被 HTML 转义、链接做协议白名单（仅 http(s) 与站内相对路径），文本按代码点截断避免切坏 emoji。

## 部署与仓库约定

- `wrangler.jsonc`：Cloudflare Workers 静态资源配置，`assets.directory = ./public`，`not_found_handling = 404-page`。
- `source/_headers` 是部署时生效的自定义响应头配置；Hexo 默认忽略 `_` 开头文件，需靠 `_config.yml` 的 `include: [_headers]` 才会输出。
- 不入库（见 `.gitignore`）：`public/`、`db.json`、`.avif-cache.json`、`.agents/`、`.claude/`、`.superpowers/`、`skills-lock.json`、`docs/code-review-report.md`。
- `docs/superpowers/` 下是设计与计划文档（如 `2026-09-29-hexo-blog-design.md`），记录了技术选型与视觉规范。

## 修改时注意

- 硬回退/`git reset --hard` 前先确认工作区 dirty 项，避免吞掉未提交的内容编辑。
- 模板与脚本中的注释均为中文，新增注释保持一致。
- 卡片封面与正文透视区（`.post-card-peek`）的布局依赖 `components.css` 中媒体查询的顺序，调整 CSS 时注意层叠顺序（历史上多次因顺序导致移动端规则失效）。
