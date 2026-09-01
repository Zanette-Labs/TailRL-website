/* ===========================================================================
   Presentation mode (opt-in card snap-scroll) for the TailRL project page.

   The page is partitioned into cards at load time: runs of content blocks are
   packed into groups that fit a fixed design budget, each group is wrapped in
   a full-viewport card, and one wheel gesture animates from card to card.
   Cards whose content still overflows the real viewport are scaled to fit, so
   a card never bleeds into its neighbour.

   OFF BY DEFAULT. Ordinary browser scrolling, find-in-page, anchors and
   trackpad behavior are untouched unless the reader opts in. The card wrappers
   are not even built until the first time the mode is switched on, so the
   default page pays nothing for this file.

   Vanilla ES5, no dependencies, no globals.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = {
    budget:         720,   // px of content a card is designed to hold
    duration:       680,   // ms per card transition
    wheelThreshold:  28,   // accumulated |deltaY| before a card advances
    quietMs:        150,   // trackpad momentum must be quiet this long to unlock
    pad:             40,   // px of breathing room inside a card
    minScale:      0.62,   // never shrink content past this to make it fit
    minWidth:       768
  };

  // elements that always begin a fresh card
  /* .bibtex-box is not listed: it is the only thing in its section, so
     breaking before it would strand the heading on a card of its own. */
  var BREAK_BEFORE = '.result-card, .explorer, h2.section-title, .conclusion-box';
  // containers safe to split into several cards, each keeping its own shell
  var SPLITTABLE = 'result-card';
  // blocks that must stay whole even when they exceed the budget -- taking a
  // widget apart would strand its readout on a card of its own
  var ATOMIC = '.explorer, .figure-container, .math-comparison, .comparison-table-wrapper,' +
               '.bibtex-box, .insight-box, .takeaway-box, .formula-box, .algorithm-box, table, iframe';
  // a section heading always gets a card to itself, as a chapter divider
  /* A section heading used to get a card to itself, which read as a title
     slide followed by an unlabelled one. It now starts a card and travels with
     as much of its section as the budget holds, so the heading and its content
     arrive together. BREAK_BEFORE still forces the new card at the heading. */
  var SOLO = null;

  var docEl = document.documentElement;
  var cards = [], sections = [], index = 0;
  var animating = false, locked = false, rafId = 0, quietTimer = 0, acc = 0, built = false;

  function maxScroll() { return Math.max(0, docEl.scrollHeight - window.innerHeight); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function h(el) { return el.getBoundingClientRect().height; }

  /* ------------------------------------------------------------ card building */

  /* Lazy images have no height until they load, so packing before that would
     size every figure card wrongly. Force them in and wait. */
  function loadImages() {
    var imgs = [].slice.call(document.images).filter(function (im) { return !im.complete; });
    [].slice.call(document.querySelectorAll('img[loading="lazy"]')).forEach(function (im) {
      im.setAttribute('loading', 'eager');
    });
    if (!imgs.length) return Promise.resolve();
    return Promise.all(imgs.map(function (im) {
      return new Promise(function (res) {
        if (im.complete) return res();
        im.addEventListener('load', res); im.addEventListener('error', res);
        setTimeout(res, 4000);
      });
    }));
  }

  // walk past single-child wrappers to the element that actually holds the flow
  function hostOf(sec) {
    var el = sec;
    while (el.children.length === 1 && el.children[0].children.length > 0) el = el.children[0];
    return el;
  }

  /* Reference material that rides along with its card instead of being packed:
     hidden in presentation mode, but still moved into a card. A block dropped
     here is not merely skipped, it is destroyed, because the split path removes
     the original shell once its children have been handed to the clones. */
  var CARRY = 'details.deep';

  function visibleKids(el) {
    return [].slice.call(el.children).filter(function (c) {
      if (c.matches && c.matches(CARRY)) return true;
      var st = getComputedStyle(c);
      return st.display !== 'none' && st.position !== 'fixed' && h(c) > 4;
    });
  }

  /* An oversized block that is only a layout wrapper (.content, .container)
     is replaced by its children; a block with its own visual identity
     (.result-card) is kept whole and split separately. */
  function flowBlocks(host) {
    var out = [];
    visibleKids(host).forEach(function (k) {
      if (h(k) > CFG.budget && k.children.length &&
          !(k.matches && k.matches(ATOMIC)) && !k.classList.contains(SPLITTABLE)) {
        out = out.concat(flowBlocks(k));
      } else out.push(k);
    });
    return out;
  }

  /* Pack blocks into groups that fit the budget. A group never spans two
     parents, so the card wrapper always has a single insertion point. */
  function pack(kids) {
    var groups = [], cur = [], sum = 0;
    function flush() { if (cur.length) { groups.push(cur); cur = []; sum = 0; } }
    kids.forEach(function (k) {
      // a carried block never opens a card of its own and never costs budget,
      // else a collapsed disclosure lands on a slide showing nothing
      if (k.matches && k.matches(CARRY)) {
        if (!cur.length || k.parentNode !== cur[0].parentNode) flush();
        cur.push(k);
        return;
      }
      /* A research question opens a block, so it starts a slide rather than
         trailing at the foot of the previous one. The exception is a question
         sitting straight under the experiment name, where the two are one
         heading and must not be split. */
      var kh = h(k);
      if (k.matches && k.matches('.eyebrow')) {
        var prev = null, j;
        for (j = cur.length - 1; j >= 0; j--) {
          if (!(cur[j].matches && cur[j].matches(CARRY))) { prev = cur[j]; break; }
        }
        if (!prev || prev.tagName !== 'H4') flush();
      }
      else if (k.matches && k.matches(BREAK_BEFORE)) flush();
      else if (cur.length && k.parentNode !== cur[0].parentNode) flush();
      else if (cur.length && sum + kh > CFG.budget) flush();
      cur.push(k); sum += kh;
    });
    flush();
    return groups;
  }

  function shellClone(el) {
    var c = document.createElement(el.tagName);
    if (el.className) c.className = el.className;
    if (el.getAttribute('style')) c.setAttribute('style', el.getAttribute('style'));
    return c;
  }

  function wrapCard(nodes, parent, before) {
    var card = document.createElement('div');
    card.className = 'sj-card';
    var inner = document.createElement('div');
    inner.className = 'sj-card-inner';
    card.appendChild(inner);
    parent.insertBefore(card, before || null);
    nodes.forEach(function (n) { inner.appendChild(n); });
    return card;
  }

  function buildCards() {
    if (built) return;
    [].slice.call(document.querySelectorAll('section, footer.footer')).forEach(function (sec) {
      var host = hostOf(sec);
      var kids = flowBlocks(host);
      if (!kids.length) return;
      /* Marked sections stay on one slide however tall they are; layout()
         scales an oversized card down to fit. */
      if (sec.hasAttribute('data-sj-whole')) {
        wrapCard(kids, kids[0].parentNode, kids[0]);
        return;
      }
      var groups = pack(kids);
      groups.forEach(function (g) {
        // a single oversized splittable block becomes several cards, each
        // keeping its own shell so it still reads as one complete card
        if (g.length === 1 && h(g[0]) > CFG.budget && g[0].classList.contains(SPLITTABLE) &&
            !g[0].hasAttribute('data-sj-whole')) {
          var shell = g[0], sub = pack(flowBlocks(shell));
          if (sub.length > 1) {
            sub.forEach(function (sg) {
              var clone = shellClone(shell);
              shell.parentNode.insertBefore(clone, shell);
              sg.forEach(function (n) { clone.appendChild(n); });
              wrapCard([clone], clone.parentNode, clone);
            });
            shell.parentNode.removeChild(shell);
            return;
          }
        }
        wrapCard(g, g[0].parentNode, g[0]);
      });
    });
    cards = [].slice.call(document.querySelectorAll('.sj-card'));
    cards.forEach(function (c) {
      var inn = c.firstChild;
      if (SOLO && inn.children.length === 1 && inn.children[0].matches && inn.children[0].matches(SOLO))
        c.classList.add('sj-chapter');
    });
    sections = [].slice.call(document.querySelectorAll('section, footer.footer')).map(function (el) {
      var t = el.querySelector('h2.section-title');
      return { el: el, label: t ? t.textContent.trim()
        : el.classList.contains('hero') ? 'Top' : el.tagName === 'FOOTER' ? 'Contact' : 'Overview' };
    });
    built = true;
  }

  /* Scale any card whose content still overflows the real viewport. */
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

  function markActive() {
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('is-active', i === index);
    if (!rail.childNodes.length || !sections.length) return;
    var y = window.scrollY + window.innerHeight * 0.4, cur = 0;
    for (var s = 0; s < sections.length; s++) {
      if (sections[s].el.getBoundingClientRect().top + window.scrollY <= y) cur = s;
    }
    [].slice.call(rail.childNodes).forEach(function (b, i2) {
      b.classList.toggle('active', i2 === cur);
      b.setAttribute('aria-current', i2 === cur ? 'true' : 'false');
    });
  }

  /* -------------------------------------------------------------- animation */
  function animateTo(y, done) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    var start = window.scrollY, dist = y - start, t0 = null;
    if (Math.abs(dist) < 1) { done && done(); return; }
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
    index = Math.max(0, Math.min(cards.length - 1, i));
    locked = true;
    markActive();
    animateTo(targetFor(index), unlockWhenQuiet);
  }
  function stepBy(d) { goTo(index + d); }

  /* ----------------------------------------------------------------- chrome */
  var rail = document.createElement('nav');
  rail.className = 'sj-rail';
  rail.setAttribute('aria-label', 'Section navigation');
  var toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sj-toggle';

  function buildRail() {
    while (rail.firstChild) rail.removeChild(rail.firstChild);
    sections.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-label', s.label);
      b.setAttribute('aria-label', 'Jump to ' + s.label);
      b.addEventListener('click', function () {
        var t = s.el.getBoundingClientRect().top + window.scrollY, best = 0, bd = Infinity;
        for (var i = 0; i < cards.length; i++) {
          var d = Math.abs(targetFor(i) - t);
          if (d < bd) { bd = d; best = i; }
        }
        goTo(best);
      });
      rail.appendChild(b);
    });
  }

  /* ------------------------------------------------------------ enable/disable */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var enabled = false;
  function allowed() { return !reduced && !coarse && window.innerWidth >= CFG.minWidth; }
  function stored() { try { return localStorage.getItem('tailrl-snap-scroll'); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem('tailrl-snap-scroll', v); } catch (e) {} }

  function setEnabled(on) {
    enabled = !!on && allowed();
    document.body.classList.toggle('sj-on', enabled);
    toggle.textContent = enabled ? 'Presentation mode: on' : 'Presentation mode';
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    if (enabled) {
      buildOnce(function () {
        layout(); buildRail(); index = nearestIndex(); markActive();
        goTo(index);
      });
    } else {
      locked = false; acc = 0;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; animating = false; }
      cards.forEach(function (c) { c.classList.remove('is-active'); });
    }
  }
  toggle.addEventListener('click', function () { setEnabled(!enabled); store(enabled ? 'on' : 'off'); });

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
    if (!enabled) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (inScrollable(e.target)) return;
    e.preventDefault();
    if (locked) { unlockWhenQuiet(); return; }
    acc += e.deltaY;
    if (Math.abs(acc) >= CFG.wheelThreshold) { var d = acc > 0 ? 1 : -1; acc = 0; stepBy(d); }
  }, { passive: false });

  window.addEventListener('keydown', function (e) {
    if (!enabled) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var d = 0;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) d = 1;
    else if (e.key === 'ArrowUp' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) d = -1;
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); return; }
    else if (e.key === 'End') { e.preventDefault(); goTo(cards.length - 1); return; }
    else return;
    e.preventDefault();
    if (!locked) stepBy(d);
  });

  document.addEventListener('click', function (e) {
    if (!enabled) return;
    var a = e.target;
    while (a && a.tagName !== 'A') a = a.parentNode;
    if (!a || !a.getAttribute) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#' || href.length < 2) return;
    var el = document.getElementById(href.slice(1));
    if (!el) return;
    e.preventDefault();
    var card = el.closest ? el.closest('.sj-card') : null;
    var i = card ? cards.indexOf(card) : -1;
    if (i >= 0) goTo(i);
  });

  var scrollRaf = 0;
  window.addEventListener('scroll', function () {
    if (!enabled || animating || locked || scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0; index = nearestIndex(); markActive();
    });
  }, { passive: true });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!allowed() && enabled) { setEnabled(false); return; }
      if (enabled) { layout(); index = nearestIndex(); markActive(); goTo(index); }
    }, 180);
  });

  window.addEventListener('message', function (e) {
    if (e.data && typeof e.data.tailrlCodeHeight === 'number' && enabled) setTimeout(layout, 80);
  });

  /* Cards are built on first opt-in only. Images must be loaded first or the
     packing would size figure cards from zero-height lazy images. */
  var building = false;
  function buildOnce(then) {
    if (built) { requestAnimationFrame(then); return; }
    if (building) return;
    building = true;
    toggle.textContent = 'Presentation mode: preparing…';
    loadImages().then(function () {
      buildCards();
      building = false;
      requestAnimationFrame(then);
    });
  }

  function boot() {
    document.body.appendChild(rail);
    document.body.appendChild(toggle);
    if (!allowed()) { toggle.style.display = 'none'; return; }
    toggle.textContent = 'Presentation mode';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('title', 'Snap through the page one card at a time');
    // deliberately not restoring a stored "on": the page always opens in
    // ordinary scrolling, and only an explicit click turns the mode on
    if (stored() === 'on') store('off');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
