'use strict';

/**
 * Main-process byte-progress stall watchdog.
 *
 * Owns the terminal stall guarantee for network downloads: if no new real byte
 * arrives within stallMs, abort the AbortController that the provider fetch
 * must observe. Heartbeats without byte growth do not reset the timer.
 */
function createByteProgressWatchdog(options = {}) {
  const stallMs = Math.max(50, Number(options.stallMs) || 45000);
  const onStall = typeof options.onStall === 'function' ? options.onStall : null;
  const controller = new AbortController();
  let lastRealByteAt = Date.now();
  let downloadedBytes = 0;
  let armedAt = null;
  let timer = null;
  let stalled = false;

  function touch(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= downloadedBytes) return false;
    downloadedBytes = n;
    lastRealByteAt = Date.now();
    return true;
  }

  function getState() {
    return {
      stallMs,
      armedAt,
      lastRealByteAt,
      downloadedBytes,
      stalled,
      aborted: controller.signal.aborted === true,
      idleMs: Date.now() - lastRealByteAt,
    };
  }

  function disarm() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function requestAbort(reason) {
    if (controller.signal.aborted) return getState();
    const err = reason instanceof Error
      ? reason
      : Object.assign(new Error(String(reason || 'cloud_download_stalled')), {
        code: String(reason?.code || reason || 'cloud_download_stalled'),
      });
    if (!err.code) err.code = 'cloud_download_stalled';
    stalled = err.code === 'cloud_download_stalled' || /stall/i.test(err.code);
    try { controller.abort(err); } catch { /* AbortController.abort is sync */ }
    disarm();
    return getState();
  }

  function arm() {
    if (timer) return getState();
    armedAt = Date.now();
    lastRealByteAt = armedAt;
    timer = setInterval(() => {
      if (controller.signal.aborted) {
        disarm();
        return;
      }
      if (Date.now() - lastRealByteAt > stallMs) {
        const err = new Error('cloud_download_stalled');
        err.code = 'cloud_download_stalled';
        err.watchdog = getState();
        requestAbort(err);
        try { onStall?.(err); } catch { /* observer only */ }
      }
    }, Math.min(250, Math.max(50, Math.floor(stallMs / 10))));
    return getState();
  }

  return {
    signal: controller.signal,
    stallMs,
    touch,
    arm,
    disarm,
    requestAbort,
    getState,
  };
}

module.exports = {
  createByteProgressWatchdog,
  DEFAULT_STALL_MS: 45000,
};
