// Public by design: the Supabase project URL and publishable key. They grant nothing on their own.
// Every table is protected by row-level security: only the owner's account, signed in with a password
// AND a verified authenticator code (aal2), can read or write anything.
const CFG = {
  url: 'https://guyqmvkipcvabkvfmreq.supabase.co',
  key: 'sb_publishable_C8Q9w-MnX9uYvPPvjDld3w_IQpvdK1P'
};
const PLATFORMS = [
  {k:'tiktok',n:'TikTok',c:'#D1345B'},{k:'instagram',n:'Instagram',c:'#7B4FC9'},
  {k:'facebook',n:'Facebook',c:'#2D6CDF'},{k:'x',n:'X',c:'#3B4A47'},{k:'linkedin',n:'LinkedIn',c:'#E08A00'}
];
const PM = Object.fromEntries(PLATFORMS.map(p=>[p.k,p]));
const VIEWS = [['overview','Overview'],['weekly','Weekly numbers'],['posts','Posts'],['platforms','Platforms'],['activity','Activity']];

const S = {auth:'boot',uid:null,factor:null,enroll:null,notice:null,clients:[],accounts:[],weekly:[],posts:[],snaps:[],daily:[],log:[],cid:null,view:'overview',edit:null,status:'loading',lastSave:null,error:null};

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => n==null||n===''||isNaN(n) ? '—' : Number(n).toLocaleString('en-US');
const pct = n => n==null||n===''||isNaN(n) ? '—' : Number(n).toFixed(2)+'%';
const money = n => n==null||isNaN(n) ? '—' : Number(n).toLocaleString('en-US',{style:'currency',currency:'USD'});
const num = (v,d=0) => (v===''||v==null||isNaN(v)) ? d : Number(v);
const numOrNull = v => (v===''||v==null||isNaN(v)) ? null : Number(v);
const dstr = d => new Date(Date.parse(d.length<=10 ? d+'T00:00:00Z' : d)).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:d.length<=10?'UTC':undefined});
const dshort = ms => new Date(ms).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const todayLocal = () => {const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const mondayOf = s => {const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40) || 'client';
const initials = n => n.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
const cur = () => S.clients.find(c=>c.id===S.cid);
const byDateDesc = k => (a,b) => String(b[k]||'').localeCompare(String(a[k]||''));
const data = f => Object.fromEntries(new FormData(f));

let toastTimer;
function toast(msg,err){const t=document.getElementById('toast');t.textContent=msg;t.className='toast'+(err?' err':'');t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,err?7000:2800);}

const ORDER = {clients:'created_at',platform_accounts:'created_at',metrics_weekly:'week_start',posts:'posted_at',profile_snapshots:'captured_on',analytics_daily:'day'};
const CONFLICT = {clients:'id',platform_accounts:'client_id,platform',metrics_weekly:'client_id,platform,week_start',posts:'id',profile_snapshots:'client_id,platform,captured_on'};
let sb = null;

// Run a Supabase call and turn failures into readable messages.
async function q(p){
  let r;
  try{ r = await p; }catch{ throw new Error('Could not reach Supabase. Check your connection and try again.'); }
  if(r.error){
    const m = r.error.message || '';
    if(r.status===401 || /jwt|row-level security|permission denied/i.test(m)){
      if(S.auth==='ready'){ S.auth='boot'; setTimeout(boot,0); }
      throw new Error('Your sign-in expired or needs a verification code. Please sign in again.');
    }
    throw new Error(m || 'Request failed.');
  }
  return r.data;
}
function merge(list,rows,key='id'){for(const row of rows){const i=list.findIndex(x=>x[key]===row[key]);if(i>=0)list[i]=row;else list.push(row);}}
async function save(table,rows,label,list){
  const out = await q(sb.from(table).upsert(rows.map(r=>({...r,owner_id:S.uid})),{onConflict:CONFLICT[table]}).select());
  merge(list,out);
  S.lastSave = new Date(); S.status='ok';
  toast(label+' saved to Supabase');
  return out;
}
async function ensureTracked(p){
  const c=cur(); if(!c||c.platforms.includes(p)) return;
  await save('clients',[{...c,platforms:[...c.platforms,p]}],'Client',S.clients);
}

/* ---------- sign-in: password + authenticator code ---------- */
const IDLE_MS = 20*60*1000; let idleTimer;
function armIdle(){ clearTimeout(idleTimer); if(S.auth==='ready') idleTimer=setTimeout(()=>resetToLogin('You were signed out after 20 minutes of inactivity.'),IDLE_MS); }
['pointerdown','keydown','scroll'].forEach(ev=>document.addEventListener(ev,armIdle,{passive:true}));

