/* ===========================================================================
   Page-wide behavior: sticky section nav, BibTeX copy, reduced-motion image
   swap, code-iframe sizing, and keyboard safety for not-yet-live links.

   Vanilla ES5, no dependencies, no globals. Everything here is progressive
   enhancement: with JavaScript off the page still reads, the figures still
   show, and the disclosures still open.
   ========================================================================= */
(function () {
  'use strict';

  /* ---- reduced motion: swap animated GIFs for their static frame --------- */
  var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq && mq.matches) {
    [].slice.call(document.querySelectorAll('img[data-static]')).forEach(function (img) {
      img.src = img.getAttribute('data-static');
    });
  }

  /* ---- code.html reports its rendered height so the iframe can fit it ---- */
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data.tailrlCodeHeight !== 'number') return;
    var frame = document.getElementById('tailrl-code-frame');
    if (frame) frame.style.height = e.data.tailrlCodeHeight + 'px';
  });

  /* ---- figures that start on first sight ---------------------------------
     The reshape teaser carries no Netscape loop block, so once it starts it
     runs through once and holds its final frame. What we control is when it
     starts: swapping src at the moment the figure comes into view means the
     reader sees it from frame one instead of arriving after it has finished.
     A blank 1x1 holds the reserved box until then. */
  (function () {
    var figs = [].slice.call(document.querySelectorAll('img[data-play-in-view]'));
    if (!figs.length) return;

    var still = function (el) {
      var s = el.getAttribute('data-static');
      if (s) el.src = s;
    };
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      figs.forEach(still);
      return;
    }

    /* Warm the cache a screen early so playback is not waiting on the network.
       fetch rather than `new Image()`: both leave the animation to start when
       the <img> is swapped in (checked, the rendered frames are identical
       either way), but fetch fills the HTTP cache without also decoding a
       663-line bitmap that nothing is going to paint. */
    var warm = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var url = e.target.getAttribute('data-play-in-view');
        if (window.fetch) fetch(url, { cache: 'force-cache' }).catch(function () {});
        warm.unobserve(e.target);
      });
    }, { rootMargin: '900px 0px' });

    // and start it only once a quarter of the figure is actually on screen
    var start = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.src = e.target.getAttribute('data-play-in-view');
        e.target.setAttribute('data-played', '1');
        start.unobserve(e.target);
      });
    }, { threshold: 0.25 });

    figs.forEach(function (el) { warm.observe(el); start.observe(el); });
  })();

  /* ---- sticky nav: highlight the section currently in view --------------- */
  var links = [].slice.call(document.querySelectorAll('.pagenav .links a'));
  var targets = links.map(function (a) { return document.querySelector(a.getAttribute('href')); });
  if (links.length && 'IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { seen[en.target.id] = en.isIntersecting ? en.intersectionRatio : 0; });
      var bestId = null, best = 0;
      targets.forEach(function (t) {
        if (t && (seen[t.id] || 0) > best) { best = seen[t.id]; bestId = t.id; }
      });
      links.forEach(function (a) {
        a.classList.toggle('current', bestId !== null && a.getAttribute('href') === '#' + bestId);
      });
    }, { rootMargin: '-64px 0px -55% 0px', threshold: [0, 0.15, 0.5, 1] });
    targets.forEach(function (t) { if (t) io.observe(t); });
  }

  var jump = document.getElementById('pagenav-jump');
  if (jump) {
    jump.addEventListener('change', function () {
      if (!jump.value) return;
      var el = document.querySelector(jump.value);
      if (el) el.scrollIntoView({ behavior: mq && mq.matches ? 'auto' : 'smooth', block: 'start' });
      jump.value = '';
    });
  }

  /* ---- copy BibTeX -------------------------------------------------------
     Every button carrying data-target copies that element's text, so the hero
     and the closing band share one implementation. Each names its own status
     element, since two buttons writing to one would clobber each other. */
  [].slice.call(document.querySelectorAll('[data-target]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = document.getElementById(btn.getAttribute('data-target'));
      if (!src) return;
      var status = document.getElementById(btn.getAttribute('data-status') || '');
      function done(ok) {
        if (!status) return;
        status.textContent = ok ? 'Copied to clipboard' : 'Press Ctrl/Cmd+C to copy';
        setTimeout(function () { status.textContent = ''; }, 3000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(src.textContent).then(
          function () { done(true); },
          function () { selectFallback(src); done(false); });
      } else { selectFallback(src); done(false); }
    });
  });

  function selectFallback(node) {
    try {
      var r = document.createRange(); r.selectNodeContents(node);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch (e) {}
  }

  /* ---- links that are not live yet ---------------------------------------
     CSS already removes pointer events; this also keeps them out of the tab
     order and stops Enter/Space from doing nothing confusing.               */
  [].slice.call(document.querySelectorAll('[aria-disabled="true"]')).forEach(function (el) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
    });
  });
})();
