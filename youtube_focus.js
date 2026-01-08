// youtube_focus.js
(() => {
    // 1) Cosmetic filtering: hide sponsored/promoted UI (safe-ish)
    const STYLE = document.createElement("style");
    STYLE.textContent = `
      /* Promoted / Sponsored shelves & panels (these change often) */
      ytd-display-ad-renderer,
      ytd-promoted-sparkles-web-renderer,
      ytd-in-feed-ad-layout-renderer,
      ytd-action-companion-ad-renderer,
      ytd-banner-promo-renderer,
      #player-ads,
      .ytd-companion-slot-renderer {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(STYLE);
  
    // 2) Behavior: click "Skip" when it exists
    function trySkip() {
      const skip =
        document.querySelector(".ytp-ad-skip-button, .ytp-skip-ad-button") ||
        document.querySelector("button.ytp-ad-skip-button");
      if (skip) skip.click();
    }
  
    // 3) Optional: if an ad is playing and no skip yet, speed it up + mute
    // This reduces annoyance without nuking playback requests.
    function trySpeedThroughAd() {
      const adShowing = document.querySelector(".ad-showing");
      const video = document.querySelector("video");
      if (!video) return;
  
      if (adShowing) {
        video.muted = true;
        // 16x is aggressive; you can lower to 4x if you want less weirdness
        video.playbackRate = 16;
      } else {
        video.playbackRate = 1;
        // don't auto-unmute: that can be annoying
      }
    }
  
    // Run periodically (YouTube is a single-page app; DOM changes constantly)
    const tick = () => {
      trySkip();
      trySpeedThroughAd();
    };
  
    // MutationObserver triggers quickly when buttons appear
    const obs = new MutationObserver(tick);
    obs.observe(document.documentElement, { childList: true, subtree: true });
  
    // Also run on an interval as a fallback
    setInterval(tick, 500);
  })();
  