function resetToLogin(msg){
  clearTimeout(idleTimer);
  Object.assign(S,{auth:'login',uid:null,factor:null,enroll:null,notice:msg||null,clients:[],accounts:[],weekly:[],posts:[],snaps:[],daily:[],log:[],cid:null,edit:null,view:'overview',status:'loading'});
  render();
}
async function signOut(msg){
  try{ await sb.auth.signOut(); }catch{}
  history.replaceState(null,'',location.pathname);
  resetToLogin(msg);
}
async function boot(){
  S.auth='boot'; render();
  try{
    const {data:{session}} = await sb.auth.getSession();
    if(!session){ S.auth='login'; return render(); }
    S.uid = session.user.id;
    const {data:aal,error} = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if(error) throw error;
    if(aal.currentLevel==='aal2'){ S.auth='ready'; armIdle(); return loadAll(); }
    return startMfa();
  }catch(e){ S.auth='login'; S.notice=e.message; render(); }
}
async function startMfa(){
  const {data:fl,error:le} = await sb.auth.mfa.listFactors(); if(le) throw le;
  const verified = (fl.totp||[]).find(f=>f.status==='verified');
  if(verified){ S.auth='mfa'; S.factor=verified.id; S.enroll=null; return render(); }
  for(const f of (fl.all||[]).filter(f=>f.status==='unverified')) await sb.auth.mfa.unenroll({factorId:f.id});
  const {data,error} = await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'Four You '+Date.now()});
  if(error) throw error;
  S.auth='enroll'; S.factor=data.id; S.enroll={qr:data.totp.qr_code,secret:data.totp.secret}; render();
}
async function verifyMfa(code){
  const {data:ch,error:ce} = await sb.auth.mfa.challenge({factorId:S.factor}); if(ce) throw ce;
  const {error} = await sb.auth.mfa.verify({factorId:S.factor,challengeId:ch.id,code:code.replace(/\s/g,'')});
  if(error) throw new Error("That code didn't work. Check the clock on your phone and try the next code.");
}
function authScreen(){
  const top = '<header class="top"><div class="brand">Four You<small>Social analytics</small></div></header>';
  const note = S.notice ? `<div class="banner" role="alert">${esc(S.notice)}</div>` : '';
  let body;
  if(S.auth==='boot') body = '<p>Checking your sign-in…</p>';
  else if(S.auth==='login') body = `<h1>Sign in</h1>${note}<form data-form="login">
    <label>Email<input name="email" type="email" autocomplete="username" required></label><br>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label><br>
    <button class="btn" type="submit">Continue</button></form>`;
  else if(S.auth==='enroll') body = `<h1>Set up your authenticator</h1>${note}
    <p class="hint">This site holds client data, so it needs a second step. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar), then enter the 6-digit code it shows.</p>
    <img src="${esc(S.enroll.qr)}" alt="QR code to add this site to your authenticator app" width="200" height="200" style="background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px">
    <p class="hint">Can't scan? Enter this key in the app instead:<br><code style="word-break:break-all">${esc(S.enroll.secret)}</code></p>
    <form data-form="mfa"><label>6-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]{6,7}" required></label><br>
    <button class="btn" type="submit">Turn on and continue</button> <button class="btn ghost" type="button" data-act="signout">Cancel</button></form>`;
  else body = `<h1>Enter your code</h1>${note}<p class="hint">Open your authenticator app and enter the 6-digit code for Four You.</p>
    <form data-form="mfa"><label>6-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]{6,7}" required autofocus></label><br>
    <button class="btn" type="submit">Verify</button> <button class="btn ghost" type="button" data-act="signout">Cancel</button></form>`;
  return top+`<main class="authbox">${body}</main>`;
}

