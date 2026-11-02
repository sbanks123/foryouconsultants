// SEGMENT 5 tests - client backup & restore
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/client-backup.js');
const { createFakeSupabase } = require('../testlib/fake-supabase.js');

const OWNER = 'user-a';
function seed() {
  return {
    clients: [
      { id: 'pourfected', owner_id: OWNER, name: 'Pourfected Mobile Bar', industry: 'Mobile bar', platforms: ['tiktok'], payload: { id: 'pourfected', series: { tiktok: { er: [3.1, 4.2] } } } },
      { id: 'other-co', owner_id: OWNER, name: 'Other Co', platforms: ['instagram'], payload: {} }
    ],
    metrics_weekly: [
      { id: 1, client_id: 'pourfected', owner_id: OWNER, platform: 'tiktok', week_start: '2026-10-05', followers: 480, engagement_rate: 3.1 },
      { id: 2, client_id: 'pourfected', owner_id: OWNER, platform: 'tiktok', week_start: '2026-10-12', followers: 495, engagement_rate: 4.2 },
      { id: 3, client_id: 'other-co', owner_id: OWNER, platform: 'instagram', week_start: '2026-10-12', followers: 90 }
    ],
    posts: [{ id: 'p1', client_id: 'pourfected', owner_id: OWNER, platform: 'tiktok', title: 'Blueberry syrup', reach: 29200 }],
    profile_snapshots: [{ id: 7, client_id: 'pourfected', owner_id: OWNER, platform: 'tiktok', captured_on: '2026-08-12', followers: 482 }],
    documents: [], credentials: []
  };
}

test('canonical JSON is key-order independent', () => {
  assert.equal(B.canonicalJSON({ b: 1, a: [2, { d: 1, c: 2 }] }), B.canonicalJSON({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

test('export pulls only the chosen client, from every table, with a checksum', async () => {
  const sb = createFakeSupabase(seed(), OWNER);
  const bk = await B.exportClients(sb, 'pourfected');
  assert.equal(bk.format, B.FORMAT);
  assert.deepEqual(bk.client_ids, ['pourfected']);
  assert.deepEqual(bk.counts, { clients: 1, metrics_weekly: 2, posts: 1, profile_snapshots: 1, documents: 0, credentials: 0 });
  assert.match(bk.checksum, /^[0-9a-f]{64}$/);
  assert.equal(B.backupFileName(bk, '2026-11-02'), 'fy-backup_pourfected_2026-11-02.json');
  assert.equal((await B.verifyBackup(bk)).ok, true);
});

test('export of several clients names the file all-clients', async () => {
  const bk = await B.exportClients(createFakeSupabase(seed(), OWNER), ['pourfected', 'other-co']);
  assert.equal(bk.counts.clients, 2);
  assert.equal(B.backupFileName(bk, '2026-11-02'), 'fy-backup_all-clients_2026-11-02.json');
});

test('a full wipe is repaired by re-uploading the file', async () => {
  const before = createFakeSupabase(seed(), OWNER);
  const text = JSON.stringify(await B.exportClients(before, 'pourfected'));
  const wiped = createFakeSupabase({}, OWNER);                     // database wiped
  const res = await B.restoreFromText(wiped, text, OWNER);
  assert.deepEqual(res.written, { clients: 1, metrics_weekly: 2, posts: 1, profile_snapshots: 1 });
  assert.equal(wiped.db.clients[0].payload.series.tiktok.er[1], 4.2);
  assert.deepEqual(wiped.db.metrics_weekly.map(r => r.week_start), ['2026-10-05', '2026-10-12']);
  assert.equal(wiped.calls[0].table, 'clients', 'clients must be restored first (foreign keys)');
});

test('restoring twice does not duplicate rows', async () => {
  const sb = createFakeSupabase(seed(), OWNER);
  const text = JSON.stringify(await B.exportClients(sb, 'pourfected'));
  await B.restoreFromText(sb, text, OWNER);
  await B.restoreFromText(sb, text, OWNER);
  assert.equal(sb.db.metrics_weekly.filter(r => r.client_id === 'pourfected').length, 2);
  assert.equal(sb.db.posts.length, 1);
});

test('restore re-owns rows to the signed-in account and drops serial ids', async () => {
  const bk = await B.exportClients(createFakeSupabase(seed(), OWNER), 'pourfected');
  const steps = B.planRestore(bk, 'user-b');
  steps.forEach(s => s.rows.forEach(r => assert.equal(r.owner_id, 'user-b')));
  const mw = steps.find(s => s.table === 'metrics_weekly');
  assert.equal(mw.onConflict, 'client_id,platform,week_start');
  mw.rows.forEach(r => assert.equal('id' in r, false));
  assert.throws(() => B.planRestore(bk, null));
});

test('an edited or damaged file is rejected before anything is written', async () => {
  const bk = await B.exportClients(createFakeSupabase(seed(), OWNER), 'pourfected');
  bk.tables.metrics_weekly[0].followers = 999999;
  const sb = createFakeSupabase({}, OWNER);
  await assert.rejects(B.restoreFromText(sb, JSON.stringify(bk), OWNER), /checksum/);
  assert.equal(sb.calls.length, 0);
  await assert.rejects(B.restoreFromText(sb, 'not json', OWNER), /valid JSON/);
  await assert.rejects(B.restoreFromText(sb, JSON.stringify({ format: 'x' }), OWNER), /not a Four You backup/);
});

test('rows pointing at a client missing from the file are rejected', async () => {
  const bk = await B.exportClients(createFakeSupabase(seed(), OWNER), 'pourfected');
  bk.tables.posts.push({ id: 'p9', client_id: 'ghost', platform: 'tiktok' });
  bk.checksum = await B.sha256Hex(B.canonicalJSON(bk.tables));
  const v = await B.verifyBackup(bk);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /unknown client ghost/);
});

test('old "Export everything" files (array of clients) still restore', async () => {
  const legacy = [{ id: 'old-client', name: 'Old Client', primary: 'tiktok', platforms: ['tiktok'], series: {} }];
  const sb = createFakeSupabase({}, OWNER);
  const res = await B.restoreFromText(sb, JSON.stringify(legacy), OWNER);
  assert.equal(res.written.clients, 1);
  assert.equal(sb.db.clients[0].primary_platform, 'tiktok');
  assert.equal(sb.db.clients[0].payload.id, 'old-client');
});

test('a client id owned by another account gives a clear error', async () => {
  const s = seed();
  s.clients[0].owner_id = 'someone-else';
  const sb = createFakeSupabase(s, OWNER);
  const bk = await B.buildBackup({ clients: [Object.assign({}, seed().clients[0])] });
  await assert.rejects(B.runRestore(sb, B.planRestore(bk, OWNER)), /another account/);
});
