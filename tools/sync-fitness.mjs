#!/usr/bin/env node
// 同步小米运动健康的跑步数据到博客仓库。
//
// 一条命令跑完整链路：
//   1. mi-fitness-bridge sync --type workouts / workout_detail（可选，--no-sync 跳过）
//   2. 读本地 SQLite，导出跑步汇总 + 秒级曲线 + 归一化轨迹
//   3. 写 source/fitness.json，git add/commit/push（--no-push 跳过）
// Hexo 会把这个 JSON 原样拷进 public/，跑步页同源 fetch。
//
// 用法（在博客仓库根目录）：
//   pnpm sync:fitness                        # 同步最近 30 天 → 生成 → 提交推送
//   node tools/sync-fitness.mjs --no-sync    # 只从现有数据库导出
//   node tools/sync-fitness.mjs --no-push    # 只写文件，不提交
//   node tools/sync-fitness.mjs --days 90    # 同步窗口改成 90 天
//   node tools/sync-fitness.mjs --bridge /path/to/mi-fitness-bridge
//
// 数据库路径优先级：--db > MI_FITNESS_DB_PATH > ~/.local/share/mi-fitness-mcp/mi_fitness.db
//
// 注意：本文件必须放在 tools/ 而不是 scripts/ —— Hexo 会把 scripts/ 下的文件
// 当插件脚本加载，ESM + shebang 会直接报 "Script load failed"。

import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_FILE = path.join(ROOT, 'source', 'fitness.json');
const HISTORY_START = '2026-01-01';   // 首次同步的回填起点，也是页面能往前翻的最早一周

