// SEGMENT 1 tests - activation policy
const test = require('node:test');
const assert = require('node:assert/strict');
const tf = require('../testlib/tf.js');
const act = require('../js/dl-activations.js');

test('output activation matches each analytics task', () => {
  assert.equal(act.outputSpec('regression').activation, 'linear');
  assert.equal(act.outputSpec('positive').activation, 'softplus');
  assert.equal(act.outputSpec('bounded01', 3).activation, 'sigmoid');
  assert.equal(act.outputSpec('binary').activation, 'sigmoid');
  assert.equal(act.outputSpec('multiclass', 6).activation, 'softmax');
  assert.equal(act.outputSpec('multilabel', 4).activation, 'sigmoid');
});

test('loss matches the output activation', () => {
  assert.equal(act.outputSpec('regression').loss, 'meanSquaredError');
  assert.equal(act.outputSpec('binary').loss, 'binaryCrossentropy');
  assert.equal(act.outputSpec('multiclass', 3).loss, 'categoricalCrossentropy');
});

test('binary always has one output unit; multiclass needs 2+', () => {
  assert.equal(act.outputSpec('binary', 5).units, 1);
  assert.throws(() => act.outputSpec('multiclass', 1));
  assert.throws(() => act.outputSpec('nonsense'));
});

test('hidden activation must be relu or leaky', () => {
  assert.equal(act.checkHidden('relu'), 'relu');
  assert.equal(act.checkHidden('leaky'), 'leaky');
  assert.throws(() => act.checkHidden('tanh'));
  assert.throws(() => act.checkHidden('sigmoid'));
});

test('audit passes a compliant model and flags a non-compliant one', () => {
  const good = tf.sequential();
  act.addHidden(tf, good, a => tf.layers.dense({ units: 8, activation: a, inputShape: [4] }), 'leaky');
  act.addHidden(tf, good, a => tf.layers.dense({ units: 8, activation: a }), 'leaky');
  good.add(tf.layers.dense({ units: 1, activation: 'linear' }));
  const r = act.auditModel(good, 'regression');
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.deepEqual(r.hidden.map(h => h.activation), ['leaky', 'leaky']);

  const bad = tf.sequential();
  bad.add(tf.layers.dense({ units: 8, activation: 'tanh', inputShape: [4] }));
  bad.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  const b = act.auditModel(bad, 'regression');
  assert.equal(b.ok, false);
  assert.equal(b.problems.length, 2);
  good.dispose(); bad.dispose();
});

test('audit flags hidden layers that mix relu and leaky', () => {
  const m = tf.sequential();
  act.addHidden(tf, m, a => tf.layers.dense({ units: 4, activation: a, inputShape: [2] }), 'relu');
  act.addHidden(tf, m, a => tf.layers.dense({ units: 4, activation: a }), 'leaky');
  m.add(tf.layers.dense({ units: 1, activation: 'linear' }));
  const r = act.auditModel(m, 'regression');
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /uniform/);
  m.dispose();
});
