// SEGMENT 2 tests - CNN for images
const test = require('node:test');
const assert = require('node:assert/strict');
const tf = require('../testlib/tf.js');
const act = require('../js/dl-activations.js');
const cnn = require('../js/dl-cnn.js');

const SIZE = 16;

/* Two easy synthetic "image" classes: bright top half vs bright bottom half. */
function fakeImages(n) {
  const xs = [], labels = [];
  for (let i = 0; i < n; i++) {
    const cls = i % 2;
    const px = tf.tidy(() => {
      const top = tf.fill([SIZE / 2, SIZE, 3], cls === 0 ? 230 : 20);
      const bottom = tf.fill([SIZE / 2, SIZE, 3], cls === 0 ? 20 : 230);
      const noise = tf.randomUniform([SIZE, SIZE, 3], 0, 25);
      return tf.concat([top, bottom], 0).add(noise);
    });
    xs.push(cnn.preprocessPixels(tf, px, SIZE)); px.dispose();
    labels.push(cls);
  }
  return { xs, labels };
}

test('every task builds with ReLU hidden layers and the right output', () => {
  for (const [task, n] of [['multiclass', 6], ['binary', 1], ['regression', 1]]) {
    for (const hidden of ['relu', 'leaky']) {
      const m = cnn.buildCNN(tf, { inputShape: [SIZE, SIZE, 3], task, nClasses: n, hidden });
      const r = act.auditModel(m, task);
      assert.equal(r.ok, true, task + '/' + hidden + ': ' + r.problems.join('; '));
      assert.equal(r.hidden.length, 3); // conv1, conv2, dense
      m.dispose();
    }
  }
});

test('preprocessPixels resizes, drops alpha and scales to 0..1', () => {
  const rgba = tf.fill([40, 30, 4], 255);
  const out = cnn.preprocessPixels(tf, rgba, SIZE);
  assert.deepEqual(out.shape, [SIZE, SIZE, 3]);
  assert.ok(Math.abs(out.max().dataSync()[0] - 1) < 1e-6);
  rgba.dispose(); out.dispose();
});

test('encodeLabels one-hots classes and rejects bad labels', () => {
  const y = cnn.encodeLabels(tf, [0, 2, 1], 'multiclass', 3);
  assert.deepEqual(y.arraySync(), [[1, 0, 0], [0, 0, 1], [0, 1, 0]]);
  assert.throws(() => cnn.encodeLabels(tf, [3], 'multiclass', 3));
  assert.throws(() => cnn.encodeLabels(tf, [2], 'binary'));
  y.dispose();
});

test('learns two image classes and predicts with probabilities summing to 1', async () => {
  const { xs, labels } = fakeImages(12);
  const X = tf.stack(xs); xs.forEach(t => t.dispose());
  const Y = cnn.encodeLabels(tf, labels, 'multiclass', 2);
  const m = cnn.buildCNN(tf, { inputShape: [SIZE, SIZE, 3], task: 'multiclass', nClasses: 2, filters: [8, 8], denseUnits: 16 });
  const hist = await cnn.trainCNN(tf, m, X, Y, { epochs: 15, batchSize: 8 });
  assert.ok(hist[hist.length - 1] < hist[0], 'loss should fall');
  const test = fakeImages(2);
  const p0 = cnn.predictImage(tf, m, test.xs[0], ['top', 'bottom']);
  const p1 = cnn.predictImage(tf, m, test.xs[1], ['top', 'bottom']);
  assert.equal(p0.label, 'top'); assert.equal(p1.label, 'bottom');
  assert.ok(Math.abs(p0.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-5);
  X.dispose(); Y.dispose(); test.xs.forEach(t => t.dispose()); m.dispose();
});