function parseArgs(argv) {
  const opts = {
    db: process.env.MI_FITNESS_DB_PATH || '',
    out: OUT_FILE,
    sync: true,
    push: true,
    days: 30,
    bridge: process.env.MI_FITNESS_BRIDGE || ''
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') opts.db = argv[++i];
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--days') opts.days = Math.max(1, parseInt(argv[++i], 10) || 30);
    else if (a === '--bridge') opts.bridge = argv[++i];
    else if (a === '--no-sync') opts.sync = false;
    else if (a === '--no-push') opts.push = false;
  }
  return opts;
}

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function findBridge(override) {
  if (override) return override;
  const home = homedir();
  const candidates = [
    // 本地仓库里的虚拟环境（参考 /home/<user>/fit/mi_fitness_data_bridge）
    path.join(home, 'fit', 'mi_fitness_data_bridge', '.venv', 'bin', 'mi-fitness-bridge'),
    path.join(home, '.local', 'bin', 'mi-fitness-bridge')
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return 'mi-fitness-bridge';   // 交给 PATH
}

function runSync(opts, dbPath) {
  const bridge = findBridge(opts.bridge);
  const end = new Date();
  const start = new Date(end.getTime() - (opts.days - 1) * 864e5);
  const range = ['--start-date', ymd(start), '--end-date', ymd(end)];

  // 先同步 workouts 拿到汇总，再同步 workout_detail 补秒级曲线 / 轨迹。
  // detail 只处理已有汇总记录里还没拉过明细的，重复跑是幂等的。
  for (const [type, label] of [['workouts', '跑步记录'], ['workout_detail', '秒级明细与轨迹']]) {
    const args = ['sync', '--type', type, ...range];
    if (dbPath) args.push('--db', dbPath);
    console.log(`[fit] 同步${label} ${ymd(start)} → ${ymd(end)}（${type}）`);
    const res = spawnSync(bridge, args, { stdio: 'inherit', encoding: 'utf-8' });
    if (res.error) {
      throw new Error(`无法运行 ${bridge}：${res.error.message}\n` +
        '可用 --bridge 指定路径，或先安装 mi-fitness-bridge。');
    }
    if (res.status !== 0) throw new Error(`${type} 同步失败（退出码 ${res.status}）`);
  }
}

function resolveDb(opts) {
  if (opts.db) return path.resolve(opts.db);
  return path.join(homedir(), '.local', 'share', 'mi-fitness-mcp', 'mi_fitness.db');
}

// 秒级曲线抽稀到约 60 个点；配速做合理区间过滤，避免 0 和离群值拉歪坐标轴
function buildCurve(db, workoutId) {
  const rows = db.prepare(
    'SELECT offset_seconds, heart_rate_bpm, pace_sec_per_km ' +
    'FROM workout_detail_samples WHERE workout_id = ? ORDER BY offset_seconds'
  ).all(workoutId);

  const pts = [];
  for (const r of rows) {
    const p = r.pace_sec_per_km;
    const h = r.heart_rate_bpm;
    const okP = p != null && p >= 150 && p <= 1200;
    const okH = h != null && h >= 40 && h <= 230;
    if (okP || okH) pts.push([r.offset_seconds, okH ? h : null, okP ? Math.round(p) : null]);
  }
  if (!pts.length) return [];

  const step = Math.max(1, Math.ceil(pts.length / 60));
  const out = pts.filter((_, i) => i % step === 0);
  if (out[out.length - 1][0] !== pts[pts.length - 1][0]) out.push(pts[pts.length - 1]);
  return out;
}

// 轨迹归一化：等比缩放到 0..100 的方框内（不含真实坐标）
function buildRoute(db, workoutId) {
  const rows = db.prepare(
    'SELECT latitude, longitude FROM workout_gps_points WHERE workout_id = ? ORDER BY offset_seconds'
  ).all(workoutId);
  if (rows.length < 2) return [];

  const step = Math.max(1, Math.ceil(rows.length / 90));
  const pts = rows.filter((_, i) => i % step === 0);

  const lats = pts.map(p => p.latitude);
  const lons = pts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos(midLat * Math.PI / 180);

  const xs = lons.map(v => (v - minLon) * kx);
  const ys = lats.map(v => v - minLat);
  const mx = Math.max(...xs) || 1e-9;
  const my = Math.max(...ys) || 1e-9;
  const scale = 100 / Math.max(mx, my);

  return xs.map((x, i) => [
    +(x * scale).toFixed(1),
    +(100 - ys[i] * scale).toFixed(1)
  ]);
}

function exportRuns(db) {
  const rows = db.prepare(
    'SELECT workout_id, start_at, duration_minutes, distance_m, calories_kcal, ' +
    'avg_heart_rate_bpm, max_heart_rate_bpm, avg_pace_sec_per_km, total_steps, avg_cadence ' +
    'FROM workouts ORDER BY start_at'
  ).all();

  const runs = [];
  for (const r of rows) {
    const dist = r.distance_m || 0;
    if (dist <= 0 || !r.start_at) continue;

    // 上游偶尔缺平均配速：用总时长 / 距离补一个
    let pace = r.avg_pace_sec_per_km;
    if (!pace && r.duration_minutes > 0) pace = r.duration_minutes * 60 / (dist / 1000);

    const startAt = String(r.start_at);
    runs.push({
      date: startAt.slice(0, 10),
      time: startAt.slice(11, 16),
      dur: r.duration_minutes || 0,
      dist: Math.round(dist),
      kcal: Math.round(r.calories_kcal || 0),
      hr: r.avg_heart_rate_bpm || null,
      hrmax: r.max_heart_rate_bpm || null,
      pace: pace ? Math.round(pace) : null,
      cad: r.avg_cadence || null,
      curve: buildCurve(db, r.workout_id),
      route: buildRoute(db, r.workout_id)
    });
  }
  return runs;
}

function git(...args) {
  const res = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} 失败：${msg}`);
  }
  return (res.stdout || '').trim();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dbPath = resolveDb(opts);

  if (!opts.sync && !existsSync(dbPath)) {
    throw new Error(`找不到数据库：${dbPath}\n先运行一次 mi-fitness-bridge sync，或用 --db 指定路径。`);
  }

  if (opts.sync) runSync(opts, opts.db ? dbPath : '');

  if (!existsSync(dbPath)) throw new Error(`找不到数据库：${dbPath}`);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let runs;
  try {
    runs = exportRuns(db);
  } finally {
    db.close();
  }
  if (!runs.length) throw new Error('数据库里没有可导出的跑步记录');

  const payload = {
    generatedAt: new Date().toISOString(),
    historyStart: HISTORY_START,
    runs
  };
  const prev = existsSync(opts.out) ? readFileSync(opts.out, 'utf-8') : '';
  const prevRuns = (() => {
    try { return JSON.parse(prev).runs; } catch { return null; }
  })();

  // 只有 runs 变化才算数据更新（generatedAt 每次都变，不参与比较）
  const changed = JSON.stringify(prevRuns) !== JSON.stringify(runs);
  if (!changed) {
    console.log(`[fit] 数据没有变化（${runs.length} 次跑步），跳过提交`);
    return;
  }

  // 每条跑步一行：diff 里一眼能看出是哪次记录变了，文件也不会因为缩进膨胀
  const body = runs.map(r => JSON.stringify(r)).join(',\n');
  const text = '{\n"generatedAt":' + JSON.stringify(payload.generatedAt) +
    ',\n"historyStart":' + JSON.stringify(payload.historyStart) +
    ',\n"runs":[\n' + body + '\n]\n}\n';
  writeFileSync(opts.out, text, 'utf-8');
  const rel = path.relative(ROOT, opts.out);
  console.log(`[fit] 已写入 ${rel}：${runs.length} 次跑步，${new Date().toISOString()}`);

  if (!opts.push) {
    console.log('[fit] 已跳过 git（--no-push）');
    return;
  }

  git('add', rel);
  const staged = spawnSync('git', ['diff', '--cached', '--quiet', '--', rel], { cwd: ROOT });
  if (staged.status === 0) {
    console.log('[fit] 文件内容与仓库一致，无需提交');
    return;
  }

  const today = ymd(new Date());
  git('commit', '-m', `data: 更新跑步数据（${today}）`, '--', rel);
  console.log('[fit] 已提交');
  try {
    git('push');
    console.log('[fit] 已推送，等待 Cloudflare 重新构建');
  } catch (e) {
    console.warn('[fit] 推送失败，提交已留在本地：' + e.message);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (e) {
  console.error('[fit] ' + e.message);
  process.exitCode = 1;
}
