# 代码审查报告 — pinkblog 博客

> 审查方式：OCR（`ocr delegate`）辅助文件筛选/规则分组 + host agent 逐行人工审查。
> 审查范围：**全部自研代码**，非仅最近提交。
> 状态：仅报告，未改动任何代码。

## 审查范围与覆盖

| 类别 | 文件 | 状态 |
|---|---|---|
| 构建脚本 | `scripts/avif.js` | ✅ 已审 |
| 主题 JS | `themes/pinkblog/source/js/{toc,sakura,trail,live2d}.js` | ✅ 已审 |
| 布局 | `themes/pinkblog/layout/{layout,index,post,page,archive,category,tag,links,projects}.ejs` + `_partial/{nav,footer,post-card,sidebar}.ejs` | ✅ 已审 |
| 样式 | `themes/pinkblog/source/css/{tokens,base,components}.css` | ✅ 已审 |
| 配置 | `_config.yml`、`themes/pinkblog/_config.yml`、`package.json`、`wrangler.jsonc`、`source/_headers` | ✅ 已审 |
| 第三方/生成 | `live2d.min.js`、`waifu-tips.js`、`waline.js/css`、emoji 资源、`pnpm-lock.yaml` | ⏭ 视为 vendored，仅做集成面审查 |

---

## 🔴 高

### H1｜最近评论 `href` 未转义 / 未做协议白名单（XSS 风险）
- **path**: `themes/pinkblog/source/js/toc.js`
- **start_line**: 68 **end_line**: 77
- **content**: `esc()` 只处理 `&`/`<`，不处理 `"` `'`；`var link = c.url || '/'`（71 行）被直接拼进 `href="' + link + '"`（77 行）。若 `url` 含引号可闭合属性注入事件，若为 `javascript:` 则点击即执行。虽 Waline 的 `url` 多为文章页地址，仍属纵深防御缺口。
- **category**: security / XSS
- **severity**: high
- **建议**: 对 `link` 做 `encodeURI` + 引号转义，并加协议白名单（仅允许 `http(s):` 或站内相对路径）。

### H2｜最近评论接口参数错误：`pageSize` 应为 `count`
- **path**: `themes/pinkblog/source/js/toc.js`
- **start_line**: 59 **end_line**: 59
- **content**: 请求 `…/api/comment?type=recent&pageSize=3&lang=zh-CN`。但主题内 `waline.js` 的 recent 接口读取的是 `count`（模板实测：`type=recent&count=${n}`），`pageSize` 被服务端忽略 → 返回条数不受控（走默认值），"最近 3 条" 实际不成立。
- **category**: correctness / bug
- **severity**: high
- **建议**: 改为 `&count=3`。

---

## 🟠 中

### M1｜移动端封面高度覆盖失效（媒体查询顺序错误）
- **path**: `themes/pinkblog/source/css/components.css`
- **start_line**: 208 **end_line**: 217
- **content**: `@media(max-width:768px){ .post-card-cover .cover-img{ max-height:500px } }`（208–210）写在基础规则 `.post-card-cover .cover-img{ … max-height:450px }`（211–217）**之前**。两者特异性相同，后出现的基础规则胜出 → 移动端实际仍是 450px，500px 的意图完全失效。
- **category**: correctness / CSS cascade
- **severity**: medium
- **建议**: 将该媒体查询移到基础规则之后，或提升其特异性。

### M2｜封面卡注入整篇正文，列表页 DOM 与 HTML 体积膨胀；正则删 id 破坏锚点
- **path**: `themes/pinkblog/layout/_partial/post-card.ejs`
- **start_line**: 11 **end_line**: 11
- **content**: `<%- post.content.replace(/\s+id="[^"]*"/g,'') %>` 把**整篇文章**的渲染结果塞进每张卡的透视区。首页（每页 6 篇）会重复输出完整正文 HTML（含图片、代码块），显著增大体积与解析成本；且正则无差别删除所有 `id`，会破坏文内锚点/TOC 跳转。该行缩进也异常。
- **category**: performance / maintainability
- **severity**: medium
- **建议**: 透视区改为纯文本节选或截断后的安全 HTML；若必须保留 HTML，应给 id 加唯一前缀而非删除。

### M3｜`toSourceFile` 每张图片都遍历全部 Post（近似 O(图片数 × 文章数)）
- **path**: `scripts/avif.js`
- **start_line**: 76 **end_line**: 99
- **content**: `after_render` 对每个 `<img>` 调用 `toSourceFile`，其中 `hexo.model('Post').find({}).forEach(...)` 全量扫描文章模型。图片一多，构建耗时线性放大。
- **category**: performance
- **severity**: medium
- **建议**: 构建期一次性建立 `目录 → Post` 映射缓存（如以 `dirname` 为 key），后续 O(1) 查询。

### M4｜SPA 导航 `fetch` 无 `res.ok` 判断与错误兜底
- **path**: `themes/pinkblog/layout/layout.ejs`
- **start_line**: 111 **end_line**: 121
- **content**: `swap()` 直接 `fetch(url).then(res=>res.text())`，不检查 `res.ok`，也没有 `.catch()`。断网、404、非 HTML 响应时产生 unhandled rejection，页面停在上页且无任何提示。
- **category**: robustness
- **severity**: medium
- **建议**: 校验 `res.ok`，失败时 `location.href = url` 兜底。

