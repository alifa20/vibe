import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheckResult } from '../src/scheduler.mjs';

const base = { state: 'pending', fail_streak: 0, ok_streak: 0, fail_since: null, down_after: 2, up_after: 2 };

function run(monitor, results) {
  const transitions = [];
  let m = { ...monitor };
  results.forEach((ok, i) => {
    const r = applyCheckResult(m, ok, 1000 * (i + 1));
    m = { ...m, ...r.next };
    transitions.push(r.transition);
  });
  return { m, transitions };
}

test('AE3: fail, success, fail, fail with down threshold 2 goes down once, on the fourth check', () => {
  const { m, transitions } = run(base, [false, true, false, false]);
  assert.deepEqual(transitions, [null, null, null, 'down']);
  assert.equal(m.state, 'down');
  assert.equal(m.fail_since, 3000, 'the outage starts at the first failure of the streak');
});

test('a single failure never alerts', () => {
  const { transitions } = run({ ...base, state: 'up' }, [false, true, false, true]);
  assert.deepEqual(transitions, [null, null, null, null]);
});

test('down needs up_after consecutive successes to recover', () => {
  const down = { ...base, state: 'down', fail_streak: 2, fail_since: 500 };
  const { m, transitions } = run(down, [true, false, true, true]);
  assert.deepEqual(transitions, [null, null, null, 'up']);
  assert.equal(m.state, 'up');
  assert.equal(m.fail_since, null);
});

test('pending goes up on the first success without a recovery alert', () => {
  const { m, transitions } = run(base, [true]);
  assert.deepEqual(transitions, [null]);
  assert.equal(m.state, 'up');
});

test('pending goes down after the threshold and that alerts', () => {
  const { transitions } = run({ ...base, down_after: 3 }, [false, false, false, false]);
  assert.deepEqual(transitions, [null, null, 'down', null]);
});
