'use strict';

class Session {
  constructor(host, observer, options = {}) {
    this.host = host; this.observer = observer;
    this.now = options.now || (() => performance.now());
    this.deadline = this.now() + (options.timeoutMs || 180000);
    this.abort = new AbortController(); this.actionId = 0; this.frameId = 0;
    this.metrics = {started: this.now(), inputs: 0, captures: 0, observations: 0, captureMs: 0, observeMs: 0};
    this.onProgress = options.onProgress || (() => {});
  }
  check() {
    if (this.abort.signal.aborted) throw new Error('Run stopped');
    if (this.now() >= this.deadline) throw new Error('Run deadline exceeded');
    this.host.check();
    if (this.validate) this.validate();
  }
  stop() { this.abort.abort(); this.host.cancel(); }
  async wait(ms) {
    this.check();
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      this.abort.signal.addEventListener('abort', finish, {once: true});
    });
    this.check();
  }
  async bounded(promise, timeoutMs = 15000) {
    this.check();
    let timer, onAbort;
    try {
      const result = await Promise.race([promise, new Promise((_, reject) => {
        onAbort = () => reject(new Error('Run stopped'));
        this.abort.signal.addEventListener('abort', onAbort, {once: true});
        timer = setTimeout(() => reject(new Error('Operation deadline exceeded')), Math.min(timeoutMs, this.deadline - this.now()));
      })]);
      this.check(); return result;
    } finally { clearTimeout(timer); this.abort.signal.removeEventListener('abort', onAbort); }
  }
  async observe(kind, arg = {}) {
    this.check();
    if(this.busy)throw new Error('Session operation already running');
    this.busy=true;
    try {
    const action = this.actionId, frameId = ++this.frameId;
    let started = this.now();
    const frame = await this.bounded(this.host.capture());
    this.metrics.captures++; this.metrics.captureMs += this.now() - started;
    started = this.now();
    const result = await this.bounded(this.observer.observe(kind, frame, arg), 30000);
    this.metrics.observations++; this.metrics.observeMs += this.now() - started;
    if (action !== this.actionId || frameId !== this.frameId) throw new Error('Stale observation');
    return result;
    } catch(error) {this.stop();throw error;} finally {this.busy=false;}
  }
  async until(kind, arg, predicate = r => r.valid, timeoutMs = 6000) {
    const deadline = this.now() + timeoutMs;
    let previous=null;
    do {
      const result = await this.observe(kind, arg);
      if(this.now()>=deadline)throw new Error('Observation timed out: '+kind);
      if (predicate(result)) {
        // Require matching structured content from two fresh frames for
        // navigation. Identity OCR has its own content/layout gates.
        if(kind==='rowidentity'||kind==='cardidentity')return result;
        const signature=JSON.stringify(result);
        if(signature===previous)return result;
        previous=signature;
      } else previous=null;
      await this.wait(80);
    } while (this.now() < deadline);
    throw new Error('Observation timed out: ' + kind);
  }
  async input(x, y, mutation, kind = 'click') {
    this.check();
    if(this.busy)throw new Error('Session operation already running');
    this.busy=true;
    try {
    await this.bounded(this.host.input({x, y, kind, mutation, actionId: ++this.actionId}));
    this.metrics.inputs++;
    await this.wait(100);
    } catch(error) {this.stop();throw error;} finally {this.busy=false;}
  }
}
module.exports = {Session};