### M5｜`live2d.js` 全局改写 `window.Image`
- **path**: `themes/pinkblog/source/js/live2d.js`
- **start_line**: 27 **end_line**: 33
- **content**: 用包装函数替换 `window.Image`，为**所有**新建图片强设 `crossOrigin = 'anonymous'` 且无还原路径。这是全局副作用：页面其他跨域图片若被绘制到 canvas，会因缺少 CORS 头而加载/绘制失败。
- **category**: maintainability / correctness risk
- **severity**: medium
- **建议**: 仅对 live2d 自身资源设置 crossOrigin，避免替换全局构造函数。

---

## 🟡 低

### L1｜`apple-touch-icon` 重复声明
- **path**: `themes/pinkblog/layout/layout.ejs`
- **start_line**: 22 **end_line**: 38
- **content**: 第 22 行与第 38 行重复输出同一 `<link rel="apple-touch-icon">`。
- **category**: dead / redundant
- **severity**: low
- **建议**: 删除其一。

### L2｜`og:url` 手工拼接可能产生双斜杠或 `index.html`
- **path**: `themes/pinkblog/layout/layout.ejs`
- **start_line**: 36 **end_line**: 36
- **content**: `<%= config.url %>/<%= page.path %>`；首页 `page.path` 常为 `index.html`，或被拼接项带前导 `/` 时出现 `//`。
- **category**: correctness / SEO
- **severity**: low
- **建议**: 改用 `full_url_for(page.path)`。

### L3｜`theme.comment.waline` 空值防护不一致
- **path**: `themes/pinkblog/layout/layout.ejs`
- **start_line**: 41 **end_line**: 44
- **content**: 41–42 行用三元守卫 `theme.comment.waline ? …`，但第 44 行 `JSON.stringify(theme.comment.waline.emoji || false)` 直接取属性；未配置 waline 时会抛错中断渲染。
- **category**: robustness
- **severity**: low
- **建议**: 统一为 `theme.comment.waline ? theme.comment.waline.emoji : false`。

### L4｜`_headers` 残留已废弃的 giscus CORS 规则
- **path**: `source/_headers`
- **start_line**: 3 **end_line**: 8
- **content**: 仍为 `/css/giscus-light.css`、`/css/giscus-dark.css` 放行 CORS，但 giscus 已被 Waline 取代，这两个文件并不存在 → 死配置。
- **category**: dead config
- **severity**: low
- **建议**: 删除这两条规则。

### L5｜`vtName` 哈希函数重复定义
- **path**: `themes/pinkblog/layout/layout.ejs`(95–99) 与 `themes/pinkblog/layout/post.ejs`(2)
- **content**: 同一哈希函数在两处各写一份，必须严格同步，否则 View Transitions 配对失效。当前实现一致，属维护隐患。
- **category**: maintainability
- **severity**: low
- **建议**: 抽到公共 JS 或由 `layout.ejs` 注入成全局函数。

### L6｜`var` 广泛使用（约 65 处）
- **path**: `toc.js`(36) / `trail.js`(13) / `sakura.js`(12) / `live2d.js`(4)
- **category**: style（OCR JS 规则组对 `var` 有告警）
- **severity**: low
- **建议**: 可选统一为 `const/let`；如刻意保持 ES5 兼容可在注释中说明。

### L7｜疑似未使用的依赖
- **path**: `package.json`
- **content**: `@waline/client`、`@waline/emojis` 运行时由主题内自托管的 `themes/pinkblog/source/waline/*` 提供，构建脚本未 import；`lucide-static`（devDep）仅作为内联 SVG 的来源注释，未被代码引用。
- **category**: dependencies（OCR 依赖规则）
- **severity**: low
- **建议**: 核实后精简；若用于生成自托管产物，建议在 scripts 中显式声明用途。

### L8｜评论文本 `slice(0, 42)` 可能截断代理对
- **path**: `themes/pinkblog/source/js/toc.js`
- **start_line**: 70 **end_line**: 70
- **content**: 按 UTF-16 code unit 截断，遇到 emoji 可能切出半个代理对，显示为乱码。
- **category**: correctness（边缘）
- **severity**: low
- **建议**: 用 `Array.from(...).slice(0,42).join('')` 或 `Intl.Segmenter`。

---

## ✅ 值得肯定的点
- `layout.ejs` 外部链接普遍带 `rel="noopener"`、`target="_blank"` 规范。
- `sakura.js` / `trail.js` 尊重 `prefers-reduced-motion`，并在页面隐藏时暂停动画。
- `avif.js` 有 mtime+size 缓存跳过未变更文件，转换失败降级为 warning 不中断构建。
- `wrangler.jsonc` 的 `not_found_handling: "404-page"` 与静态资源目录配置正确。

---

## 修复优先级建议
1. **H2 + H1**（功能错误 + XSS）：一行参数修复 + href 转义，成本低、收益高。
2. **M1**（CSS 顺序）：调换位置即可恢复移动端 500px 意图。
3. **M4 + M3**：SPA 兜底与构建性能，影响体验/构建时长。
4. **M2**：列表页体积优化，收益随文章数增长。
5. 其余低优先级可批量清理。
