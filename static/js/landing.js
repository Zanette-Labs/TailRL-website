/* ===========================================================================
   Landing page: the video lightbox.

   Vanilla ES5, no dependencies, no globals. Progressive enhancement: without
   JavaScript, or without <dialog>, the Video choice is an ordinary link to
   the file and the browser plays it on its own.
   ========================================================================= */
(function () {
  'use strict';

  /* ---- video lightbox ----------------------------------------------------- */
  var dlg = document.getElementById('video-dialog');
  var vid = document.getElementById('tailrl-video');
  var opener = document.getElementById('open-video');
  var canDialog = !!(dlg && vid && typeof dlg.showModal === 'function');

  function show(play) {
    if (!canDialog) return false;
    if (!dlg.open) dlg.showModal();
    if (play) {
      // the click that opened the dialog is the user gesture play() needs
      var p = vid.play();
      if (p && p.catch) p.catch(function () {});
    }
    return true;
  }

  if (opener) {
    opener.addEventListener('click', function (e) {
      // a modified click asks for the file itself, in a new tab or window
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (show(true)) e.preventDefault();
    });
  }

  if (canDialog) {
    dlg.addEventListener('close', function () {
      vid.pause();
      // a dialog opened from a #video link should not reopen on reload
      if (location.hash === '#video' && window.history && history.replaceState) {
        history.replaceState(history.state, '', location.pathname + location.search);
      }
    });
    // the bar is pointer-transparent, so anything but the video and the close
    // button is the dialog itself or its backdrop
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    var closeBtn = dlg.querySelector('.video-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { dlg.close(); });

    // #video is the shareable link, and what the blog's Video button points at.
    // It opens the player but does not start it: autoplay with sound is
    // blocked without a gesture, and should be.
    if (location.hash === '#video') show(false);
    window.addEventListener('hashchange', function () {
      if (location.hash === '#video') show(false);
    });
  }
})();
