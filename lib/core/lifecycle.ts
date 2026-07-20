import type { FeatureController } from './feature';

export type Cleanup = () => void;

export class Lifecycle implements FeatureController {
  private cleanups: Cleanup[] = [];
  private running = false;

  start(): void {
    this.running = true;
  }

  add(cleanup: Cleanup): Cleanup {
    if (!this.running) {
      cleanup();
      return cleanup;
    }
    this.cleanups.push(cleanup);
    return cleanup;
  }

  stop(): void {
    this.running = false;
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn('[linchpin] cleanup failed', error);
      }
    }
  }
}

export function toController(
  start: () => void | Cleanup | Promise<void | Cleanup>,
): FeatureController {
  let cleanup: Cleanup | undefined;
  let generation = 0;
  return {
    async start() {
      const current = ++generation;
      const next = await start();
      if (current !== generation) {
        next?.();
        return;
      }
      cleanup = next || undefined;
    },
    stop() {
      generation++;
      cleanup?.();
      cleanup = undefined;
    },
  };
}
