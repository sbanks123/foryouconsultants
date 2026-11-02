// SEGMENT 3 tests - RNN for weekly sequences
const test = require('node:test');
const assert = require('node:assert/strict');
const tf = require('../testlib/tf.js');
const act = require('../js/dl-activations.js');
const rnn = require('../js/dl-rnn.js');

/* 16 weeks with a clear repeating engagement pattern */
function fakeSeries(n) {
  const s = { er: [], followers: [], reach: [], posts: [], saves: [], paid: [] };
  for (let i = 0; i < n; i++) {
    s.er.push(+(4 + 2 * Math.sin(i / 1.5)).toFixed(2));
    s.followers.push(1000 + i * 25); s.reach.push(5000 + 300 * Math.cos(i));
    s.posts.push(3 + (i % 3)); s.saves.push(40 + i); s.paid.push(i % 4 === 0 ? 50 : 0);
  }
  return s;
}

test('series -> matrix uses the six features and flags paid as 0/1', () => {
  const m = rnn.seriesToMatrix(fakeSeries(5));
  assert.equal(m.length, 5); assert.equal(m[0].length, rnn.FEATURES.length);
  assert.equal(m[0][5], 1); assert.equal(m[1][5], 0);
});

test('scaler maps to 0..1 and inverts exactly', () => {
  const mat = rnn.seriesToMatrix(fakeSeries(8));
  const sc = rnn.fitScaler(mat);
  const scaled = rnn.scaleMatrix(mat, sc);
  scaled.flat().forEach(v => assert.ok(v >= 0 && v <= 1));
  assert.ok(Math.abs(rnn.unscaleValue(scaled[3][0], sc, 0) - mat[3][0]) < 1e-9);
});

test('windows: n weeks with lookback L give n-L windows of shape [L, features]', () => {
  const mat = rnn.scaleMatrix(rnn.seriesToMatrix(fakeSeries(10)), rnn.fitScaler(rnn.seriesToMatrix(fakeSeries(10))));
  const w = rnn.makeWindows(mat, 4, 0, 'regression');
  assert.equal(w.X.length, 6); assert.equal(w.X[0].length, 4); assert.equal(w.Y.length, 6);
  assert.equal(w.Y[0], mat[4][0]);
  const b = rnn.makeWindows(mat, 4, 0, 'binary');
  b.Y.forEach(v => assert.ok(v === 0 || v === 1));
});

test('lookback adapts to small histories', () => {
  assert.equal(rnn.chooseLookback(4), 2);
  assert.equal(rnn.chooseLookback(20), 4);
  assert.equal(rnn.chooseLookback(3), 1);
});

test('RNN passes the activation audit for regression and binary', () => {
  for (const task of ['regression', 'binary']) {
    const m = rnn.buildRNN(tf, { timesteps: 4, features: 6, task });
    const r = act.auditModel(m, task);
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.equal(r.hidden[0].type, 'LSTM'); assert.equal(r.hidden[0].activation, 'relu');
    m.dispose();
  }
});

test('trains, loss falls, and forecasts real-unit values', async () => {
  const s = fakeSeries(16);
  const t = await rnn.trainRNN(tf, { tiktok: s }, { epochs: 80 });
  assert.ok(t.history[t.history.length - 1] < t.history[0], 'loss should fall');
  const f = rnn.forecastRNN(tf, t, s, 'tiktok', 3);
  assert.equal(f.length, 3);
  f.forEach(v => assert.ok(Number.isFinite(v)));
  assert.throws(() => rnn.forecastRNN(tf, t, s, 'instagram', 1));
  t.model.dispose();
});

test('refuses to train on too little data', async () => {
  await assert.rejects(rnn.trainRNN(tf, { tiktok: fakeSeries(2) }));
});
