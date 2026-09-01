/* ===========================================================================
   TailRL advantage explorer.

   Drag the rollout rewards along the axis and watch how the same group maps to
   REINFORCE advantages and to TailRL advantages. Scales from 2 to 1024
   rollouts.

   REINFORCE (expected reward, mean baseline):  A_i = r_i - mean(r)
   TailRL:                                      A_i = w(r_i) - mean(w),
     with w(r_(i)) = sum_{k<=i} (r_(k) - r_(k-1)) / (N - k + 1)

   Vanilla ES5, no dependencies, no globals.
   ========================================================================= */
(function () {
  var root = document.getElementById('tailrl-explorer');
  if (!root) return;
  var NS = 'http://www.w3.org/2000/svg';
  var C = { tailrl: '#C0392B', reinforce: '#46628F', ink: '#1f2937', muted: '#1f2937', grid: '#e5e7eb',
            dist: '#8A5A10' };   // the dark yellow the two-policy widget uses

  // the rollout budgets the paper trains at; the slider steps over these only
  var STOPS = [16, 64, 256, 1024], START = 1;
  var N = STOPS[START], rewards = [], hover = -1;

  function gauss() {                                 // Box-Muller
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  var KB = 64;                                     // histogram bars over [0, 1]

  /* The reward distribution IS the control. `shape` holds a density over KB
     bins with unit peak; the reader draws on it directly and the rollouts are
     read back out of it. Editing a distribution and choosing how many rollouts
     to draw from it is the whole model, so there is nothing else to learn. */
  var shape = new Array(KB);

  /* A starting distribution: one to three bumps at random places, evaluated on
     the grid rather than sampled, so the curve is smooth from the first frame
     and the reader has something to push around. */
  function newShape() {
    var K = 1 + Math.floor(Math.random() * 3), comps = [], i, j, t, mu, ok;
    for (i = 0; i < K; i++) {
      // drawn freely the bumps often merge, and a three-bump mixture then
      // reads as one; keep them apart
      for (t = 0; t < 40; t++) {
        mu = 0.12 + 0.76 * Math.random();
        ok = true;
        for (j = 0; j < comps.length; j++) if (Math.abs(mu - comps[j].mu) < 0.19) { ok = false; break; }
        if (ok) break;
      }
      comps.push({ mu: mu, sd: 0.04 + 0.05 * Math.random(), w: 0.6 + 0.8 * Math.random() });
    }
    var out = new Array(KB), mx = 0, x, v;
    for (i = 0; i < KB; i++) {
      x = i / (KB - 1); v = 0;
      for (j = 0; j < comps.length; j++) {
        t = (x - comps[j].mu) / comps[j].sd;
        v += comps[j].w * Math.exp(-0.5 * t * t);
      }
      out[i] = v; if (v > mx) mx = v;
    }
    for (i = 0; i < KB; i++) out[i] = mx > 0 ? out[i] / mx : 0;
    return out;
  }

  /* Rollouts are read off the distribution by inverting its CDF at N evenly
     spaced quantiles, not by sampling it. Sampling would reshuffle every
     reward on each edit and on every change of N, so the advantage panels
     would jump for reasons the reader did not cause. */
  function drawFrom(sh, n) {
    var cdf = new Array(KB), acc = 0, i, out = [], k = 0, q;
    for (i = 0; i < KB; i++) { acc += Math.max(0, sh[i]); cdf[i] = acc; }
    if (acc <= 1e-9) { for (i = 0; i < n; i++) out.push(0.5); return out; }
    for (i = 0; i < KB; i++) cdf[i] /= acc;
    for (i = 0; i < n; i++) {
      q = (i + 0.5) / n;
      while (k < KB - 1 && cdf[k] < q) k++;
      out.push(Math.round((k / (KB - 1)) * 1000) / 1000);
    }
    return out;
  }
  function resample() { rewards = drawFrom(shape, N); }

  function order(r) { return r.map(function (v, i) { return i; }).sort(function (a, b) { return r[a] - r[b] || a - b; }); }

  function tailrl(r) {
    var n = r.length, idx = order(r), w = new Array(n), prev = 0, acc = 0;
    idx.forEach(function (j, k) { acc += (r[j] - prev) / (n - k); prev = r[j]; w[j] = acc; });
    var wbar = w.reduce(function (s, v) { return s + v; }, 0) / n;
    return { w: w, A: w.map(function (v) { return v - wbar; }), wbar: wbar, idx: idx };
  }
  // REINFORCE with the group mean as baseline: the expected-reward update.
  // RLOO is the same map up to the factor N/(N-1), so its shape is identical.
  function reinforce(r) {
    var n = r.length, m = r.reduce(function (s, v) { return s + v; }, 0) / n;
    return r.map(function (v) { return v - m; });
  }

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls || 'svg-label', 'text-anchor': anchor || 'middle' }, parent);
    t.textContent = s; return t;
  }
  /* Labels that mix prose and symbols. Segments between | are set in
     KaTeX_Math italic, the rest in KaTeX_Main upright, so the widget uses the
     same faces as the page's rendered equations. */
  function mtext(parent, x, y, spec, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls || 'svg-label', 'text-anchor': anchor || 'middle' }, parent);
    spec.split('|').forEach(function (seg, i) {
      if (seg === '') return;
      var ts = el('tspan', { 'class': (i % 2) ? 'sv-math' : 'sv-text' }, t);
      ts.textContent = seg;
    });
    return t;
  }
  // At N = 1024 the interesting magnitudes sit near 1/1024, so widen the
  // precision there rather than printing a row of zeros.
  function dec(v) { var a = Math.abs(v); return (a > 0 && a < 0.01) ? 4 : 3; }

  // How the group is drawn at each size. Beyond 64 rollouts individual
  // glyphs stop being resolvable, so the panels switch to a sorted profile.
  function sizing() {
    var n = rewards.length;
    if (n <= 16)  return { r: 7,   op: 1,   bars: true  };
    if (n <= 64)  return { r: 5,   op: 0.8, bars: true  };
    if (n <= 256) return { r: 3.5, op: 0.6, bars: false };
    return              { r: 2.5, op: 0.5, bars: false };
  }

  var svgR = document.getElementById('ex-svg-rewards');
  var svgA = document.getElementById('ex-svg-adv');

  // ---- Panel A: the draggable reward strip ----
  var PA = { x0: 60, x1: 730, yRoll: 233, kdeTop: 30, kdeBase: 214 };

  /* No KDE any more: the curve on screen is the distribution the reader drew,
     and the rollouts are derived from it rather than the other way round. */

  function xOf(t) { return PA.x0 + t * (PA.x1 - PA.x0); }
  function tOf(x) { return Math.min(1, Math.max(0, (x - PA.x0) / (PA.x1 - PA.x0))); }
  function localX(svg, e) {
    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function nearest(t) {
    var best = -1, bd = Infinity, i, d;
    for (i = 0; i < rewards.length; i++) {
      d = Math.abs(rewards[i] - t);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function drawRewards() {
    while (svgR.firstChild) svgR.removeChild(svgR.firstChild);
    var res = tailrl(rewards), idx = res.idx, n = rewards.length, sz = sizing();
    mtext(svgR, (PA.x0 + PA.x1) / 2, 20, 'Draw the reward distribution', 'svg-title');

    /* density band above the axis */
    var dens = shape, di, dx, dy, bw = (PA.x1 - PA.x0) / KB;
    for (di = 0; di < KB; di++) {
      dx = PA.x0 + di * bw;
      dy = PA.kdeBase - Math.max(0, dens[di]) * (PA.kdeBase - PA.kdeTop);
      el('rect', { x: dx + bw * 0.12, y: dy, width: bw * 0.76,
                   height: Math.max(0.6, PA.kdeBase - dy),
                   fill: C.dist, opacity: 0.5 }, svgR);
    }
    el('line', { x1: PA.x0, x2: PA.x1, y1: PA.kdeBase, y2: PA.kdeBase,
                 stroke: C.dist, 'stroke-width': 1, opacity: 0.6 }, svgR);
    var dmid = (PA.kdeTop + PA.kdeBase) / 2;
    var dl = mtext(svgR, 20, dmid, 'density', 'svg-tick');
    dl.setAttribute('transform', 'rotate(-90, 20, ' + dmid + ')');

    // reward axis
    el('line', { x1: PA.x0, x2: PA.x1, y1: PA.yRoll, y2: PA.yRoll, stroke: C.ink, 'stroke-width': 1.2 }, svgR);
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (v) {
      el('line', { x1: xOf(v), x2: xOf(v), y1: PA.yRoll - 4, y2: PA.yRoll + 4, stroke: C.ink, 'stroke-width': 1 }, svgR);
      text(svgR, xOf(v), PA.yRoll + 32, v.toFixed(1), 'svg-tick');
    });
    mtext(svgR, (PA.x0 + PA.x1) / 2, PA.yRoll + 50, 'reward |r|', 'svg-label');

    var focus = hover >= 0 ? hover : idx[n - 1];

    /* The scatter of one dot per rollout is gone: the histogram above already
       shows where the rollouts are, and 1024 overlapping circles said less
       than the bars do. A single marker stays, because it names the rollout
       the advantage panels are highlighting. */
    var fr = rewards[focus];
    el('circle', { cx: xOf(fr), cy: PA.yRoll, r: sz.r * 1.4, fill: C.tailrl,
                   stroke: C.tailrl, 'stroke-width': 2, 'pointer-events': 'none' }, svgR);
    /* Beside the marker on the axis line rather than above it: with the bars
       now running down to just above the axis, a label placed above collided
       with the histogram's baseline. It flips to the left near the right end
       so it cannot run off the panel. */
    var right = fr < 0.82, off = sz.r * 1.4 + 7;
    var ft = mtext(svgR, xOf(fr) + (right ? off : -off), PA.yRoll + 16,
                   '|r| = ' + fr.toFixed(2), 'svg-tick', right ? 'start' : 'end');
    ft.style.fill = C.tailrl;
    ft.setAttribute('pointer-events', 'none');
  }


  /* A bar takes the pointer's height directly, the way the two-policy widget
     works. Bins between this point and the last are filled in on the way, so a
     quick sweep draws a continuous shape instead of leaving gaps wherever no
     frame happened to land. */
  var lastBin = -1;
  function setBin(i, v) { if (i >= 0 && i < KB) shape[i] = Math.min(1, Math.max(0, v)); }
  function paint(p) {
    var t = tOf(p.x), c = Math.round(t * (KB - 1));
    var target = (PA.kdeBase - p.y) / (PA.kdeBase - PA.kdeTop);
    target = Math.min(1, Math.max(0, target));
    if (lastBin >= 0 && Math.abs(c - lastBin) > 1) {
      var from = shape[lastBin], step = c > lastBin ? 1 : -1, i, f;
      for (i = lastBin; i !== c; i += step) {
        f = (i - lastBin) / (c - lastBin);
        setBin(i, from + (target - from) * f);
      }
    }
    setBin(c, target);
    lastBin = c;
    resample();
    hover = nearest(t);
  }

  var painting = false, rafId = 0, pendPt = null;
  function flush() { rafId = 0; if (pendPt) { paint(pendPt); pendPt = null; } render(); }
  function scheduleRender() { if (!rafId) rafId = requestAnimationFrame(flush); }

  // the bars are the drawing surface; the axis below them is only a readout
  function inBand(p) { return p.y >= PA.kdeTop - 12 && p.y <= PA.kdeBase + 8; }

  svgR.addEventListener('pointerdown', function (e) {
    var p = localX(svgR, e);
    if (!inBand(p)) return;
    painting = true; lastBin = -1;
    if (svgR.setPointerCapture) { try { svgR.setPointerCapture(e.pointerId); } catch (err) {} }
    pendPt = p; scheduleRender(); e.preventDefault();
  });

  svgR.addEventListener('pointermove', function (e) {
    var p = localX(svgR, e);
    if (!painting) {
      var j = nearest(tOf(p.x));
      if (j !== hover) { hover = j; scheduleRender(); }
      return;
    }
    pendPt = p; scheduleRender();
  });

  function stopPaint() {
    if (!painting) return;
    painting = false; lastBin = -1;
    if (pendPt) { paint(pendPt); pendPt = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    render();
  }
  svgR.addEventListener('pointerup', stopPaint);
  svgR.addEventListener('pointercancel', stopPaint);
  svgR.addEventListener('pointerleave', function () {
    stopPaint();
    if (hover !== -1) { hover = -1; scheduleRender(); }
  });

  function drawAdv() {
    while (svgA.firstChild) svgA.removeChild(svgA.firstChild);
    var res = tailrl(rewards), idx = res.idx, n = rewards.length, sz = sizing();
    var focus = hover >= 0 ? hover : idx[n - 1];
    var rank = new Array(n);
    idx.forEach(function (i, k) { rank[i] = k; });
    var methods = [
      { name: 'REINFORCE', sub: 'A = r − r̄', A: reinforce(rewards), color: C.reinforce },
      { name: 'TailRL',    sub: 'A = ω − ω̄', A: res.A,              color: C.tailrl }
    ];
    var panelW = 300, gap = 72, x0 = 84, yTop = 48, yBot = 208;
    methods.forEach(function (m, mi) {
      var px = x0 + mi * (panelW + gap);
      // each panel is normalised by its own largest magnitude, so the two show
      // the shape of the update; the printed bounds carry the differing scale
      var maxAbs = m.A.reduce(function (s, v) { return Math.max(s, Math.abs(v)); }, 0) || 1;
      var yMid = (yTop + yBot) / 2, scale = (yBot - yTop) / 2 / maxAbs * 0.92;
      text(svgA, px + panelW / 2, 20, m.name + ' advantage', 'svg-title').style.fill = m.color;
      mtext(svgA, px + panelW / 2, 36, m.sub, 'svg-tick');
      el('line', { x1: px, x2: px + panelW, y1: yMid, y2: yMid, stroke: C.muted, 'stroke-width': 1 }, svgA);
      text(svgA, px - 6, yTop + 4, '+' + maxAbs.toFixed(dec(maxAbs)), 'svg-tick', 'end');
      text(svgA, px - 6, yBot + 4, '−' + maxAbs.toFixed(dec(maxAbs)), 'svg-tick', 'end');
      // sits outboard of the bounds numbers, matching the rewards panel's
      // rotated "density" label
      var yl = mtext(svgA, px - 60, yMid, 'Advantages', 'svg-tick');
      yl.setAttribute('transform', 'rotate(-90, ' + (px - 60) + ', ' + yMid + ')');

      if (sz.bars) {
        var bw = panelW / n;
        idx.forEach(function (i, k) {
          var v = m.A[i], h = Math.abs(v) * scale;
          var rect = el('rect', { x: px + k * bw + bw * 0.15, y: v >= 0 ? yMid - h : yMid, width: bw * 0.7, height: Math.max(h, 0.5), fill: m.color, opacity: i === focus ? 1 : 0.45, 'data-i': i }, svgA);
          rect.style.cursor = 'pointer';
          rect.addEventListener('pointerenter', function () { if (!painting) { hover = i; scheduleRender(); } });
        });
      } else {
        // sorted profile: the same information as the bars, drawn as an area
        var stepW = panelW / n, dLine = '', dArea = 'M' + px + ' ' + yMid, xa, xb, yv;
        idx.forEach(function (i, k) {
          yv = yMid - m.A[i] * scale;
          xa = px + k * stepW; xb = xa + stepW;
          dLine += (k === 0 ? 'M' : 'L') + xa + ' ' + yv + 'L' + xb + ' ' + yv;
          dArea += 'L' + xa + ' ' + yv + 'L' + xb + ' ' + yv;
        });
        dArea += 'L' + (px + panelW) + ' ' + yMid + 'Z';
        el('path', { d: dArea, fill: m.color, opacity: 0.35 }, svgA);
        el('path', { d: dLine, fill: 'none', stroke: m.color, 'stroke-width': 1.5 }, svgA);
        var xf = px + (rank[focus] + 0.5) * stepW;
        el('line', { x1: xf, x2: xf, y1: yMid, y2: yMid - m.A[focus] * scale, stroke: m.color, 'stroke-width': 2 }, svgA);
        var hit = el('rect', { x: px, y: yTop, width: panelW, height: yBot - yTop, fill: 'transparent' }, svgA);
        hit.style.cursor = 'pointer';
        hit.addEventListener('pointermove', function (e) {
          if (painting) return;
          var q = localX(svgA, e);
          var kk = Math.min(n - 1, Math.max(0, Math.floor((q.x - px) / panelW * n)));
          if (idx[kk] !== hover) { hover = idx[kk]; scheduleRender(); }
        });
      }
      text(svgA, px + panelW / 2, yBot + 22, 'rollouts sorted by reward →', 'svg-tick');
    });
  }
  // registered once: re-registering inside drawAdv() leaked a listener per render
  svgA.addEventListener('pointerleave', function () { if (!painting && hover !== -1) { hover = -1; scheduleRender(); } });

  function render() { drawRewards(); drawAdv(); }

  // ---- Controls ----
  var nSlider = document.getElementById('ex-n-slider'), nValue = document.getElementById('ex-n-value');
  var pBox = document.getElementById('ex-preset-buttons');
  nSlider.addEventListener('input', function () {
    N = STOPS[parseInt(nSlider.value, 10)] || STOPS[START];
    resample();                       // same distribution, more rollouts drawn from it
    hover = -1; painting = false; pendPt = null;
    nValue.textContent = String(N);
    render();
  });

  (function () {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = 'New distribution';
    b.addEventListener('click', function () { shape = newShape(); resample(); hover = -1; render(); });
    pBox.appendChild(b);
  })();

  var resetBtn = document.getElementById('ex-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    N = STOPS[START]; hover = -1; painting = false; pendPt = null;
    nSlider.value = String(START);
    nValue.textContent = String(N);
    shape = newShape(); resample();
    render();
    resetBtn.blur();
  });

  shape = newShape();
  resample();
  nValue.textContent = String(N);
  render();
})();
