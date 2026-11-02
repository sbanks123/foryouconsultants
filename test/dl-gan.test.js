// SEGMENT 4 tests - GAN for data generation
const test = require('node:test');
const assert = require('node:assert/strict');
const tf = require('../testlib/tf.js');
const act = require('../js/dl-activations.js');
const gan = require('../js/dl-gan.js');

function fakeRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push([3 + (i % 5) * 0.4, 1000 + i * 10, 5000 + (i % 7) * 100, 3 + (i % 3), 200 + i * 3, 40 + i, 10 + (i % 4), 15 + (i % 6)]);
  return rows;
}

test('generator uses LeakyReLU hidden + sigmoid output; discriminator sigmoid output', () => {
  const o = Object.assign({}, gan.DEFAULTS);
  const G = gan.buildGenerator(tf, 8, o), D = gan.buildDiscriminator(tf, 8, o);
  const g = act.auditModel(G, 'bounded01'), d = act.auditModel(D, 'binary');
  assert.equal(g.ok, true, g.problems.join('; ')); assert.equal(d.ok, true, d.problems.join('; '));
  g.hidden.concat(d.hidden).forEach(h => assert.equal(h.activation, 'leaky'));
  G.dispose(); D.dispose();
});

test('scale / unscale round trip', () => {
  const rows = fakeRows(10), sc = gan.fitScaler(rows);
  const back = gan.unscaleRows(gan.scaleRows(rows, sc), sc);
  back.forEach((r, i) => r.forEach((v, j) => assert.ok(Math.abs(v - rows[i][j]) < 1e-9)));
});

test('series -> rows picks the GAN columns', () => {
  const s = { er: [1, 2], followers: [10, 11], reach: [5, 6], posts: [1, 1], likes: [3, 4], saves: [0, 1], shares: [0, 0], comments: [2, 2] };
  assert.deepEqual(gan.seriesToRows(s)[1], [2, 11, 6, 1, 4, 1, 0, 2]);
});

test('trains and generates rows inside the real range, labelled synthetic', async () => {
  const rows = fakeRows(20);
  const t = await gan.trainGAN(tf, rows, { steps: 150 });
  assert.equal(t.dLoss.length, 150);
  t.dLoss.concat(t.gLoss).forEach(v => assert.ok(Number.isFinite(v)));
  const out = gan.generate(tf, t, 25);
  assert.equal(out.length, 25);
  const sc = t.scaler;
  out.forEach(r => {
    assert.equal(r.synthetic, true);
    gan.COLUMNS.forEach((c, j) => {
      assert.ok(r[c] >= Math.floor(sc.lo[j]) - 1e-9 && r[c] <= Math.ceil(sc.hi[j]) + 1e-9, c + ' out of range');
      if (c !== 'er') assert.equal(r[c], Math.round(r[c]));
    });
  });
  const stats = gan.compareStats(rows, out);
  assert.equal(stats.length, gan.COLUMNS.length);
  t.generator.dispose(); t.discriminator.dispose();
});

test('refuses to train on fewer than 3 rows', async () => {
  await assert.rejects(gan.trainGAN(tf, fakeRows(2)));
});
