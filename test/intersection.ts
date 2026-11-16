/** A controllable IntersectionObserver for tests. */
export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  targets = new Set<Element>();
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit = {}) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.targets.add(el);
  }
  unobserve(el: Element): void {
    this.targets.delete(el);
  }
  disconnect(): void {
    this.disconnected = true;
    this.targets.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Fire the callback as if every target became visible. */
  trigger(isIntersecting = true): void {
    const entries = [...this.targets].map(target => ({ target, isIntersecting } as IntersectionObserverEntry));
    this.callback(entries, this as unknown as IntersectionObserver);
  }
  static latest(): MockIntersectionObserver | undefined {
    return [...MockIntersectionObserver.instances].reverse().find(o => !o.disconnected);
  }
  static install(): void {
    MockIntersectionObserver.instances = [];
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;
  }
}
