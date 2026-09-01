/* ===========================================================================
   "Same mean, different tail" -- interactive widget for the TailRL page.

   Two reward distributions over 21 levels with equal expected reward. The
   mean cannot tell them apart; Best-of-k and the tail likelihood can.

   Vanilla ES5, no dependencies, no globals. Exits before building any UI if
   #smt-widget is absent.
   ========================================================================= */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var CA = '#236A85', CB = '#8A5A10';
  var INK = '#1f2937', MUTED = '#1f2937', GRID = '#e5e7eb';

  /* ------------------------------------------------------------------ model
     21 reward levels X[i] = i/20, i = 0..20, so 0 and 1 are exact and the
     binary case is representable without rounding. A policy is a vector of
     raw nonnegative weights w[i] in [0,1]; probabilities are w / sum(w).     */
  var L = 21, DX = 1 / (L - 1), X = [], li;
  for (li = 0; li < L; li++) X.push(li * DX);

  function total(w) { var s = 0, i; for (i = 0; i < w.length; i++) s += w[i]; return s; }

  function normalize(w) {
    var s = total(w), p, i;
    if (!(s > 0)) return null;
    p = new Array(w.length);
    for (i = 0; i < w.length; i++) p[i] = w[i] / s;
    return p;
  }

  function mean(p) { var m = 0, i; for (i = 0; i < L; i++) m += p[i] * X[i]; return m; }

  /* S[i] = Pr(r > X[i]) for i = 0 .. L-2. The tail curve is a step function
     equal to S[i] on [X[i], X[i+1]), so any integral over tau collapses to
     DX * sum_i f(S[i]) -- exact, no numerical integration. */
  function surv(p) {
    var S = new Array(L - 1), acc = 0, i;
    for (i = L - 1; i >= 1; i--) { acc += p[i]; S[i - 1] = acc; }
    return S;
  }

  function bestOfK(p, k) {
    var S = surv(p), s = 0, i;
    for (i = 0; i < S.length; i++) s += 1 - Math.pow(1 - S[i], k);
    return DX * s;
  }

  /* Order-T tail likelihood: DX * sum_i g_T(S[i]) with
     g_T(S) = -sum_{k=1..T} (1-S)^k / k.  g_T(0) = -H_T, so always finite. */
  function jTrunc(p, T) {
    var S = surv(p), s = 0, i, k, q, term;
    for (i = 0; i < S.length; i++) {
      q = 1 - S[i]; term = 0;
      for (k = 1; k <= T; k++) term += Math.pow(q, k) / k;
      s -= term;
    }
    return DX * s;
  }

  /* Population tail likelihood: -Infinity when the top reward is unreachable. */
  function jPop(p) {
    var S = surv(p), s = 0, i;
    for (i = 0; i < S.length; i++) {
      if (!(S[i] > 0)) return -Infinity;
      s += Math.log(S[i]);
    }
    return DX * s;
  }

  /* ------------------------------------------------------------- mean lock
     Multiply every movable bin by (1 + lam (X[i] - m)). The mean condition
     sum_i w_i (X[i] - m) = 0 then gives
        lam = -(mu - m) / sum_{i != fixed} p_i (X[i] - m)^2.
     Clamping the factors to be nonnegative breaks exactness, hence the loop. */
  function tilt(w, m, fixed) {
    var cur = w.slice(), prev, p, mu, den, lam, mx, pf, i, it;
    for (it = 0; it < 50; it++) {
      p = normalize(cur);
      if (!p) return { w: w.slice(), ok: false };
      mu = mean(p);
      if (Math.abs(mu - m) < 1e-12) break;
      den = 0;
      for (i = 0; i < L; i++) if (i !== fixed) den += p[i] * (X[i] - m) * (X[i] - m);
      if (den < 1e-12) return { w: cur, ok: false };   // all movable mass on one level
      lam = -(mu - m) / den;
      prev = cur.slice();
      for (i = 0; i < L; i++) if (i !== fixed) cur[i] = cur[i] * Math.max(0, 1 + lam * (X[i] - m));
      if (!(total(cur) > 1e-12)) return { w: prev, ok: false };  // tilt would annihilate all mass
    }
    mx = 0;
    for (i = 0; i < L; i++) if (cur[i] > mx) mx = cur[i];
    if (mx > 1) for (i = 0; i < L; i++) cur[i] = cur[i] / mx;
    pf = normalize(cur);
    return { w: cur, ok: !!pf && Math.abs(mean(pf) - m) < 1e-9 };
  }

  /* ---------------------------------------------------------------- presets */
  function zeros() { var a = [], i; for (i = 0; i < L; i++) a.push(0); return a; }

  function bump(c, s) {
    var a = [], i;
    for (i = 0; i < L; i++) a.push(Math.exp(-(X[i] - c) * (X[i] - c) / (2 * s * s)));
    return a;
  }

  function addTo(a, b, scale) { var i; for (i = 0; i < L; i++) a[i] += scale * b[i]; return a; }

  function at(spec) {
    var a = zeros(), key;
    for (key in spec) if (spec.hasOwnProperty(key)) a[Math.round(parseFloat(key) * (L - 1))] = spec[key];
    return a;
  }

  /* Scaling all weights by a constant leaves p, and therefore every quantity
     above, unchanged -- it only sets how tall the painted bars render. */
  function scaleToUnit(a) {
    var mx = 0, i;
    for (i = 0; i < L; i++) if (a[i] > mx) mx = a[i];
    if (mx > 0) for (i = 0; i < L; i++) a[i] = a[i] / mx;
    return a;
  }

  /* Two random shapes over the 21 levels, then B tilted onto A's mean. A is
     kept unimodal-ish and B is given a detached lump somewhere, so the pair
     almost always differs in the tail rather than only in the middle. */
  function randPair() {
    var a, b, i, n;
    a = bump(0.25 + 0.5 * Math.random(), 0.05 + 0.06 * Math.random());
    n = 1 + Math.floor(Math.random() * 2);
    for (i = 0; i < n; i++) addTo(a, bump(Math.random(), 0.04 + 0.05 * Math.random()), 0.15 + 0.3 * Math.random());
    b = bump(0.2 + 0.4 * Math.random(), 0.05 + 0.06 * Math.random());
    addTo(b, bump(0.75 + 0.24 * Math.random(), 0.03 + 0.04 * Math.random()), 0.08 + 0.22 * Math.random());
    return [a, b];
  }

  var PRESETS = {
    random: {
      label: 'Randomize',
      make: randPair
    },
    peaked: {
      label: 'Peaked vs. thin tail',
      make: function () {
        var a = bump(0.5, 0.07), b = bump(0.45, 0.07);
        addTo(b, bump(0.95, 0.05), 0.12);
        return [a, b];
      }
    },
    shortcut: {
      label: 'Safe shortcut vs. risky rewrites',
      make: function () {
        return [at({ 0.35: 0.15, 0.40: 0.70, 0.45: 0.15 }),
                at({ 0.00: 0.50, 0.50: 0.20, 1.00: 0.30 })];
      }
    },
    expdecay: {
      label: 'Exponentially decaying',
      /* A is a clean exponential decay; B decays at the same rate but carries a
         lump out in the tail. B has to differ in shape, not just in rate: the
         mean lock tilts by exp(lambda x), so one exponential tilted onto
         another's mean becomes that other exponential exactly, and the pair
         would collapse into a single curve. */
      make: function () {
        var a = [], b = [], i;
        for (i = 0; i < L; i++) a.push(Math.exp(-6 * X[i]));
        for (i = 0; i < L; i++) b.push(Math.exp(-6 * X[i]));
        addTo(b, bump(0.88, 0.055), 0.16);
        return [a, b];
      }
    }
  };

  /* Build a preset pair, then tilt B onto A's mean so the pair starts exactly
     equal regardless of how the recipe rounds onto the 21-level grid. */
  function makePair(key) {
    var tries = key === 'random' ? 12 : 1, t, pair, a, b, pa, tb, pb;
    for (t = 0; t < tries; t++) {
      pair = PRESETS[key].make();
      a = scaleToUnit(pair[0]); b = scaleToUnit(pair[1]);
      pa = normalize(a);
      if (!pa) continue;
      tb = tilt(b, mean(pa), null).w;
      pb = normalize(tb);
      // a random draw can be untiltable onto A's mean; redraw rather than
      // opening with two policies whose means visibly differ
      /* tilt() multiplies every weight by exp(lambda x), which can leave them
         all tiny. The bars are drawn from the raw weight, so without a rescale
         B's histogram can come out blank. normalize() divides by the sum, so
         scaling is invisible to the mean, the tail curve and Best-of-k. */
      if (pb && Math.abs(mean(pb) - mean(pa)) < 1e-6) return { a: a, b: scaleToUnit(tb) };
    }
    // deterministic fallback so the widget always opens in a valid state
    pair = PRESETS.peaked.make();
    a = scaleToUnit(pair[0]); b = scaleToUnit(pair[1]);
    return { a: a, b: scaleToUnit(tilt(b, mean(normalize(a)), null).w) };
  }

  /* Test hook: creates no global of its own, only calls one the page defines. */
  if (typeof window !== 'undefined' && typeof window.__smtTestHook === 'function') {
    window.__smtTestHook({
      X: X, L: L, DX: DX, normalize: normalize, mean: mean, surv: surv,
      bestOfK: bestOfK, jTrunc: jTrunc, jPop: jPop, tilt: tilt,
      PRESETS: PRESETS, makePair: makePair
    });
  }

  var root = document.getElementById('smt-widget');
  if (!root) return;

  /* ------------------------------------------------------------------- state */
  // k is fixed at the largest budget; the means are not locked
  var wA = [], wB = [], preset = 'random', kExp = 10;
  var painting = null;                 // { which: 'A'|'B', last: binIndex }
  var hot = { A: -1, B: -1 };
  var rafId = 0;

  function kOf() { return Math.pow(2, kExp); }

  /* ---------------------------------------------------------------- svg utils */
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name), k;
    for (k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, cls, anchor, fill) {
    var t = el('text', { x: x, y: y, 'class': cls || 'svg-label', 'text-anchor': anchor || 'middle' }, parent);
    if (fill) t.style.fill = fill;
    t.textContent = s;
    return t;
  }
  /* Mixed prose/symbol label: segments between | are set in KaTeX_Math
     italic, the rest in KaTeX_Main upright, matching the page's equations. */
  function mtext(parent, x, y, spec, cls, anchor, fill) {
    var t = el('text', { x: x, y: y, 'class': cls || 'svg-label', 'text-anchor': anchor || 'middle' }, parent);
    if (fill) t.style.fill = fill;
    spec.split('|').forEach(function (seg, i) {
      if (seg === '') return;
      var ts = el('tspan', { 'class': (i % 2) ? 'sv-math' : 'sv-text' }, t);
      ts.textContent = seg;
    });
    return t;
  }
  function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function localPt(svg, e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function d3(v) { return v.toFixed(3); }
  /* U+2212 for a real minus sign, matching the existing explorer readout. */

  /* --------------------------------------------------------------- histograms */
  var HG = { x0: 36, x1: 336, yTop: 46, yBase: 168 };
  function hx(v) { return HG.x0 + v * (HG.x1 - HG.x0); }

  function drawHist(svg, which) {
    var w = which === 'A' ? wA : wB;
    var color = which === 'A' ? CA : CB;
    var p = normalize(w), mu = p ? mean(p) : 0;
    var bw = (HG.x1 - HG.x0) / (L - 1) * 0.78, full = HG.yBase - HG.yTop, i, h, t, ts;

    clear(svg);

    /* Panel title, centred over the plot. */
    t = el('text', { x: (HG.x0 + HG.x1) / 2, y: 18, 'class': 'svg-title', 'text-anchor': 'middle' }, svg);
    t.style.fill = color;
    ts = el('tspan', { 'class': 'sv-text' }, t); ts.textContent = 'Policy ';
    ts = el('tspan', { 'class': 'sv-math' }, t); ts.textContent = '\u03c0';
    ts = el('tspan', { 'class': 'sv-math', 'font-size': '10', dy: '3' }, t); ts.textContent = which;
    ts = el('tspan', { 'class': 'sv-text', fill: MUTED, dy: '-3' }, t); ts.textContent = '   mean = ' + d3(mu);

    /* "relative mass" is the y axis, so it runs up the left edge. */
    var ymid = (HG.yTop + HG.yBase) / 2;
    ts = mtext(svg, 13, ymid, 'relative mass', 'svg-tick');
    ts.setAttribute('transform', 'rotate(-90, 13, ' + ymid + ')');

    /* Faint full-height tracks so empty bins stay visible and paintable. */
    for (i = 0; i < L; i++) {
      el('rect', { x: hx(X[i]) - bw / 2, y: HG.yTop, width: bw, height: full,
                   fill: color, opacity: 0.07 }, svg);
    }
    for (i = 0; i < L; i++) {
      h = w[i] * full;
      if (h <= 0) continue;
      el('rect', { x: hx(X[i]) - bw / 2, y: HG.yBase - h, width: bw, height: h,
                   fill: color, opacity: hot[which] === i ? 1 : 0.85 }, svg);
    }

    el('line', { x1: hx(mu), x2: hx(mu), y1: HG.yTop - 8, y2: HG.yBase,
                 stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '4,3' }, svg);

    el('line', { x1: HG.x0 - 12, x2: HG.x1 + 12, y1: HG.yBase, y2: HG.yBase,
                 stroke: INK, 'stroke-width': 1.2 }, svg);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      el('line', { x1: hx(v), x2: hx(v), y1: HG.yBase, y2: HG.yBase + 4, stroke: MUTED, 'stroke-width': 1 }, svg);
      text(svg, hx(v), HG.yBase + 17, v.toFixed(2), 'svg-tick');
    });
    mtext(svg, (HG.x0 + HG.x1) / 2, HG.yBase + 34, 'reward', 'svg-label');
  }

  /* ------------------------------------------------------------- tail curves */
  var PL = { x0: 44, x1: 344, yTop: 44, yBase: 168 };
  function plx(v) { return PL.x0 + v * (PL.x1 - PL.x0); }
  function ply(v) { return PL.yBase - v * (PL.yBase - PL.yTop); }

  function stepPath(S) {
    var d = 'M' + plx(0) + ' ' + ply(S[0]), i, next;
    for (i = 0; i < S.length; i++) {
      d += 'L' + plx(X[i + 1]) + ' ' + ply(S[i]);
      next = (i + 1 < S.length) ? S[i + 1] : 0;
      d += 'L' + plx(X[i + 1]) + ' ' + ply(next);
    }
    return d;
  }

  function drawTail(svg) {
    clear(svg);
    mtext(svg, (PL.x0 + PL.x1) / 2, 18, 'Tail probability  |p|(|τ|) = Pr(|r| > |τ|)', 'svg-title');
    [0, 0.5, 1].forEach(function (v) {
      el('line', { x1: PL.x0, x2: PL.x1, y1: ply(v), y2: ply(v), stroke: GRID, 'stroke-width': 1 }, svg);
      text(svg, PL.x0 - 7, ply(v) + 4, v.toFixed(1), 'svg-tick', 'end');
    });
    el('line', { x1: PL.x0, x2: PL.x1, y1: PL.yBase, y2: PL.yBase, stroke: INK, 'stroke-width': 1.2 }, svg);
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      el('line', { x1: plx(v), x2: plx(v), y1: PL.yBase, y2: PL.yBase + 4, stroke: MUTED, 'stroke-width': 1 }, svg);
      text(svg, plx(v), PL.yBase + 17, v.toFixed(2), 'svg-tick');
    });
    mtext(svg, (PL.x0 + PL.x1) / 2, PL.yBase + 34, 'reward threshold |τ|', 'svg-label');

    [[wB, CB], [wA, CA]].forEach(function (pair) {
      var p = normalize(pair[0]);
      if (!p) return;
      el('path', { d: stepPath(surv(p)), fill: 'none', stroke: pair[1], 'stroke-width': 2.2 }, svg);
    });
  }

  /* --------------------------------------------------------------- Best-of-k */
  var BK = { x0: 44, x1: 344, yTop: 44, yBase: 168 };
  function bkx(e2) { return BK.x0 + (e2 / 10) * (BK.x1 - BK.x0); }
  function bky(v) { return BK.yBase - v * (BK.yBase - BK.yTop); }

  function drawBok(svg) {
    var k = kOf(), e2, marks = [];
    clear(svg);
    mtext(svg, (BK.x0 + BK.x1) / 2, 18, 'Best-of-|k|', 'svg-title');
    [0, 0.5, 1].forEach(function (v) {
      el('line', { x1: BK.x0, x2: BK.x1, y1: bky(v), y2: bky(v), stroke: GRID, 'stroke-width': 1 }, svg);
      text(svg, BK.x0 - 7, bky(v) + 4, v.toFixed(1), 'svg-tick', 'end');
    });
    el('line', { x1: BK.x0, x2: BK.x1, y1: BK.yBase, y2: BK.yBase, stroke: INK, 'stroke-width': 1.2 }, svg);
    [0, 2, 4, 6, 8, 10].forEach(function (e) {
      el('line', { x1: bkx(e), x2: bkx(e), y1: BK.yBase, y2: BK.yBase + 4, stroke: MUTED, 'stroke-width': 1 }, svg);
      text(svg, bkx(e), BK.yBase + 17, String(Math.pow(2, e)), 'svg-tick');
    });
    mtext(svg, (BK.x0 + BK.x1) / 2, BK.yBase + 34, 'rollout budget |k|', 'svg-label');

    /* k is no longer a control, so there is no cursor to draw; the curves run
       the whole budget range and the endpoint dots carry the Best-of-1024
       values. */

    [[wA, CA], [wB, CB]].forEach(function (pair) {
      var p = normalize(pair[0]), d = '', v;
      if (!p) return;
      for (e2 = 0; e2 <= 10; e2++) {
        v = bestOfK(p, Math.pow(2, e2));
        d += (e2 === 0 ? 'M' : 'L') + bkx(e2) + ' ' + bky(v);
      }
      el('path', { d: d, fill: 'none', stroke: pair[1], 'stroke-width': 2.2 }, svg);
      marks.push({ v: bestOfK(p, k), c: pair[1] });
    });

    /* Push the two endpoint labels to a fixed minimum separation when the
       curves finish close together. A fixed nudge is not enough: the label box
       is about 15 user units tall, so the gap has to be set, not incremented. */
    if (marks.length === 2) {
      var y0 = bky(marks[0].v), y1 = bky(marks[1].v);
      var gap = Math.abs(y0 - y1), MIN = 17, push;
      if (gap < MIN) {
        push = (MIN - gap) / 2;
        marks[0].dy = (y0 <= y1) ? -push : push;
        marks[1].dy = (y0 <= y1) ? push : -push;
      }
    }
    marks.forEach(function (m) {
      var lbl;
      el('circle', { cx: bkx(kExp), cy: bky(m.v), r: 4, fill: m.c }, svg);
      lbl = text(svg, bkx(kExp) - 8, bky(m.v) + 4 + (m.dy || 0), d3(m.v), 'svg-tick', 'end', m.c);
      // halo, so the value stays readable where it overlaps the curve
      lbl.setAttribute('stroke', '#fff');
      lbl.setAttribute('stroke-width', '3');
      lbl.setAttribute('paint-order', 'stroke');
      lbl.setAttribute('font-weight', '600');
    });
  }

  /* ------------------------------------------------------------------ render */
  function paint() {
    drawHist(document.getElementById('smt-hist-a'), 'A');
    drawHist(document.getElementById('smt-hist-b'), 'B');
    drawTail(document.getElementById('smt-tail'));
    drawBok(document.getElementById('smt-bok'));
  }
  function render() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; paint(); });
  }

  /* --------------------------------------------------------------- painting */
  function binAt(svg, e) {
    var q = localPt(svg, e);
    var i = Math.round((q.x - HG.x0) / (HG.x1 - HG.x0) * (L - 1));
    return { i: Math.min(L - 1, Math.max(0, i)), y: q.y };
  }

  function applyPaint(which, svg, e) {
    var b = binAt(svg, e), w = which === 'A' ? wA : wB;
    var v = 1 - (b.y - HG.yTop) / (HG.yBase - HG.yTop);
    var old = w[b.i];
    w[b.i] = Math.min(1, Math.max(0, v));
    if (!(total(w) > 0)) w[b.i] = old;    // never leave a policy with no mass
    painting.last = b.i;
    hot[which] = b.i;
  }

  function endPaint() {
    if (!painting) return;
    painting = null;
    /* No mean lock: a preset still opens as a fair same-mean pair, but once
       the reader starts dragging the two means are free to separate. */
    render();
  }

  function wireHist(svg, which) {
    svg.addEventListener('pointerdown', function (e) {
      painting = { which: which, last: -1 };
      if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (err) {} }
      applyPaint(which, svg, e);
      render();
      e.preventDefault();
    });
    svg.addEventListener('pointermove', function (e) {
      if (painting && painting.which === which) { applyPaint(which, svg, e); render(); return; }
      if (painting) return;
      var b = binAt(svg, e);
      if (hot[which] !== b.i) { hot[which] = b.i; render(); }
    });
    svg.addEventListener('pointerup', endPaint);
    svg.addEventListener('pointercancel', endPaint);
    svg.addEventListener('pointerleave', function () {
      if (!painting && hot[which] !== -1) { hot[which] = -1; render(); }
    });
  }

  /* --------------------------------------------------------------- controls */
  function loadPreset(key) {
    var pair = makePair(key);
    preset = key; wA = pair.a; wB = pair.b;
    hot.A = -1; hot.B = -1;
  }

  var pBox = document.getElementById('smt-presets');
  Object.keys(PRESETS).forEach(function (key) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = PRESETS[key].label;
    if (key === preset) b.classList.add('active');
    b.addEventListener('click', function () {
      loadPreset(key);
      pBox.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
      render();
    });
    pBox.appendChild(b);
  });

  var resetBtn = document.getElementById('smt-reset');
  if (resetBtn) resetBtn.addEventListener('click', function () {
    painting = null;
    loadPreset('random');
    pBox.querySelectorAll('button').forEach(function (x, i) { x.classList.toggle('active', i === 0); });
    paint();
    resetBtn.blur();
  });

  wireHist(document.getElementById('smt-hist-a'), 'A');
  wireHist(document.getElementById('smt-hist-b'), 'B');
  window.addEventListener('pointerup', endPaint);

  loadPreset(preset);
  paint();
})();
