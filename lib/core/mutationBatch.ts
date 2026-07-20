export type MutationBatch = {
  enqueue(root: Element): void;
  stop(): void;
};

/**
 * Collect DOM roots into one frame. Parents replace queued descendants, and
 * hidden tabs use a microtask because animation frames may be suspended.
 */
export function createMutationBatch(
  flush: (roots: Element[]) => void,
): MutationBatch {
  const roots = new Set<Element>();
  let frame: number | null = null;
  let microtaskPending = false;
  let stopped = false;

  const drain = () => {
    frame = null;
    microtaskPending = false;
    if (stopped || roots.size === 0) return;
    const next = Array.from(roots).filter((root) => root.isConnected);
    roots.clear();
    if (next.length) flush(next);
  };

  const schedule = () => {
    if (document.hidden) {
      if (microtaskPending) return;
      microtaskPending = true;
      queueMicrotask(drain);
      return;
    }
    if (frame != null) return;
    frame = requestAnimationFrame(drain);
  };

  return {
    enqueue(root) {
      if (stopped || !root.isConnected) return;
      for (const queued of roots) {
        if (queued === root || queued.contains(root)) return;
        if (root.contains(queued)) roots.delete(queued);
      }
      roots.add(root);
      schedule();
    },
    stop() {
      stopped = true;
      roots.clear();
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
