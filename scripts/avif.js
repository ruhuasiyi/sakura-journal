/* global hexo */
// 构建时自动 AVIF 化：扫描 source/ 下所有 jpg/jpeg/png/webp，
// 生成同名 .avif（最长边 800px、q65，带 mtime 缓存跳过未变更文件）；
// 渲染 HTML 时把 <img> 自动改写为 <picture>（AVIF 优先 + 原图兜底）。
// SVG（图标/插画类）不做转换。

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const CONVERT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_WIDTH = 800;
const QUALITY = 65;
const CACHE_FILE = path.join(hexo.base_dir, '.avif-cache.json');

let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch (e) { /* 首次运行为空 */ }

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out);
    } else if (CONVERT_EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(full);
    }
  }
}

async function convertAll() {
  const sourceDir = hexo.source_dir;
  const files = [];
  walk(sourceDir, files);
  let dirty = false;

  for (const src of files) {
    const out = src.replace(/\.(jpe?g|png|webp)$/i, '.avif');
    const st = fs.statSync(src);
    const prev = cache[src];
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size && fs.existsSync(out)) continue;

    try {
      const img = sharp(src).rotate();
      const meta = await img.metadata();
      if (meta.width && meta.width > MAX_WIDTH) img.resize({ width: MAX_WIDTH });
      await img.avif({ quality: QUALITY }).toFile(out);
      cache[src] = { mtimeMs: st.mtimeMs, size: st.size };
      dirty = true;
      hexo.log.i('AVIF 已生成: ' + path.relative(sourceDir, out));
    } catch (err) {
      hexo.log.w('AVIF 转换失败: ' + src + ' — ' + err.message);
    }
  }
  if (dirty) fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  // 封面池：source/images/cover/ 下的全部 avif（供无封面文章自动分配）
  const coverDir = path.join(sourceDir, 'images', 'cover');
  const covers = [];
  if (fs.existsSync(coverDir)) {
    fs.readdirSync(coverDir).filter(f => f.endsWith('.avif')).sort()
      .forEach(f => covers.push('/images/cover/' + f));
  }
  hexo.config.pb_covers = covers;   // 挂到 config——模板里可直接访问
}

// 构建 目录 → 文章源文件 映射（每次渲染只建一次，避免逐图全量遍历文章）
function buildPostDirMap() {
  const map = Object.create(null);
  hexo.model('Post').find({}).forEach(function (p) {
    if (!p.path) return;
    map[p.path.replace(/\/$/, '')] = p.source;
  });
  return map;
}

// 把渲染后的图片 URL 反查回源文件路径（覆盖 site 图片与文章资产文件夹两种情况）
function toSourceFile(urlPath, postDirMap) {
  try {
    const root = hexo.config.root || '/';
    let rel = decodeURIComponent(urlPath);
    if (rel.startsWith(root)) rel = rel.slice(root.length);
    while (rel.startsWith('/')) rel = rel.slice(1);   // 无前导斜杠，模型查询与拼路径都依赖这点

    // 站点图片等：source/images/...
    const direct = path.join(hexo.source_dir, rel);
    if (fs.existsSync(direct)) return direct;

    // 文章资产文件夹：2026/01/05/<slug>/pic.png → source/_posts/<slug>/pic.png
    // Post.path 是虚拟字段，findOne({path}) 查不到，故用预先建好的目录映射
    const dir = path.posix.dirname(rel);
    const base = path.posix.basename(rel);
    const source = postDirMap && postDirMap[dir];
    if (source) {
      const candidate = path.join(hexo.source_dir, source.replace(/\.md$/i, ''), base);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  } catch (e) {
    return null;
  }
}

hexo.extend.filter.register('generateBefore', () => convertAll());
// hexo server 启动时也执行一次（watch 中途新增的图片需重启 dev 才转换）
convertAll();

hexo.extend.filter.register('after_render:html', function (html) {
  const postDirMap = buildPostDirMap();
  return html.replace(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi, function (tag, src) {
    if (/^(https?:|data:)/i.test(src)) return tag;
    if (/\.avif(\?|#|$)/i.test(src)) return tag;
    if (!CONVERT_EXTS.has(path.extname(src.replace(/[?#].*$/, '')).toLowerCase())) return tag;

    const avifUrl = src.replace(/\.(jpe?g|png|webp)(?=[?#]|$)/i, '.avif');
    const avifSrc = toSourceFile(avifUrl, postDirMap);
    if (!avifSrc) return tag;

    return '<picture><source srcset="' + avifUrl + '" type="image/avif">' + tag + '</picture>';
  });
});
