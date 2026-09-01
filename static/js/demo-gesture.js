/* ===========================================================================
   "This is interactive" hint.

   A widget that responds to dragging looks exactly like a static chart until
   someone tries. The first time one scrolls into view, a pointer glyph slides
   across it and performs a real drag, so the reader sees the thing move and
   knows it will move for them.

   The gesture drives the widget through ordinary pointer events rather than
   faking an animation, so what the reader watches is the widget actually
   working. It runs once per widget per page load, never repeats, and gets out
   of the way the moment a real pointer, key, wheel or touch arrives.

   Vanilla ES5, no dependencies, no globals.
   ========================================================================= */
(function () {
  'use strict';

  if (!('IntersectionObserver' in window) || !window.PointerEvent) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* Each entry names the surface to demonstrate on, and where to drag in that
     surface's own viewBox units, which keeps the path independent of how wide
     the widget happens to render. */
  var DEMOS = [
    { sel: '#ex-svg-rewards', vb: [760, 300],
      from: [250, 190], to: [520, 140], via: [385, 58] },
    { sel: '#smt-hist-a', vb: [360, 220],
      from: [150, 120], to: [250, 70], via: [200, 86] }
  ];

  var CURSOR_SVG =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
    '<path d="M5 2 L5 19 L9.2 15.1 L12 21.5 L15 20.1 L12.2 13.9 L18 13.6 Z"' +
    ' fill="#1f2937" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function ptOf(svg, vb, p) {
    var r = svg.getBoundingClientRect();
    return { x: r.left + (p[0] / vb[0]) * r.width, y: r.top + (p[1] / vb[1]) * r.height };
  }
  /* The gesture's own events bubble to the window listener that watches for a
     real pointer, which would make it cancel itself on its first frame. The
     flag marks the dispatch so that listener can tell the two apart. */
  var synthetic = false;
  function send(svg, type, x, y, buttons) {
    synthetic = true;
    svg.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerId: 9901, pointerType: 'mouse', isPrimary: true, buttons: buttons || 0
    }));
    synthetic = false;
  }
  // quadratic Bezier, so the path arcs rather than sliding in a straight line
  function bez(a, c, b, t) {
    var u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
            u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function run(demo) {
    var svg = document.querySelector(demo.sel);
    if (!svg) return;

    var cur = document.createElement('div');
    cur.className = 'demo-cursor';
    cur.innerHTML = CURSOR_SVG;
    document.body.appendChild(cur);

    var cancelled = false;
    function cleanup() {
      cancelled = true;
      // release the widget wherever the gesture had got to
      try { send(svg, 'pointerup', last.x, last.y, 0); } catch (e) {}
      if (cur.parentNode) cur.parentNode.removeChild(cur);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    }

    /* What counts as the reader taking over. Scrolling does not: they are
       still reading, and cancelling on wheel meant the gesture died the moment
       anyone nudged the page after it began. Nor does a press somewhere else
       on the page, which on a touch device is simply how scrolling starts.
       A press on this widget does, and so does Escape. */
    function onPointer(e) { if (!synthetic && svg.contains(e.target)) cleanup(); }
    function onKey(e) { if (e.key === 'Escape') cleanup(); }
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);

    var start = ptOf(svg, demo.vb, demo.from), last = start;
    cur.style.transform = 'translate(' + start.x + 'px,' + start.y + 'px)';
    cur.classList.add('is-in');

    var DUR = 1500, t0 = 0, pressed = false;
    function frame(ts) {
      if (cancelled) return;
      if (!t0) { t0 = ts; }
      var t = Math.min(1, (ts - t0) / DUR);
      var p = bez(demo.from, demo.via, demo.to, ease(t));
      var c = ptOf(svg, demo.vb, p);
      last = c;
      cur.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px)';
      if (!pressed) {
        pressed = true;
        cur.classList.add('is-down');
        send(svg, 'pointerdown', c.x, c.y, 1);
      } else {
        send(svg, 'pointermove', c.x, c.y, 1);
      }
      if (t < 1) { requestAnimationFrame(frame); return; }
      send(svg, 'pointerup', c.x, c.y, 0);
      cur.classList.remove('is-down');
      cur.classList.add('is-out');
      setTimeout(function () { if (!cancelled) cleanup(); }, 420);
    }
    // a beat after it settles in view, so the reader is looking at it
    setTimeout(function () { if (!cancelled) requestAnimationFrame(frame); }, 380);
  }

  /* Trigger on the reader arriving, not on the page existing.

     An IntersectionObserver alone fires as soon as the element is visible,
     which includes the moment of load: a refresh restores the previous scroll
     position, so a widget the reader was already looking at would perform its
     gesture before they had done anything. The same applies to following a
     deep link.

     So the gesture waits for a scroll that the reader actually made, and then
     for that scroll to stop, with the widget settled near the middle of the
     viewport. */
  var pending = DEMOS.filter(function (d) { return !!document.querySelector(d.sel); });
  if (!pending.length) return;

  function settledInView(demo) {
    var svg = document.querySelector(demo.sel);
    if (!svg) return false;
    var r = svg.getBoundingClientRect(), vh = window.innerHeight;
    if (r.height === 0) return false;
    var visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (visible / r.height < 0.6) return false;
    var mid = (r.top + r.bottom) / 2;              // near the middle of the screen
    return mid > vh * 0.15 && mid < vh * 0.85;
  }

  /* Arming, so the gesture answers the reader arriving rather than the page
     loading. A reload restores the previous scroll position, which raises a
     scroll event indistinguishable from a real one; comparing against the
     offset at load does not settle it either, because whether that snapshot
     is taken before or after restoration is a race.

     Real input cannot come from restoration, so that is what arms it. A
     scroll on its own arms it too, but only once the restoration window has
     passed. */
  var armed = false, loadedAt = +new Date(), idle = 0;
  var INPUT = ['wheel', 'keydown', 'pointerdown', 'touchstart'];

  function check() {
    pending = pending.filter(function (demo) {
      if (!settledInView(demo)) return true;
      run(demo);
      return false;
    });
    if (!pending.length) {
      window.removeEventListener('scroll', onScroll);
      INPUT.forEach(function (t) { window.removeEventListener(t, arm, true); });
    }
  }
  function schedule() { clearTimeout(idle); idle = setTimeout(check, 220); }
  function arm() { armed = true; schedule(); }
  function onScroll() {
    if (!armed) {
      if (+new Date() - loadedAt < 1200) return;   // still the restoration window
      armed = true;
    }
    schedule();
  }
  INPUT.forEach(function (t) { window.addEventListener(t, arm, true); });
  window.addEventListener('scroll', onScroll, { passive: true });
})();
