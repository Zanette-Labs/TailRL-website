/* ===========================================================================
   Presentation mode (opt-in slides) for the TailRL blog.

   Slides are authored in the markup rather than guessed from heights, so
   every slide carries a complete thought:

     - every <section> is one slide by default;
     - inside a section, a child carrying data-slide starts a new slide;
     - inside a .result-card, a child carrying data-slide splits the card,
       and each part gets a copy of the card's shell so it still reads as a
       card. The first part can share a slide with whatever precedes the
       card (the Results heading rides with the ImageNet set-up); a card that
       itself carries data-slide starts a fresh one;
     - a section carrying data-slide-join is folded into the slide before it,
       which is how the BibTeX and the closing links end on one slide.

   A slide taller than the viewport is scaled down to fit, never clipped.

   OFF BY DEFAULT. Ordinary scrolling, find-in-page, anchors and trackpad
   behaviour are untouched unless the reader opts in, by the toggle or by
   arriving on blog.html?present (the landing page's Presentation link).
   Switching it off undoes every wrapper and split, so the blog is exactly as
   it was, and keeps the reader on the passage they were looking at.

   Vanilla ES5, no dependencies, no globals.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = {
    duration:       680,   // ms per slide transition
    wheelThreshold:  28,   // accumulated |deltaY| before a slide advances
    quietMs:        150,   // trackpad momentum must be quiet this long to unlock
    pad:             40,   // px of breathing room above and below a slide
    minScale:      0.5,    // never shrink a slide past this to make it fit
    // index.css switches to the phone layout at max-width: 768px, which also
    // hides the toggle; the mode must never be on where its exit is hidden
    minWidth:       769
  };
  var SLIDE = 'data-slide', JOIN = 'data-slide-join', CLONE = 'data-sj-clone';
  var STORE_KEY = 'tailrl-slide:' + location.pathname;

  var docEl = document.documentElement;
  var cards = [], index = 0, undo = [], built = false, building = false;
  var animating = false, locked = false, rafId = 0, quietTimer = 0, acc = 0;

  function maxScroll() { return Math.max(0, docEl.scrollHeight - window.innerHeight); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function kids(el) { return [].slice.call(el.children); }

  /* ------------------------------------------------------------ slide building */

  /* Lazy images have no height until they load, so scaling a slide before
     that would size it wrongly. Force them in and wait. */
  function loadImages() {
    [].slice.call(document.querySelectorAll('img[loading="lazy"]')).forEach(function (im) {
      im.setAttribute('loading', 'eager');
    });
    var imgs = [].slice.call(document.images).filter(function (im) { return !im.complete; });
    if (!imgs.length) return Promise.resolve();
    return Promise.all(imgs.map(function (im) {
      return new Promise(function (res) {
        if (im.complete) return res();
        im.addEventListener('load', res); im.addEventListener('error', res);
        setTimeout(res, 4000);
      });
    }));
  }

  // the element whose children are the section's blocks
  function hostOf(sec) {
    return sec.querySelector(':scope > .hero-body > .container') ||
           sec.querySelector(':scope > .container') || sec;
  }

  function shown(el) { return getComputedStyle(el).display !== 'none'; }

  function wrapCard(nodes, before) {
    var parent = before.parentNode;
    var card = document.createElement('div');
    card.className = 'sj-card';
    var inner = document.createElement('div');
    inner.className = 'sj-card-inner';
    card.appendChild(inner);
    parent.insertBefore(card, before);
    nodes.forEach(function (n) { inner.appendChild(n); });
    undo.push(function () {
      while (inner.firstChild) parent.insertBefore(inner.firstChild, card);
      parent.removeChild(card);
    });
    return card;
  }

  /* Split a result card at its data-slide children. Each part is a shell copy
     of the card; the first takes the card's id and its own data-slide, so
     anchors keep working and the card's opening rule still applies. */
  function splitCard(card) {
    var parts = [], cur = [];
    kids(card).forEach(function (k) {
      if (k.hasAttribute(SLIDE) && cur.length) { parts.push(cur); cur = []; }
      cur.push(k);
    });
    if (cur.length) parts.push(cur);
    if (parts.length < 2) return;

    var parent = card.parentNode, clones = [];
    var id = card.id;
    if (id) card.removeAttribute('id');          // never two elements with one id
    parts.forEach(function (part, i) {
      var c = document.createElement(card.tagName);
      c.className = card.className;
      if (card.getAttribute('style')) c.setAttribute('style', card.getAttribute('style'));
      c.setAttribute(CLONE, '');
      if (i === 0) {
        if (id) c.id = id;
        if (card.hasAttribute(SLIDE)) c.setAttribute(SLIDE, '');
      } else c.setAttribute(SLIDE, '');
      parent.insertBefore(c, card);
      part.forEach(function (n) { c.appendChild(n); });
      clones.push(c);
    });
    parent.removeChild(card);
    undo.push(function () {
      parent.insertBefore(card, clones[0]);
      clones.forEach(function (c) {
        while (c.firstChild) card.appendChild(c.firstChild);
        parent.removeChild(c);
      });
      if (id) card.id = id;
    });
  }

  function buildSection(sec) {
    var host = hostOf(sec);
    kids(host).forEach(function (k) {
      if (k.classList.contains('result-card') && k.querySelector(':scope > [' + SLIDE + ']')) splitCard(k);
    });
    var groups = [], cur = [];
    kids(host).forEach(function (k) {
      if (k.hasAttribute(SLIDE) && cur.length) { groups.push(cur); cur = []; }
      cur.push(k);
    });
    if (cur.length) groups.push(cur);
    groups.forEach(function (g) {
      var card = wrapCard(g, g[0]);
      // an experiment is one slide, set wide so its blocks fit side by side
      if (g.some(function (n) { return n.classList.contains('result-card'); })) card.classList.add('sj-wide');
    });
  }

  function buildCards() {
    if (built) return;
    undo = [];
    var secs = [].slice.call(document.querySelectorAll('section, footer.footer')).filter(shown);
    var i = 0, run;
    while (i < secs.length) {
      // a section followed by joiners that share its parent becomes one slide
      run = [secs[i]];
      while (i + run.length < secs.length && secs[i + run.length].hasAttribute(JOIN) &&
             secs[i + run.length].parentNode === secs[i].parentNode) run.push(secs[i + run.length]);
      if (run.length > 1) wrapCard(run, run[0]);
      else buildSection(secs[i]);
      i += run.length;
    }
    cards = [].slice.call(document.querySelectorAll('.sj-card'));
    built = true;
  }

  function unbuildCards() {
    if (!built) return;
    while (undo.length) undo.pop()();
    cards = []; built = false;
  }

  /* Scale any slide whose content still overflows the real viewport. */
  function layout() {
    var avail = window.innerHeight - 2 * CFG.pad;
    cards.forEach(function (card) {
      var inner = card.firstChild;
      var ih = inner.scrollHeight;          // layout height, unaffected by transform
      var s = ih > avail ? Math.max(CFG.minScale, avail / ih) : 1;
      inner.style.setProperty('--sj-scale', String(s));
    });
  }

  function targetFor(i) {
    var r = cards[i].getBoundingClientRect();
    return Math.max(0, Math.min(maxScroll(), r.top + window.scrollY));
  }

  function nearestIndex() {
    var y = window.scrollY, best = 0, bd = Infinity;
    for (var i = 0; i < cards.length; i++) {
      var d = Math.abs(targetFor(i) - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // the slide holding an element, or the first slide inside it
  function cardOf(el) {
    if (!el || !cards.length) return -1;
    var c = el.closest ? el.closest('.sj-card') : null;
    if (!c && el.querySelector) c = el.querySelector('.sj-card');
    return c ? cards.indexOf(c) : -1;
  }

  /* The block the reader is looking at: the first content block that has not
     scrolled up under the top of the viewport. Leaves only, never a result
     card's shell, because a shell may be replaced by its parts. */
  var BLOCKS = 'h1, h2, h3, h4, p, figure, .explorer, .math-comparison, .formula-box, ' +
               '.takeaway-box, .eyebrow, .bibtex-box, .btn-row, .publication-authors, iframe';
  function readingAnchor() {
    var nav = document.querySelector('.pagenav');
    var top = nav && shown(nav) ? nav.getBoundingClientRect().height : 0;
    var all = document.querySelectorAll(BLOCKS);
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.height > 0 && r.bottom > top + 8) return all[i];
    }
    return null;
  }

  /* ------------------------------------------------------------------- rail
     One dot per section heading; the dot for the slide's section is lit. */
  var rail = document.createElement('nav');
  rail.className = 'sj-rail';
  rail.setAttribute('aria-label', 'Slides');
  var railItems = [];          // { btn, card }

  function buildRail() {
    while (rail.firstChild) rail.removeChild(rail.firstChild);
    railItems = [];
    cards.forEach(function (card, i) {
      var h = card.querySelector('h2.section-title');
      var label = h ? h.textContent.trim() : (card.closest('.hero') ? 'Title' : '');
      if (!label) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Go to ' + label);
      var t = document.createElement('span');
      t.className = 'sj-rail-label';
      t.setAttribute('aria-hidden', 'true');
      t.textContent = label;
      b.appendChild(t);
      b.addEventListener('click', function () { goTo(i); });
      rail.appendChild(b);
      railItems.push({ btn: b, card: i });
    });
  }

  function markActive() {
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('is-active', i === index);
    var cur = -1;
    railItems.forEach(function (it, k) { if (it.card <= index) cur = k; });
    railItems.forEach(function (it, k) {
      it.btn.classList.toggle('active', k === cur);
      if (k === cur) it.btn.setAttribute('aria-current', 'step');
      else it.btn.removeAttribute('aria-current');
    });
  }

  /* -------------------------------------------------------------- animation */
  function animateTo(y, done) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    var start = window.scrollY, dist = y - start, t0 = null;
    if (Math.abs(dist) < 1) { animating = false; done && done(); return; }
    animating = true;
    rafId = requestAnimationFrame(function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / CFG.duration);
      window.scrollTo(0, start + dist * easeInOutCubic(p));
      if (p < 1) rafId = requestAnimationFrame(frame);
      else { rafId = 0; animating = false; done && done(); }
    });
  }

  function unlockWhenQuiet() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () {
      if (!animating) { locked = false; acc = 0; } else unlockWhenQuiet();
    }, CFG.quietMs);
  }

  function goTo(i) {
    if (!cards.length) return;
    index = Math.max(0, Math.min(cards.length - 1, i));
    locked = true;
    markActive();
    try { sessionStorage.setItem(STORE_KEY, String(index)); } catch (e) {}
    animateTo(targetFor(index), unlockWhenQuiet);
  }
  function stepBy(d) { goTo(index + d); }

  /* ------------------------------------------------------------ enable/disable */
  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sj-toggle';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var enabled = false;
  function allowed() { return !reduced && !coarse && window.innerWidth >= CFG.minWidth; }
  function stored() { try { return localStorage.getItem('tailrl-snap-scroll'); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem('tailrl-snap-scroll', v); } catch (e) {} }

  function label() {
    toggle.textContent = building ? 'Presentation mode: preparing…'
      : enabled ? 'Presentation mode: on' : 'Presentation mode';
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  /* start(): which slide to open on, asked once the slides exist. */
  function setEnabled(on, start) {
    on = !!on && allowed();
    if (on === enabled) return;
    if (on) {
      enabled = true;
      document.body.classList.add('sj-on');
      label();
      buildOnce(function () {
        // the reader may have switched it off again while slides were built
        if (!enabled) return;
        layout(); buildRail();
        var i = start ? start() : -1;
        index = i >= 0 ? i : nearestIndex();
        markActive();
        // land on the slide at once; the animation is for moving between them
        window.scrollTo(0, targetFor(index));
        try { sessionStorage.setItem(STORE_KEY, String(index)); } catch (e) {}
      });
    } else {
      // remember the passage on screen, by an element that survives unbuilding
      var anchor = null;
      if (cards[index]) {
        anchor = cards[index].firstChild.firstElementChild;
        if (anchor && anchor.hasAttribute(CLONE)) anchor = anchor.firstElementChild;
      }
      enabled = false;
      locked = false; acc = 0;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      animating = false;
      unbuildCards();
      document.body.classList.remove('sj-on');
      railItems = [];
      while (rail.firstChild) rail.removeChild(rail.firstChild);
      label();
      if (anchor) {
        var nav = document.querySelector('.pagenav');
        var off = nav && shown(nav) ? nav.getBoundingClientRect().height + 12 : 12;
        window.scrollTo(0, anchor.getBoundingClientRect().top + window.scrollY - off);
      }
    }
  }

  function requested() { return /(^|[?&])present(=|&|$)/.test(location.search.slice(1)); }

  /* Switching off by hand (the toggle or Escape) also drops the ?present
     request, so a reload does not put the reader straight back into the
     mode they just left. */
  function switchOff() {
    setEnabled(false);
    store('off');
    if (requested() && window.history && history.replaceState) {
      var q = location.search.slice(1).split('&').filter(function (p) {
        return p && p.split('=')[0] !== 'present';
      }).join('&');
      history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
  }

  toggle.addEventListener('click', function () {
    if (enabled) { switchOff(); return; }
    var anchor = readingAnchor();
    setEnabled(true, function () { return cardOf(anchor); });
    store(enabled ? 'on' : 'off');
  });

  /* Slides are built on each opt-in and undone on opt-out. Images must be
     loaded first or a figure's slide would be sized from a zero-height image. */
  function buildOnce(then) {
    if (built) { requestAnimationFrame(then); return; }
    if (building) return;
    building = true;
    label();
    loadImages().then(function () {
      building = false;
      if (enabled) buildCards();
      label();
      if (enabled) requestAnimationFrame(then);
    });
  }

  /* ------------------------------------------------------------------ input */
  function inScrollable(node) {
    while (node && node !== document.body && node.nodeType === 1) {
      var st = getComputedStyle(node);
      if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 1) return true;
      node = node.parentNode;
    }
    return false;
  }

  window.addEventListener('wheel', function (e) {
    if (!enabled || !cards.length) return;
    if (e.ctrlKey || e.metaKey) return;          // browser zoom and trackpad pinch
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (inScrollable(e.target)) return;
    e.preventDefault();
    if (locked) { unlockWhenQuiet(); return; }
    acc += e.deltaY;
    if (Math.abs(acc) >= CFG.wheelThreshold) { var d = acc > 0 ? 1 : -1; acc = 0; stepBy(d); }
  }, { passive: false });

  /* Space presses a focused button rather than turning the slide, but only
     under keyboard focus: a preset clicked with the mouse keeps focus, and the
     presenter's next Space should still advance. */
  function spaceBelongsTo(t) {
    if (!t || !t.closest || !t.closest('button, summary, [role=button]')) return false;
    try { return t.matches(':focus-visible'); } catch (e) { return true; }
  }

  window.addEventListener('keydown', function (e) {
    if (!enabled || !cards.length) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && spaceBelongsTo(t)) return;
    var d = 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) d = 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) d = -1;
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); return; }
    else if (e.key === 'End') { e.preventDefault(); goTo(cards.length - 1); return; }
    else if (e.key === 'Escape') { switchOff(); return; }
    else return;
    e.preventDefault();
    if (!locked) stepBy(d);
  });

  document.addEventListener('click', function (e) {
    if (!enabled || !cards.length) return;
    var a = e.target;
    while (a && a.tagName !== 'A') a = a.parentNode;
    if (!a || !a.getAttribute) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#' || href.length < 2) return;
    var i = cardOf(document.getElementById(href.slice(1)));
    if (i < 0) return;
    e.preventDefault();
    goTo(i);
  });

  // Tab onto a control on another slide: bring that whole slide in
  document.addEventListener('focusin', function (e) {
    if (!enabled || !cards.length) return;
    var i = cardOf(e.target);
    if (i >= 0 && i !== index) goTo(i);
  });

  var scrollRaf = 0;
  window.addEventListener('scroll', function () {
    if (!enabled || !cards.length || animating || locked || scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0; index = nearestIndex(); markActive();
    });
  }, { passive: true });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (enabled && !allowed()) { setEnabled(false); return; }
      if (enabled && cards.length) { layout(); window.scrollTo(0, targetFor(index)); }
    }, 180);
  });

  window.addEventListener('message', function (e) {
    if (e.data && typeof e.data.tailrlCodeHeight === 'number' && enabled && cards.length) setTimeout(layout, 80);
  });

  /* The landing page's Presentation link (blog.html?present) is an explicit
     opt-in, the same as clicking the toggle, so it is honoured on load. It
     opens on the slide holding the #hash if there is one, else on the slide
     this tab was last on (a reload), else on the title. */
  function bootStart() {
    var h = location.hash.slice(1);
    if (h) { var i = cardOf(document.getElementById(h)); if (i >= 0) return i; }
    try {
      var s = parseInt(sessionStorage.getItem(STORE_KEY), 10);
      if (s >= 0 && s < cards.length) return s;
    } catch (e) {}
    return 0;
  }

  /* Slide sizes are measured from rendered heights, so wait for images, the
     code iframe and the webfonts to land first. */
  function whenSettled(fn) {
    function fonts() {
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fn, fn);
      else fn();
    }
    if (document.readyState === 'complete') fonts();
    else window.addEventListener('load', fonts);
  }

  function boot() {
    document.body.appendChild(rail);
    document.body.appendChild(toggle);
    if (!allowed()) { toggle.style.display = 'none'; return; }
    toggle.setAttribute('title', 'Step through the blog one slide at a time');
    label();
    // deliberately not restoring a stored "on": the page always opens in
    // ordinary scrolling, and only an explicit request turns the mode on
    if (stored() === 'on') store('off');
    if (requested()) {
      // the browser's own scroll restoration would race the slide we pick
      try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
      whenSettled(function () { if (!enabled) setEnabled(true, bootStart); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
