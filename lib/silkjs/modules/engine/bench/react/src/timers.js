// React's scheduler asks its host for a timer when work is scheduled. The benchmark flushes
// every render itself, so on an engine without timers the request is taken and never runs.
if (typeof setTimeout !== "function") {
  globalThis.setTimeout = function () {
    return 0;
  };
  globalThis.clearTimeout = function () {};
}