/* ---------- data ---------- */
async function loadAll(){
  S.status='loading'; S.error=null; render();
  try{
    const t=['clients','platform_accounts','metrics_weekly','posts','profile_snapshots','analytics_daily'];
    [S.clients,S.accounts,S.weekly,S.posts,S.snaps,S.daily] = await Promise.all(t.map(table=>q(sb.from(table).select('*').order(ORDER[table],{ascending:false,nullsFirst:false}).limit(5000))));
    S.clients.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    S.status='ok';
    readHash();
    if(!S.cid || !cur()) S.cid = (S.clients.find(c=>c.is_active)||S.clients[0]||{}).id || null;
  }catch(e){ S.status='error'; S.error=e.message; }
  render();
}
function followerSeries(cid,p){
  const m=new Map();
  S.snaps.filter(r=>r.client_id===cid&&r.platform===p&&r.followers!=null).forEach(r=>m.set(r.captured_on,r.followers));
  S.weekly.filter(r=>r.client_id===cid&&r.platform===p).forEach(r=>m.set(r.week_start,r.followers));
  return [...m].map(([d,v])=>({d,x:Date.parse(d+'T00:00:00Z'),y:Number(v)})).sort((a,b)=>a.x-b.x);
}
function rateSeries(cid,p){
  return S.weekly.filter(r=>r.client_id===cid&&r.platform===p).map(r=>({x:Date.parse(r.week_start+'T00:00:00Z'),y:Number(r.engagement_rate)})).sort((a,b)=>a.x-b.x);
}
const computeER = (l,s,sh,c,reach) => reach>0 ? Math.round((l+s+sh+c)/reach*10000)/100 : 0;

