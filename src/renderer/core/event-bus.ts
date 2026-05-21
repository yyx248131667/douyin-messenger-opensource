/**
 * @file event-bus.ts
 * @description Centralized UI event dispatcher, decouples components from global window object.
 */

type EventHandler = (...args: any[]) => void;

export class EventBus {
  private static events: Map<string, EventHandler[]> = new Map();

  public static on(event: string, handler: EventHandler) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(handler);
  }

  public static off(event: string, handler: EventHandler) {
    const handlers = this.events.get(event);
    if (!handlers) return;

    this.events.set(event, handlers.filter(h => h !== handler));
  }

  public static emit(event: string, ...args: any[]) {
    const handlers = this.events.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (e) {
          console.error(`[EventBus] Error in event ${event}`, e);
        }
      });
    }
  }
}
