// In-memory stand-in for the Supabase client: select/eq/range and upsert with
// onConflict, plus a row-level-security check on owner_id like the real database.
function createFakeSupabase(seed, currentUser) {
  const db = JSON.parse(JSON.stringify(seed || {}));
  const serial = {};
  function table(name) { if (!db[name]) db[name] = []; return db[name]; }
  return {
    db,
    calls: [],
    from(name) {
      const self = this;
      return {
        select() {
          const filters = [];
          const q = {
            eq(col, v) { filters.push([col, v]); return q; },
            range(a, b) {
              const rows = table(name).filter(r => filters.every(([c, v]) => r[c] === v));
              return Promise.resolve({ data: JSON.parse(JSON.stringify(rows.slice(a, b + 1))), error: null });
            }
          };
          return q;
        },
        upsert(rows, opts) {
          self.calls.push({ table: name, n: rows.length, onConflict: opts && opts.onConflict });
          const keys = ((opts && opts.onConflict) || 'id').split(',');
          const t = table(name);
          for (const r of rows) {
            if (r.owner_id !== currentUser) return Promise.resolve({ error: { message: 'new row violates row-level security policy' } });
            const hit = t.find(x => keys.every(k => String(x[k]) === String(r[k])));
            if (hit && hit.owner_id !== currentUser) return Promise.resolve({ error: { message: 'new row violates row-level security policy for table "' + name + '"' } });
            if (hit) Object.assign(hit, r);
            else { const row = Object.assign({}, r); if (row.id === undefined) { serial[name] = (serial[name] || 100) + 1; row.id = serial[name]; } t.push(row); }
          }
          return Promise.resolve({ error: null });
        }
      };
    }
  };
}
module.exports = { createFakeSupabase };