/* ---------- charts ---------- */
function lineChart(series){
  const pts=series.flatMap(s=>s.points);
  if(!pts.length) return '<p class="empty">Nothing to chart yet. Add weekly numbers to see the trend.</p>';
  const W=640,H=220,m={l:52,r:14,t:12,b:26};
  const x0=Math.min(...pts.map(p=>p.x)), x1=Math.max(...pts.map(p=>p.x));
  let y0=Math.min(...pts.map(p=>p.y)), y1=Math.max(...pts.map(p=>p.y));
  if(y0===y1){y0-=1;y1+=1;} const pad=(y1-y0)*.1; y0=Math.max(0,y0-pad); y1+=pad;
  const sx=x=>x1===x0?m.l+(W-m.l-m.r)/2:m.l+(x-x0)/(x1-x0)*(W-m.l-m.r);
  const sy=y=>m.t+(1-(y-y0)/(y1-y0))*(H-m.t-m.b);
  let g='';
  for(let i=0;i<=3;i++){const v=y0+(y1-y0)*i/3,y=sy(v);g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y}" y2="${y}" stroke="#E1E8E4"/><text x="${m.l-8}" y="${y+4}" text-anchor="end">${Math.abs(v)>=100?Math.round(v).toLocaleString('en-US'):v.toFixed(1)}</text>`;}
  g+=`<text x="${m.l}" y="${H-6}">${dshort(x0)}</text>`;
  if(x1!==x0) g+=`<text x="${W-m.r}" y="${H-6}" text-anchor="end">${dshort(x1)}</text>`;
  for(const s of series){
    if(!s.points.length) continue;
    if(s.points.length>1) g+=`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${s.points.map(p=>sx(p.x)+','+sy(p.y)).join(' ')}"/>`;
    for(const p of s.points) g+=`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="4" fill="${s.color}"><title>${esc(s.name)}, ${dshort(p.x)}: ${p.y.toLocaleString('en-US')}</title></circle>`;
  }
  const lg=series.filter(s=>s.points.length).map(s=>`<span><i class="dot" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">${g}</svg><div class="legend">${lg}</div>`;
}

/* ---------- views ---------- */
function tracked(c){return PLATFORMS.filter(p=>c.platforms.includes(p.k));}
function field(label,name,type='text',val='',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(val)}" ${extra}></label>`;}
function platformSelect(sel,name='platform'){return `<label>Platform<select name="${name}">${PLATFORMS.map(p=>`<option value="${p.k}" ${p.k===sel?'selected':''}>${p.n}</option>`).join('')}</select></label>`;}

function overview(c){
  const T=tracked(c), cid=c.id;
  const wk=S.weekly.filter(r=>r.client_id===cid);
  let followers=0, any=false;
  const rows=T.map(p=>{
    const s=followerSeries(cid,p.k), last=s.at(-1), prev=s.at(-2);
    if(last){followers+=last.y;any=true;}
    const lw=wk.filter(r=>r.platform===p.k).sort(byDateDesc('week_start'))[0];
    const acct=S.accounts.find(a=>a.client_id===cid&&a.platform===p.k);
    return {p,last,delta:last&&prev?last.y-prev.y:null,lw,handle:acct&&acct.handle};
  });
  const maxWeek=wk.map(r=>r.week_start).sort().at(-1);
  const wkRows=wk.filter(r=>r.week_start===maxWeek);
  const reach=wkRows.reduce((a,r)=>a+r.reach,0);
  const recent=wk.filter(r=>r.week_start>=(maxWeek?new Date(Date.parse(maxWeek)-21*864e5).toISOString().slice(0,10):'9'));
  const rr=recent.reduce((a,r)=>a+r.reach,0);
  const er=rr>0?recent.reduce((a,r)=>a+r.engagement_rate*r.reach,0)/rr:null;
  const posts=S.posts.filter(r=>r.client_id===cid);
  const postReach=posts.reduce((a,r)=>a+(r.reach||0),0);
  const fSeries=T.map(p=>({name:p.n,color:p.c,points:followerSeries(cid,p.k)}));
  const eSeries=T.map(p=>({name:p.n,color:p.c,points:rateSeries(cid,p.k)}));
  return `
  <div class="ledger">
    <div><b>${any?fmt(followers):'—'}</b><span>Followers, all platforms</span></div>
    <div><b>${maxWeek?fmt(reach):'—'}</b><span>${maxWeek?'Reach, week of '+dshort(Date.parse(maxWeek)):'Reach, latest week'}</span></div>
    <div><b>${er==null?'—':pct(er)}</b><span>Engagement rate, last 4 weeks</span></div>
    <div><b>${fmt(posts.length)}</b><span>Posts logged · ${fmt(postReach)} reach</span></div>
  </div>
  <div class="grid2">
    <section class="panel"><h2>Followers over time</h2>${lineChart(fSeries)}</section>
    <section class="panel"><h2>Engagement rate by week</h2>${lineChart(eSeries)}</section>
  </div>
  <section class="panel"><h2>Platforms</h2><div class="scroll"><table>
    <thead><tr><th>Platform</th><th class="l">Handle</th><th>Followers</th><th>Change</th><th>Reach (latest week)</th><th>Engagement</th><th>Updated</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td><i class="dot" style="background:${r.p.c}"></i>${r.p.n}</td><td class="l">${esc(r.handle||'—')}</td><td>${r.last?fmt(r.last.y):'—'}</td>
      <td class="${r.delta>0?'up':r.delta<0?'down':''}">${r.delta==null?'—':(r.delta>0?'+':'')+fmt(r.delta)}</td>
      <td>${r.lw?fmt(r.lw.reach):'—'}</td><td>${r.lw?pct(r.lw.engagement_rate):'—'}</td><td>${r.last?dstr(r.last.d):'—'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No platforms tracked. Edit the client to choose platforms.</td></tr>'}</tbody></table></div></section>`;
}

function weeklyView(c){
  const e=S.edit&&S.edit.table==='metrics_weekly'?S.weekly.find(r=>r.id===S.edit.id):null;
  const v=e||{};
  const rows=S.weekly.filter(r=>r.client_id===c.id).sort((a,b)=>b.week_start.localeCompare(a.week_start)||a.platform.localeCompare(b.platform));
  return `<section class="panel"><h2>${e?'Edit weekly numbers':'Add weekly numbers'}</h2>
  <p class="hint">Weeks start on Monday. Saving a week that already exists for a platform replaces it. Leave engagement rate blank to calculate it from likes, saves, shares and comments divided by reach.</p>
  <form data-form="weekly">
    <div class="row">${platformSelect(v.platform||c.primary_platform)}${field('Week of','week_start','date',v.week_start||mondayOf(todayLocal()),'required')}</div>
    <div class="row">
      ${field('Followers','followers','number',v.followers??'','min="0" required')}${field('Reach','reach','number',v.reach??'','min="0" required')}
      ${field('Impressions','impressions','number',v.impressions??'','min="0"')}${field('Engagement rate (%)','engagement_rate','number',v.engagement_rate??'','min="0" step="0.01"')}
      ${field('Link clicks','clicks','number',v.clicks??'','min="0"')}${field('Posts published','posts','number',v.posts??'','min="0"')}
      ${field('Likes','likes','number',v.likes??'','min="0"')}${field('Saves','saves','number',v.saves??'','min="0"')}
      ${field('Shares','shares','number',v.shares??'','min="0"')}${field('Comments','comments','number',v.comments??'','min="0"')}
      ${field('Paid spend ($)','paid_spend','number',v.paid_spend??'','min="0" step="0.01"')}
    </div>
    <button class="btn" type="submit">${e?'Save changes':'Save week'}</button>
    ${e?'<button class="btn ghost" type="button" data-act="cancel-edit">Cancel</button>':''}
  </form></section>
  <section class="panel"><h2>History</h2>${rows.length?`<div class="scroll"><table>
    <thead><tr><th>Week of</th><th class="l">Platform</th><th>Followers</th><th>Reach</th><th>Engagement</th><th>Clicks</th><th>Posts</th><th>Spend</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${dstr(r.week_start)}</td><td class="l"><i class="dot" style="background:${PM[r.platform].c}"></i>${PM[r.platform].n}</td><td>${fmt(r.followers)}</td><td>${fmt(r.reach)}</td><td>${pct(r.engagement_rate)}</td><td>${fmt(r.clicks)}</td><td>${fmt(r.posts)}</td><td>${money(r.paid_spend)}</td>
    <td><button class="link" data-edit="metrics_weekly:${r.id}">Edit</button><button class="link del" data-del="metrics_weekly:${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No weeks recorded for this client yet. Add the first one above.</p>'}</section>`;
}

function postsView(c){
  const e=S.edit&&S.edit.table==='posts'?S.posts.find(r=>r.id===S.edit.id):null;
  const v=e||{};
  const pd=v.posted_at?new Date(v.posted_at):null;
  const rows=S.posts.filter(r=>r.client_id===c.id).sort((a,b)=>String(b.posted_at||'').localeCompare(String(a.posted_at||''))||(b.reach||0)-(a.reach||0));
  return `<section class="panel"><h2>${e?'Edit post':'Log a post'}</h2>
  <form data-form="post">
    <div class="row">${platformSelect(v.platform||c.primary_platform)}${field('Title or caption','title','text',v.title||'','required')}${field('Link','permalink','url',v.permalink||'')}
      ${field('Date posted','posted_date','date',pd?pd.getFullYear()+'-'+String(pd.getMonth()+1).padStart(2,'0')+'-'+String(pd.getDate()).padStart(2,'0'):'')}
      ${field('Time (optional)','posted_time','time',pd&&v.post_hour!=null?String(pd.getHours()).padStart(2,'0')+':'+String(pd.getMinutes()).padStart(2,'0'):'')}</div>
    <div class="row">${field('Reach','reach','number',v.reach??'','min="0"')}${field('Likes','likes','number',v.likes??'','min="0"')}${field('Saves','saves','number',v.saves??'','min="0"')}${field('Shares','shares','number',v.shares??'','min="0"')}${field('Comments','comments','number',v.comments??'','min="0"')}</div>
    <div class="chk"><label><input type="checkbox" name="is_paid" ${v.is_paid?'checked':''}>Paid promotion</label></div>
    <button class="btn" type="submit">${e?'Save changes':'Save post'}</button>
    ${e?'<button class="btn ghost" type="button" data-act="cancel-edit">Cancel</button>':''}
  </form></section>
  <section class="panel"><h2>All posts</h2>${rows.length?`<div class="scroll"><table>
    <thead><tr><th class="l">Post</th><th class="l">Platform</th><th class="l">Posted</th><th>Reach</th><th>Likes</th><th>Saves</th><th>Shares</th><th>Comments</th><th>Engagement</th><th></th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td class="l" style="white-space:normal;min-width:200px">${r.permalink?`<a href="${esc(r.permalink)}" target="_blank" rel="noopener">${esc(r.title||'Untitled')}</a>`:esc(r.title||'Untitled')}${r.is_paid?' <small>(paid)</small>':''}</td>
    <td class="l"><i class="dot" style="background:${PM[r.platform].c}"></i>${PM[r.platform].n}</td><td class="l">${r.posted_at?dstr(r.posted_at):'—'}</td><td>${fmt(r.reach)}</td><td>${fmt(r.likes)}</td><td>${fmt(r.saves)}</td><td>${fmt(r.shares)}</td><td>${fmt(r.comments)}</td><td>${pct(r.engagement_rate)}</td>
    <td><button class="link" data-edit="posts:${r.id}">Edit</button><button class="link del" data-del="posts:${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No posts logged yet. Add one above.</p>'}</section>`;
}

function platformsView(c){
  const T=tracked(c);
  const snaps=S.snaps.filter(r=>r.client_id===c.id).sort(byDateDesc('captured_on'));
  return `<section class="panel"><h2>Account handles</h2><p class="hint">Which account on each platform belongs to ${esc(c.name)}.</p>
  ${T.map(p=>{const a=S.accounts.find(x=>x.client_id===c.id&&x.platform===p.k);return `<form data-form="account" class="row" style="align-items:end"><input type="hidden" name="platform" value="${p.k}">
    <label><i class="dot" style="background:${p.c}"></i>${p.n}<input name="handle" value="${esc(a?a.handle:'')}" placeholder="@handle"></label><div><button class="btn ghost" type="submit">Save handle</button></div></form>`;}).join('')||'<p class="empty">No platforms tracked. Edit the client to choose platforms.</p>'}
  </section>
  <section class="panel"><h2>Add a profile snapshot</h2><p class="hint">A point-in-time count from a public profile. It also feeds the follower chart.</p>
  <form data-form="snapshot"><div class="row">${platformSelect(c.primary_platform)}${field('Date','captured_on','date',todayLocal(),'required')}${field('Followers','followers','number','','min="0" required')}${field('Following','following','number','','min="0"')}${field('Total likes','total_likes','number','','min="0"')}${field('Videos or posts','video_count','number','','min="0"')}</div>
  <button class="btn" type="submit">Save snapshot</button></form></section>
  <section class="panel"><h2>Snapshots</h2>${snaps.length?`<div class="scroll"><table><thead><tr><th>Date</th><th class="l">Platform</th><th>Followers</th><th>Following</th><th>Total likes</th><th>Videos</th><th></th></tr></thead>
  <tbody>${snaps.map(r=>`<tr><td>${dstr(r.captured_on)}</td><td class="l"><i class="dot" style="background:${PM[r.platform].c}"></i>${PM[r.platform].n}</td><td>${fmt(r.followers)}</td><td>${fmt(r.following)}</td><td>${fmt(r.total_likes)}</td><td>${fmt(r.video_count)}</td><td><button class="link del" data-del="profile_snapshots:${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No snapshots yet.</p>'}</section>`;
}

function activityView(){
  if(S.log===null) return '<p class="empty">Loading activity…</p>';
  const rows=S.log.slice(0,150);
  return `<section class="panel"><h2>Activity</h2><p class="hint">Every save and delete is recorded here and cannot be edited.</p>${rows.length?`<div class="scroll"><table>
  <thead><tr><th class="l">When</th><th class="l">Action</th><th class="l">Table</th><th class="l">Platform</th><th class="l">Period</th></tr></thead>
  <tbody>${rows.map(r=>`<tr><td class="l">${new Date(r.entered_at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</td><td class="l">${esc(r.action)}</td><td class="l">${esc(r.entity)}</td><td class="l">${r.platform?PM[r.platform].n:'—'}</td><td class="l">${r.period?dstr(r.period):'—'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Nothing recorded yet.</p>'}</section>`;
}

function clientForm(){
  const e=S.edit&&S.edit.table==='clients'?S.clients.find(r=>r.id===S.edit.id):null;
  const v=e||{platforms:['tiktok'],primary_platform:'tiktok',color:'#14352D'};
  return `<div class="head"><h1>${e?'Edit client':'Add a client'}</h1></div>
  <section class="panel"><form data-form="client">
    <div class="row">${field('Business name','name','text',v.name||'','required')}${field('Industry','industry','text',v.industry||'')}${field('Contact email','contact_email','email',v.contact_email||'')}
      <label>Colour<input name="color" type="color" value="${esc(v.color||'#14352D')}"></label>${platformSelect(v.primary_platform,'primary_platform').replace('Platform<','Main platform<')}</div>
    <p class="hint">Platforms to track</p>
    <div class="chk">${PLATFORMS.map(p=>`<label><input type="checkbox" name="platforms" value="${p.k}" ${v.platforms.includes(p.k)?'checked':''}>${p.n}</label>`).join('')}</div>
    <button class="btn" type="submit">${e?'Save changes':'Add client'}</button>
    ${S.clients.length?'<button class="btn ghost" type="button" data-act="cancel-edit">Cancel</button>':''}
  </form></section>`;
}

/* ---------- shell ---------- */
function statusPill(){
  if(S.status==='error') return '<span class="pill err">Not connected</span>';
  if(S.status==='loading') return '<span class="pill">Connecting…</span>';
  return `<span class="pill">${S.lastSave?'Saved to Supabase · '+S.lastSave.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'Connected to Supabase'}</span>`;
}
function render(){
  const app=document.getElementById('app');
  if(S.auth!=='ready'){ app.innerHTML=authScreen(); return; }
  const top=`<header class="top"><div class="brand">Four You<small>Social analytics</small></div><span style="display:flex;gap:8px;align-items:center">${statusPill()}<button class="pill" data-act="signout" style="border:0;color:#fff;cursor:pointer">Sign out</button></span></header>`;
  if(S.status==='loading'&&!S.clients.length){app.innerHTML=top+'<p style="padding:24px">Loading from Supabase…</p>';return;}
  if(S.status==='error'&&!S.clients.length){app.innerHTML=top+`<main><div class="banner"><b>Couldn't load your data.</b><br>${esc(S.error)}</div><button class="btn" data-act="retry">Try again</button></main>`;return;}
  const c=cur();
  const side=`<aside><h2>Clients</h2>${S.clients.filter(x=>x.is_active).map(x=>`<button class="cl" data-client="${esc(x.id)}" ${x.id===S.cid&&S.view!=='client'?'aria-current="true"':''}><span class="av" style="background:${esc(x.color||'#14352D')}">${esc(x.avatar||initials(x.name))}</span><span class="n">${esc(x.name)}</span></button>`).join('')}
    <button class="cl" data-act="new-client"><span class="av" style="background:#fff;color:var(--bottle);border:1px dashed var(--bottle)">+</span><span class="n">Add client</span></button></aside>`;
  let body;
  if(S.view==='client'||!c) body=clientForm();
  else{
    const v={overview,weekly:weeklyView,posts:postsView,platforms:platformsView,activity:activityView}[S.view]||overview;
    body=`<div class="head"><h1>${esc(c.name)}</h1><span class="sub">${esc(c.industry||'')}${c.industry?' · ':''}<button class="link" data-act="edit-client">Edit client</button></span></div>
    <nav class="tabs" aria-label="Sections">${VIEWS.map(([k,n])=>`<button data-nav="${k}" ${k===S.view?'aria-current="true"':''}>${n}</button>`).join('')}</nav>${v(c)}`;
  }
  app.innerHTML=top+`<div class="layout">${side}<main>${S.status==='error'?`<div class="banner"><b>Couldn't reach Supabase.</b> ${esc(S.error)}</div>`:''}${body}<p class="foot">All data is stored in Supabase. Your sign-in ends when you close this tab, or after 20 minutes without activity.</p></main></div>`;
}

/* ---------- navigation ---------- */
function readHash(){const [c,v]=location.hash.replace(/^#\/?/,'').split('/');if(c&&S.clients.some(x=>x.id===c))S.cid=c;if(v&&VIEWS.some(x=>x[0]===v))S.view=v;}
function go(view,cid){S.view=view;if(cid)S.cid=cid;S.edit=null;if(S.cid&&view!=='client')history.replaceState(null,'','#/'+S.cid+'/'+view);render();window.scrollTo(0,0);if(view==='activity')loadLog();}
async function loadLog(){try{S.log=await q(sb.from('data_entries').select('*').order('entered_at',{ascending:false}).limit(150));}catch(e){S.log=[];toast(e.message,true);}if(S.view==='activity')render();}

/* ---------- events ---------- */
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-nav],[data-client],[data-act],[data-edit],[data-del]'); if(!t) return;
  if(t.dataset.nav) return go(t.dataset.nav);
  if(t.dataset.client) return go('overview',t.dataset.client);
  if(t.dataset.edit){const [table,id]=t.dataset.edit.split(':');S.edit={table,id};render();return document.querySelector('form')?.scrollIntoView({block:'start'});}
  if(t.dataset.del){
    const [table,id]=t.dataset.del.split(':');
    if(!confirm('Delete this entry? This is recorded in the activity log.')) return;
    try{const gone=await q(sb.from(table).delete().eq('id',id).select());if(!gone.length)throw new Error('Nothing was deleted.');const list={metrics_weekly:S.weekly,posts:S.posts,profile_snapshots:S.snaps}[table];const i=list.findIndex(x=>x.id==id);if(i>=0)list.splice(i,1);S.lastSave=new Date();toast('Deleted');render();}
    catch(err){toast(err.message,true);}
    return;
  }
  const a=t.dataset.act;
  if(a==='retry') return loadAll();
  if(a==='signout') return signOut();
  if(a==='cancel-edit'){S.edit=null;if(S.view==='client'&&cur())S.view='overview';return render();}
  if(a==='new-client'){S.edit=null;S.view='client';return render();}
  if(a==='edit-client'){S.edit={table:'clients',id:S.cid};S.view='client';return render();}
});

document.addEventListener('submit',async e=>{
  const f=e.target.closest('form[data-form]'); if(!f) return;
  e.preventDefault();
  const btn=f.querySelector('button[type=submit]'); btn.disabled=true;
  const d=data(f), c=cur(), kind=f.dataset.form;
  try{
    if(kind==='login'){
      const {error} = await sb.auth.signInWithPassword({email:d.email.trim(),password:d.password});
      if(error) throw new Error(/invalid|credentials/i.test(error.message) ? 'Email or password is incorrect.' : error.message);
      S.notice=null; return boot();
    }
    if(kind==='mfa'){ await verifyMfa(d.code); S.notice=null; return boot(); }
    if(kind==='client'){
      const plats=new FormData(f).getAll('platforms'); if(!plats.includes(d.primary_platform)) plats.push(d.primary_platform);
      const ex=S.edit&&S.edit.table==='clients'?S.clients.find(x=>x.id===S.edit.id):null;
      const row={...(ex||{}),id:ex?ex.id:slug(d.name)+'-'+crypto.randomUUID().slice(0,8),name:d.name.trim(),industry:d.industry.trim()||null,contact_email:d.contact_email.trim()||null,color:d.color,avatar:initials(d.name),primary_platform:d.primary_platform,platforms:plats,is_active:true};
      const [out]=await save('clients',[row],'Client',S.clients); S.cid=out.id; S.edit=null; S.view='overview'; history.replaceState(null,'','#/'+S.cid+'/overview');
    }else if(kind==='weekly'){
      const n=k=>num(d[k]); const reach=n('reach');
      const row={client_id:c.id,platform:d.platform,week_start:mondayOf(d.week_start),followers:n('followers'),reach,impressions:numOrNull(d.impressions),
        engagement_rate:d.engagement_rate===''?computeER(n('likes'),n('saves'),n('shares'),n('comments'),reach):num(d.engagement_rate),
        clicks:n('clicks'),posts:n('posts'),likes:n('likes'),saves:n('saves'),shares:n('shares'),comments:n('comments'),paid_spend:n('paid_spend'),source:'manual'};
      await ensureTracked(d.platform); await save('metrics_weekly',[row],'Week',S.weekly); S.edit=null;
    }else if(kind==='post'){
      const n=k=>num(d[k]); const reach=n('reach');
      let posted_at=null,post_hour=null,post_dow=null;
      if(d.posted_date){const dt=new Date(d.posted_date+'T'+(d.posted_time||'12:00')+':00');posted_at=dt.toISOString();post_dow=dt.getDay();post_hour=d.posted_time?dt.getHours():null;}
      const ex=S.edit&&S.edit.table==='posts'?S.posts.find(x=>x.id===S.edit.id):null;
      const row={...(ex||{}),id:ex?ex.id:crypto.randomUUID(),client_id:c.id,platform:d.platform,title:d.title.trim(),permalink:d.permalink.trim()||null,posted_at,post_hour,post_dow,reach,likes:n('likes'),saves:n('saves'),shares:n('shares'),comments:n('comments'),engagement_rate:computeER(n('likes'),n('saves'),n('shares'),n('comments'),reach),is_paid:!!d.is_paid};
      await ensureTracked(d.platform); await save('posts',[row],'Post',S.posts); S.edit=null;
    }else if(kind==='snapshot'){
      const row={client_id:c.id,platform:d.platform,captured_on:d.captured_on,followers:num(d.followers),following:numOrNull(d.following),total_likes:numOrNull(d.total_likes),video_count:numOrNull(d.video_count),source:'manual'};
      await ensureTracked(d.platform); await save('profile_snapshots',[row],'Snapshot',S.snaps);
    }else if(kind==='account'){
      const ex=S.accounts.find(x=>x.client_id===c.id&&x.platform===d.platform);
      await save('platform_accounts',[{...(ex||{}),client_id:c.id,platform:d.platform,handle:d.handle.trim()||null}],'Handle',S.accounts);
    }
    render();
  }catch(err){toast(err.message,true);btn.disabled=false;}
});

window.addEventListener('hashchange',()=>{readHash();render();});
sb = window.supabase.createClient(CFG.url,CFG.key,{auth:{storage:window.sessionStorage,storageKey:'fy-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
sb.auth.onAuthStateChange(evt=>{ if(evt==='SIGNED_OUT' && S.auth==='ready') resetToLogin('You were signed out. Please sign in again.'); });
boot();
