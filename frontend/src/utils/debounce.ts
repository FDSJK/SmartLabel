/**
 * Returns a debounced version of `fn`. The returned function delays invoking
 * `fn` until `delayMs` milliseconds have elapsed since the last invocation.
 * The returned function can be cancelled via `.cancel()` and flushed via `.flush()`.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): T & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: unknown[] | null = null;

  function invoke() {
    if (pendingArgs) {
      fn(...pendingArgs);
      pendingArgs = null;
    }
    timer = null;
  }

  const debounced = function (...args: unknown[]) {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(invoke, delayMs);
  } as T & { cancel: () => void; flush: () => void };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      pendingArgs = null;
    }
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
  };

  return debounced;
}
