// 跑步记录页（/runs/）：从 window.PB_FITNESS.dataUrl 拉取导出数据并渲染。
//
// 数据结构（由服务器上的导出脚本生成）：
//   { runs: [{ date, time, dur, dist, kcal, hr, hrmax, pace, cad, curve, route }] }
//   curve: [[offsetSec, hr, paceSec], ...]；route: 归一化后的 [[x, y], ...]
//
// 页面通过 SPA 路由换入时脚本不会重新执行，所以由 pbInitPage 调用 pbInitRuns()。
(function () {
  'use strict';

  var state = {
    runs: [],
    sel: 0,
    weekOffset: 0,
    loaded: false,
    loading: false,
    error: ''
  };
  var WEEKS = 12;

  var DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function dateObj(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function weekdayCN(k) { return DOW[dateObj(k).getDay()]; }
  function dateCN(k) {
    var d = dateObj(k);
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  function fmtKm(m) { return (m / 1000).toFixed(2); }
  function fmtPace(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    sec = Math.round(sec);
    return Math.floor(sec / 60) + '\'' + pad(sec % 60) + '"';
  }
  function fmtDur(min) {
    if (min >= 60) return Math.floor(min / 60) + ' 小时 ' + pad(min % 60) + ' 分';
    return min + ' 分';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 周一为一周起点
  function weekStart(k) {
    var d = dateObj(k);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return keyOf(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function historyStart() {
    // 能往前翻到的最早一周：首次同步回填的起点（取最早一条记录）
    return state.runs.length ? weekStart(state.runs[0].date) : weekStart(keyOf(new Date().getFullYear(), 0, 1));
  }

  function maxWeekOffset() {
    if (!state.runs.length) return 0;
    var lastWeek = weekStart(state.runs[state.runs.length - 1].date);
    var back = Math.round((dateObj(lastWeek) - dateObj(historyStart())) / (7 * 864e5));
    return Math.ceil(Math.max(0, back) / WEEKS);
  }

  /* ---------------- 图表 ---------------- */

  function chartSVG(run, w, h) {
    w = w || 480; h = h || 150;
    var c = (run.curve || []).filter(function (p) { return p[0] != null; });
    if (c.length < 3) return '<p class="dim">这次没有秒级明细</p>';
    var t0 = c[0][0], t1 = c[c.length - 1][0] || t0 + 1;
    var L = 34, R = 42, T = 12, B = 20;
    var iw = w - L - R, ih = h - T - B;
    var hrv = c.map(function (p) { return p[1]; }).filter(function (v) { return v != null; });
    var pv = c.map(function (p) { return p[2]; }).filter(function (v) { return v != null && v >= 150 && v <= 1100; });
    var hlo = (hrv.length ? Math.min.apply(null, hrv) : 60) - 8;
    var hhi = (hrv.length ? Math.max.apply(null, hrv) : 170) + 8;
    var plo = pv.length ? Math.min.apply(null, pv) : 300;
    var phi = pv.length ? Math.max.apply(null, pv) : 700;

    function x(t) { return L + (t - t0) / ((t1 - t0) || 1) * iw; }
    function yHR(v) { return T + (1 - (v - hlo) / ((hhi - hlo) || 1)) * ih; }
    function yP(v) { return T + (v - plo) / ((phi - plo) || 1) * ih; }

    // 断点处断开成多段，避免把空白连成直线
    function segs(idx, yf, filt) {
      var out = [], cur = [];
      c.forEach(function (p) {
        var v = p[idx];
        var ok = v != null && (!filt || filt(v));
        if (!ok) { if (cur.length > 1) out.push(cur); cur = []; return; }
        cur.push([x(p[0]), yf(v)]);
      });
      if (cur.length > 1) out.push(cur);
      return out;
    }
    function path(s) {
      return s.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
    }

    var grid = [0, .25, .5, .75, 1].map(function (f) {
      var y = T + f * ih;
      return '<line x1="' + L + '" y1="' + y + '" x2="' + (w - R) + '" y2="' + y + '"/>';
    }).join('');
    var mins = Math.round((t1 - t0) / 60);

    return '<div class="chart-legend"><span class="lg hr">心率</span><span class="lg pace">配速</span></div>' +
      '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="心率与配速曲线">' +
      '<g class="grid">' + grid + '</g>' +
      segs(1, yHR).map(function (s) { return '<path d="' + path(s) + '" class="ln-hr"/>'; }).join('') +
      segs(2, yP, function (v) { return v >= 150 && v <= 1100; })
        .map(function (s) { return '<path d="' + path(s) + '" class="ln-pace"/>'; }).join('') +
      '<text x="' + (L - 6) + '" y="' + (T + 4) + '" class="ax" text-anchor="end">' + Math.round(hhi - 8) + '</text>' +
      '<text x="' + (L - 6) + '" y="' + (h - B) + '" class="ax" text-anchor="end">' + Math.round(hlo + 8) + '</text>' +
      '<text x="' + (w - R + 6) + '" y="' + (T + 4) + '" class="ax">' + fmtPace(plo) + '</text>' +
      '<text x="' + (w - R + 6) + '" y="' + (h - B) + '" class="ax">' + fmtPace(phi) + '</text>' +
      '<text x="' + L + '" y="' + (h - 5) + '" class="ax">0</text>' +
      '<text x="' + (w - R) + '" y="' + (h - 5) + '" class="ax" text-anchor="end">' + mins + ' 分</text>' +
      '</svg>';
  }

  function routeSVG(run) {
    var pts = run.route || [];
    if (pts.length < 2) return '<p class="dim">这次没有轨迹</p>';
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
    var s = pts[0], e = pts[pts.length - 1];
    return '<svg class="route-svg" viewBox="-6 -6 112 112" role="img" aria-label="跑步轨迹形状">' +
      '<path d="' + d + '" fill="none" stroke="var(--color-primary)" stroke-width="2.4" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + s[0] + '" cy="' + s[1] + '" r="3.2" fill="var(--color-card)" ' +
      'stroke="var(--color-primary)" stroke-width="2"/>' +
      '<circle cx="' + e[0] + '" cy="' + e[1] + '" r="3.2" fill="var(--color-primary)"/>' +
      '</svg>';
  }

  function spark(run) {
    var c = (run.curve || []).filter(function (p) { return p[2] != null && p[2] >= 150 && p[2] <= 1100; });
    if (c.length < 3) return '';
    var t0 = c[0][0], t1 = c[c.length - 1][0] || t0 + 1;
    var vs = c.map(function (p) { return p[2]; });
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    var pts = c.map(function (p) {
      return ((p[0] - t0) / ((t1 - t0) || 1) * 60 + 2).toFixed(1) + ',' +
        (2 + (p[2] - lo) / ((hi - lo) || 1) * 14).toFixed(1);
    }).join(' ');
    return '<svg class="spark" viewBox="0 0 64 18" aria-hidden="true"><polyline points="' + pts + '"/></svg>';
  }

  /* ---------------- 区块 ---------------- */

  function weekStripHTML() {
    var run = state.runs[state.sel];
    var selWeek = run ? weekStart(run.date) : null;
    var lastRun = state.runs[state.runs.length - 1];
    var lastWeek = weekStart(lastRun.date);

    state.weekOffset = Math.min(Math.max(state.weekOffset, 0), maxWeekOffset());

    var list = [];
    for (var i = 0; i < WEEKS; i++) {
      var d = dateObj(lastWeek);
      d.setDate(d.getDate() - (state.weekOffset * WEEKS + (WEEKS - 1 - i)) * 7);
      if (d < dateObj(historyStart())) { list.push(null); continue; }
      var wk = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
      var kmSum = 0, count = 0;
      state.runs.forEach(function (r) {
        if (weekStart(r.date) === wk) { kmSum += r.dist; count++; }
      });
      list.push({ wk: wk, km: kmSum / 1000, count: count, date: d });
    }

    var valid = list.filter(Boolean);
    var max = Math.max.apply(null, valid.map(function (x) { return x.km; }).concat([1]));

    // 侧栏跟随高亮的那一周；选中的跑步不在当前窗口时，退化为整页合计
    var selInWindow = valid.filter(function (x) { return x.wk === selWeek; })[0] || null;
    var side;
    if (selInWindow) {
      var inWeek = state.runs.filter(function (r) { return weekStart(r.date) === selInWindow.wk; });
      var wMin = inWeek.reduce(function (s, r) { return s + r.dur; }, 0);
      var wKm = inWeek.reduce(function (s, r) { return s + r.dist; }, 0) / 1000;
      var hrList = inWeek.map(function (r) { return r.hr; }).filter(function (v) { return v; });
      var wEnd = new Date(dateObj(selInWindow.wk).getTime() + 6 * 864e5);
      side = {
        range: (dateObj(selInWindow.wk).getMonth() + 1) + '/' + dateObj(selInWindow.wk).getDate() + ' – ' +
          (wEnd.getMonth() + 1) + '/' + wEnd.getDate() + ' · ' + inWeek.length + ' 次',
        km: wKm,
        min: wMin,
        pace: wKm > 0 ? Math.round(wMin * 60 / wKm) : null,
        hr: hrList.length ? Math.round(hrList.reduce(function (s, v) { return s + v; }, 0) / hrList.length) : null
      };
    } else {
      var pageKm = valid.reduce(function (s, x) { return s + x.km; }, 0);
      var pageRuns = state.runs.filter(function (r) {
        return valid.some(function (x) { return x.wk === weekStart(r.date); });
      });
      var pMin = pageRuns.reduce(function (s, r) { return s + r.dur; }, 0);
      var pHr = pageRuns.map(function (r) { return r.hr; }).filter(function (v) { return v; });
      side = {
        range: '本页 12 周 · 合计 ' + pageRuns.length + ' 次',
        km: pageKm,
        min: pMin,
        pace: pageKm > 0 ? Math.round(pMin * 60 / pageKm) : null,
        hr: pHr.length ? Math.round(pHr.reduce(function (s, v) { return s + v; }, 0) / pHr.length) : null
      };
    }

    // 柱状图用百分比高度绘制：绘图区高度固定，柱子底边对齐网格底线
    var slotPct = 100 / WEEKS;
    var bars = '', xlabels = '';
    list.forEach(function (x, i) {
      var cx = slotPct * i + slotPct / 2;
      if (!x) return;
      var on = x.wk === selWeek;
      // 标签隔周显示；两端各外移一点，避免被绘图区边缘裁掉。
      // 最后两格里未选中的那个不再显示，否则会与选中周的标签叠在一起
      var skipNearEnd = i >= WEEKS - 2 && !on;
      if ((i % 2 === 0 || on) && !skipNearEnd) {
        var edge = i === 0 ? ' edge-l' : (i >= WEEKS - 2 ? ' edge-r' : '');
        xlabels += '<span class="' + (on ? 'cur' : (i % 4 === 0 ? '' : 'l3')) + edge + '" style="left:' + cx.toFixed(2) + '%">' +
          (x.date.getMonth() + 1) + '/' + x.date.getDate() + '</span>';
      }
      var label = (x.date.getMonth() + 1) + ' 月 ' + x.date.getDate() + ' 日起这一周，' +
        x.km.toFixed(2) + ' 公里，' + x.count + ' 次';
      bars += '<div class="wk-slot" style="left:' + (slotPct * i).toFixed(2) + '%;width:' + slotPct.toFixed(2) + '%">' +
        '<div class="bar' + (x.count ? '' : ' off') + (on ? ' sel' : '') + '"' +
        (x.count ? ' data-wk="' + x.wk + '" role="button" tabindex="0"' : '') +
        ' style="height:' + Math.max(x.km / max * 100, 1).toFixed(1) + '%"' +
        ' title="' + esc(label) + '" aria-label="' + esc(label) + '"></div></div>';
    });

    var olderDisabled = state.weekOffset >= maxWeekOffset();
    var newerDisabled = state.weekOffset <= 0;

    return '<div class="card v2-weeks">' +
      '<div class="v2-weeks-h"><b>周跑量</b><span>' +
      (state.weekOffset === 0 ? '最近 12 周' : '更早的 12 周') + ' · 每周一为起点 · km</span></div>' +
      '<div class="v2-weeks-body">' +
      '<div class="v2-weeks-main">' +
      '<button class="wk-nav" data-wk-nav="-1"' + (newerDisabled ? ' disabled' : '') +
      ' aria-label="更新的一周" title="更新的一周">‹</button>' +
      '<div class="wk-chart">' +
      '<div class="wk-plot">' +
      '<div class="wk-grid" aria-hidden="true"></div>' +
      '<span class="wk-ymax">' + max.toFixed(0) + '</span><span class="wk-y0">0</span>' +
      bars +
      '</div>' +
      '<div class="wk-xlabels">' + xlabels + '</div>' +
      '</div>' +
      '<button class="wk-nav" data-wk-nav="1"' + (olderDisabled ? ' disabled' : '') +
      ' aria-label="更早的一周" title="更早的一周">›</button>' +
      '</div>' +
      '<dl class="wk-side">' +
      '<div class="wk-range">' + esc(side.range) + '</div>' +
      '<div class="wk-figs">' +
      '<div><dt>跑量</dt><dd>' + side.km.toFixed(2) + '<small>km</small></dd></div>' +
      '<div><dt>时长</dt><dd>' + side.min + '<small>分</small></dd></div>' +
      '<div><dt>均配速</dt><dd>' + (side.pace ? fmtPace(side.pace) : '—') + '</dd></div>' +
      '<div><dt>均心率</dt><dd>' + (side.hr || '—') + '<small>bpm</small></dd></div>' +
      '</div></dl></div>' +
      noteHTML(selInWindow ? selInWindow.wk : null) + '</div>';
  }

  // 图表下方的一行小结：与上一周对比
  function noteHTML(wk) {
    if (!wk) return '<p class="wk-note">这一页还没有跑步记录，按 <b>‹</b> <b>›</b> 翻到有记录的那几周。</p>';
    var prev = new Date(dateObj(wk).getTime() - 7 * 864e5);
    var prevWk = keyOf(prev.getFullYear(), prev.getMonth(), prev.getDate());
    var cur = state.runs.filter(function (r) { return weekStart(r.date) === wk; });
    var old = state.runs.filter(function (r) { return weekStart(r.date) === prevWk; });
    var sum = function (a) { return a.reduce(function (s, r) { return s + r.dist; }, 0); };
    var cKm = sum(cur) / 1000, oKm = sum(old) / 1000;
    if (!old.length) {
      return '<p class="wk-note">上一周没有跑步。这一周共 <b>' + cKm.toFixed(2) + ' km</b>，' + cur.length + ' 次。</p>';
    }
    var diff = cKm - oKm;
    var dir = diff > 0.05 ? '多' : (diff < -0.05 ? '少' : '持平');
    var txt = dir === '持平' ? '与上一周持平' : '比上一周' + dir + ' <b>' + Math.abs(diff).toFixed(2) + ' km</b>';
    var longest = cur.reduce(function (a, b) { return a.dist >= b.dist ? a : b; }, cur[0]);
    return '<p class="wk-note">' + txt + '。这一周最长一次 <b>' + fmtKm(longest.dist) + ' km</b>（' +
      (dateObj(longest.date).getMonth() + 1) + '/' + dateObj(longest.date).getDate() + '）。</p>';
  }

  function summaryHTML() {
    var runs = state.runs;
    var totalDist = runs.reduce(function (s, r) { return s + r.dist; }, 0);
    var totalMin = runs.reduce(function (s, r) { return s + r.dur; }, 0);
    var avgPace = totalDist > 0 ? Math.round(totalMin * 60 / (totalDist / 1000)) : null;
    var months = {};
    runs.forEach(function (r) {
      var k = r.date.slice(0, 7);
      months[k] = (months[k] || 0) + r.dist;
    });
    var keys = Object.keys(months).sort();
    var maxM = Math.max.apply(null, keys.map(function (k) { return months[k]; }).concat([1]));
    var longest = runs.reduce(function (a, b) { return a.dist >= b.dist ? a : b; });
    var last = runs[runs.length - 1];
    var hrs = runs.map(function (r) { return r.hr; }).filter(function (v) { return v; });

    return '<div class="card v2-sum">' +
      '<div class="v2-sum-h"><b>累计</b><span>全部记录</span></div>' +
      '<div class="v2-sum-lead"><b>' + (totalDist / 1000).toFixed(1) + '</b><span>km</span></div>' +
      '<div class="v2-sum-sub">' + runs.length + ' 次跑步 · ' + fmtDur(totalMin) +
      (avgPace ? ' · 平均 ' + fmtPace(avgPace) + '/km' : '') + '</div>' +
      '<dl class="v2-sum-grid">' +
      '<div><dt>最长一次</dt><dd>' + fmtKm(longest.dist) + '<small>km</small></dd></div>' +
      '<div><dt>最近一次</dt><dd>' + fmtKm(last.dist) + '<small>km</small></dd></div>' +
      '<div><dt>平均心率</dt><dd>' +
      (hrs.length ? Math.round(hrs.reduce(function (s, v) { return s + v; }, 0) / hrs.length) : '—') +
      '<small>bpm</small></dd></div>' +
      '<div><dt>总卡路里</dt><dd>' + runs.reduce(function (s, r) { return s + (r.kcal || 0); }, 0) +
      '<small>kcal</small></dd></div>' +
      '</dl>' +
      '<div class="v2-months">' + keys.map(function (k) {
        var parts = k.split('-');
        return '<div><span>' + parts[0].slice(2) + '/' + parts[1] + '</span>' +
          '<i style="width:' + (months[k] / maxM * 100).toFixed(1) + '%"></i>' +
          '<em>' + (months[k] / 1000).toFixed(1) + ' km</em></div>';
      }).join('') + '</div>' +
      '</div>';
  }

  function detailHTML(i) {
    var r = state.runs[i];
    if (!r) return '';
    var wk = weekStart(r.date);
    var wkm = 0, wcount = 0;
    state.runs.forEach(function (x) {
      if (weekStart(x.date) === wk) { wkm += x.dist; wcount++; }
    });
    return '<div class="ledger-detail">' +
      '<div class="ld-label">' + r.date + ' · ' + weekdayCN(r.date) + ' · ' + r.time + '</div>' +
      '<div class="ld-km">' + fmtKm(r.dist) + '<small>km</small></div>' +
      '<dl class="ld-grid">' +
      '<div><dt>移动时间</dt><dd>' + r.dur + ' 分</dd></div>' +
      '<div><dt>平均配速</dt><dd>' + fmtPace(r.pace) + ' /km</dd></div>' +
      '<div><dt>平均心率</dt><dd>' + (r.hr || '—') + ' bpm</dd></div>' +
      '<div><dt>最高心率</dt><dd>' + (r.hrmax || '—') + ' bpm</dd></div>' +
      '<div><dt>步频</dt><dd>' + (r.cad || '—') + ' spm</dd></div>' +
      '<div><dt>卡路里</dt><dd>' + (r.kcal || '—') + ' kcal</dd></div>' +
      '</dl>' +
      '<div class="ld-sub" style="margin:-6px 0 12px">本周累计 ' + (wkm / 1000).toFixed(2) +
      ' km · ' + wcount + ' 次</div>' +
      chartSVG(r) +
      '<div class="ld-route">' + routeSVG(r) + '</div>' +
      '</div>';
  }

  function ledgerListHTML() {
    var list = '';
    var lastMonth = '';
    var lastWeek = '';
    // 倒序：最新的一次排在最上面；data-i 仍指向 state.runs 里的原始索引
    state.runs.map(function (r, idx) { return idx; }).reverse().forEach(function (i) {
      var r = state.runs[i];
      var d = dateObj(r.date);
      var mk = d.getFullYear() + '-' + (d.getMonth() + 1);
      var wk = weekStart(r.date);
      if (mk !== lastMonth) {
        lastMonth = mk;
        lastWeek = '';
        list += '<div class="v2-month">' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月</div>';
      }
      if (wk !== lastWeek) {
        lastWeek = wk;
        var wkm = 0, wcount = 0;
        state.runs.forEach(function (x) {
          if (weekStart(x.date) === wk) { wkm += x.dist; wcount++; }
        });
        var wd = dateObj(wk);
        list += '<div class="v2-week">' +
          '<span class="v2-week-t">' + (wd.getMonth() + 1) + '/' + wd.getDate() + ' 那一周</span>' +
          '<span class="v2-week-r">' + wcount + ' 次</span>' +
          '<span class="v2-week-sum">' + (wkm / 1000).toFixed(2) + ' <span>km</span></span>' +
          '</div>';
      }
      list += '<button class="entry' + (i === state.sel ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="e-date"><b>' + pad(d.getDate()) + '</b><i>' + weekdayCN(r.date) + '</i></span>' +
        '<span class="e-mid"><b>' + fmtKm(r.dist) + ' km</b><span>' +
        fmtPace(r.pace) + '/km · ' + r.dur + ' 分 · ' + r.time + '</span></span>' +
        '<span class="e-spark">' + spark(r) + '</span>' +
        '</button>';
    });
    return list;
  }

  /* ---------------- 渲染与交互 ---------------- */

  function render(scrollSel) {
    var root = document.getElementById('pb-runs');
    if (!root) return;
    if (!state.runs.length) {
      root.innerHTML = '<div class="card runs-error"><h2>还没有跑步记录</h2>' +
        '<p>数据尚未生成，稍后再来看看。</p></div>';
      return;
    }
    var totalMin = state.runs.reduce(function (s, r) { return s + r.dur; }, 0);
    var totalDist = state.runs.reduce(function (s, r) { return s + r.dist; }, 0);
    var first = state.runs[0].date;
    var firstLabel = first.slice(0, 4) + ' 年 ' + (+first.slice(5, 7)) + ' 月';
    var oldScroll = document.getElementById('pb-run-scroll');
    var keepTop = oldScroll ? oldScroll.scrollTop : 0;

    root.innerHTML =
      '<div class="runs-head">' +
      '<h1 class="page-title">跑步<span class="page-title-sub">全部分 <i>' +
      state.runs.length + '</i> 次</span></h1>' +
      '<p class="runs-intro">从 ' + firstLabel + ' 开始的手表记录 · 累计 ' +
      (totalDist / 1000).toFixed(1) + ' km / ' + fmtDur(totalMin) + '</p>' +
      '</div>' +
      '<div class="v2-top">' +
      '<div class="v2-col">' + weekStripHTML() +
      '<div class="card v2-ledger">' +
      '<div class="v2-ledger-h"><b>RUN LOG</b><span>' + state.runs.length + ' 次 · ' +
      (totalDist / 1000).toFixed(1) + ' km · ' + fmtDur(totalMin) + '</span></div>' +
      '<div class="v2-ledger-scroll" id="pb-run-scroll">' + ledgerListHTML() + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="v2-col">' + summaryHTML() +
      '<div class="v2-detail-wrap">' + detailHTML(state.sel) + '</div>' +
      '</div>' +
      '</div>';

    var sc = document.getElementById('pb-run-scroll');
    if (!sc) return;
    var ledger = sc.closest('.v2-ledger');
    function syncFade() {
      if (!ledger) return;
      ledger.classList.toggle('at-end', sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4);
    }
    sc.addEventListener('scroll', syncFade, { passive: true });
    requestAnimationFrame(syncFade);

    if (keepTop) {
      sc.scrollTop = keepTop;
      // 刚换完 innerHTML 时布局还没算好，直接写会被重置，下一帧再写一次
      requestAnimationFrame(function () { sc.scrollTop = keepTop; });
      return;
    }
    // 点周柱跳转时才把选中项滚进视野；其余情况保持原位
    if (scrollSel) {
      var selEl = sc.querySelector('.entry.sel');
      if (selEl) {
        var sr = sc.getBoundingClientRect(), er = selEl.getBoundingClientRect();
        var pad = 14;
        if (er.bottom > sr.bottom - pad) sc.scrollTop += Math.round(er.bottom - sr.bottom + pad);
        else if (er.top < sr.top + pad) sc.scrollTop -= Math.round(sr.top - er.top + pad);
      }
    }
  }

  function onClick(e) {
    var nav = e.target.closest('.wk-nav[data-wk-nav]');
    if (nav && !nav.disabled) {
      state.weekOffset += +nav.getAttribute('data-wk-nav');
      state.weekOffset = Math.max(0, state.weekOffset);
      render();
      return;
    }
    var bar = e.target.closest('.wk-plot .bar[data-wk]');
    if (bar) {
      // 点周柱：跳到这一周的第一条记录
      var w = bar.getAttribute('data-wk');
      var first = state.runs.findIndex(function (r) { return weekStart(r.date) === w; });
      if (first >= 0) {
        state.sel = first;
        var selWeek = weekStart(state.runs[first].date);
        var lastWeek = weekStart(state.runs[state.runs.length - 1].date);
        var back = Math.round((dateObj(lastWeek) - dateObj(selWeek)) / (7 * 864e5));
        state.weekOffset = Math.floor(Math.max(back, 0) / WEEKS);
        render(true);
      }
      return;
    }
    var entry = e.target.closest('.entry[data-i]');
    if (!entry) return;
    state.sel = +entry.getAttribute('data-i');
    var sw = weekStart(state.runs[state.sel].date);
    var lw = weekStart(state.runs[state.runs.length - 1].date);
    var bw = Math.round((dateObj(lw) - dateObj(sw)) / (7 * 864e5));
    state.weekOffset = Math.floor(Math.max(bw, 0) / WEEKS);
    render();
  }

  function onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var bar = e.target.closest && e.target.closest('.wk-plot .bar[data-wk]');
    if (!bar) return;
    e.preventDefault();
    bar.click();
  }

  /* ---------------- 数据加载 ---------------- */

  function load() {
    if (state.loaded || state.loading) return;
    var cfg = window.PB_FITNESS || {};
    if (!cfg.dataUrl) {
      showError('没有配置数据地址（themes/pinkblog/_config.yml → fitness.dataUrl）。');
      return;
    }
    state.loading = true;
    fetch(cfg.dataUrl, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var runs = (data && data.runs) || [];
        runs = runs.filter(function (r) { return r && r.date && r.dist > 0; })
          .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
        state.runs = runs;
        state.sel = runs.length - 1;
        state.loaded = true;
        render();
      })
      .catch(function (err) {
        showError('取数据失败（' + err.message + '），请稍后再试。');
      })
      .then(function () { state.loading = false; });
  }

  function showError(msg) {
    var root = document.getElementById('pb-runs');
    if (!root) return;
    var url = (window.PB_FITNESS && window.PB_FITNESS.dataUrl) || '';
    root.innerHTML = '<div class="card runs-error"><h2>跑步数据没能加载</h2>' +
      '<p>' + esc(msg) + '</p>' +
      (url ? '<p style="margin-top:8px">数据源：' + esc(url) + '</p>' : '') +
      '</div>';
  }

  // 由 pbInitPage 在每次换页后调用；页面不在时直接返回
  window.pbInitRuns = function () {
    var root = document.getElementById('pb-runs');
    if (!root) return;
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', onKey);
    }
    if (state.loaded) render();
    else load();
  };

  // 首屏直接打开 /runs/ 时立刻拉取；SPA 换入则由 pbInitPage 调用
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.pbInitRuns);
  } else {
    window.pbInitRuns();
  }
})();
