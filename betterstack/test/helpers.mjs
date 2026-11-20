import http from 'node:http';

/**
 * A fake clock plus a fake setTimeout. Nothing here waits on real time:
 * advance() moves the clock forward and fires due timers in order, awaiting
 * `settle` after each one so async work the timer started can finish.
 */
export function fakeTime(start = Date.parse('2026-01-01T00:00:00Z')) {
  let now = start;
  let seq = 0;
  const queue = new Map();
  return {
    clock: { now: () => now },
    timers: {
      setTimeout(fn, ms) {
        const id = ++seq;
        queue.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, id });
        return id;
      },
      clearTimeout(id) { queue.delete(id); },
    },
    set(ms) { now = ms; },
    pending() { return [...queue.values()].sort((a, b) => a.at - b.at || a.id - b.id); },
    async advance(ms, settle = async () => {}) {
      const target = now + ms;
      for (;;) {
        const next = this.pending().find((t) => t.at <= target);
        if (!next) break;
        queue.delete(next.id);
        now = next.at;
        next.fn();
        await settle();
      }
      now = target;
      await settle();
    },
  };
}

export function fakeMailer({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendMail(message) {
      if (fail) throw new Error('SMTP connection refused');
      sent.push(message);
      return { messageId: String(sent.length) };
    },
  };
}

export function quietLogger() {
  const lines = { info: [], warn: [], error: [] };
  return {
    lines,
    info: (...a) => lines.info.push(a.join(' ')),
    warn: (...a) => lines.warn.push(a.join(' ')),
    error: (...a) => lines.error.push(a.join(' ')),
  };
}

/** A local HTTP server whose response status can be changed between checks. */
export async function targetServer(initialStatus = 200) {
  const state = { status: initialStatus, hits: 0, onRequest: null };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    if (state.onRequest) return state.onRequest(req, res);
    res.writeHead(state.status, { 'content-type': 'text/plain' });
    res.end('hello');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

/** A port with nothing listening on it. */
export async function closedPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
