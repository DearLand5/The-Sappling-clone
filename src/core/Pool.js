// Object Pooling: повторное использование объектов вместо постоянного создания и удаления.

export class Pool {
  constructor(factory, reset) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    this.created = 0;
  }
  get(arg) {
    const o = this.free.length ? this.free.pop() : (this.created++, this.factory(arg));
    if (this.reset) this.reset(o, arg);
    return o;
  }
  release(o) { this.free.push(o); }
  drain(fn) { for (const o of this.free) fn(o); this.free.length = 0; }
}
