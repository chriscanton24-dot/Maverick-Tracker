// ===== Config / setup =====
function getApiUrl(){
  if(window.APP_CONFIG && window.APP_CONFIG.apiUrl) return window.APP_CONFIG.apiUrl;
  return localStorage.getItem('mw_api_url') || '';
}
function saveApiUrl(){
  const v = document.getElementById('setupUrl').value.trim();
  if(!v){ return; }
  localStorage.setItem('mw_api_url', v);
  document.getElementById('setupScreen').style.display='none';
  loadData();
}
function showSetup(){
  document.getElementById('setupScreen').style.display='block';
  document.getElementById('mainApp').style.display='none';
  document.getElementById('setupUrl').value = getApiUrl();
}
function changeApiUrl(){
  showSetup();
}

const DISP_STYLE = {
  'Sale':'sale','Sale (WIP)':'sale','Sale (Declined)':'sale','Cancelled':'cxl',
  'Data':'info','Called To Confirm':'info','Matched':'info',
  'Set':'pend','Pending':'pend','Unentered':'pend','Issue':'pend',
  'Unconfirmed':'pur','Demo No Sale':'pur','Demo (1-Leg)':'pur',
  'Call To Cancel':'cxl','Customer Cancel at Door':'cxl','Customer No Show':'cxl'
};
const DISP_OPTIONS = ['Data','Set','Unconfirmed','Called To Confirm','Cancelled','Call To Cancel','Customer Cancel at Door','Customer No Show','Demo No Sale','Demo (1-Leg)','Sale','Sale (WIP)','Sale (Declined)','Pending','Unentered','Issue','Matched'];

// LeadPerfection short codes → the full names the app uses everywhere (leaderboard, KPIs, charts, pills).
// Matching ignores upper/lower case and extra spaces. Unknown values are left exactly as they are.
const DISP_ALIASES = {
  'sale':'Sale',
  'sale (wip)':'Sale (WIP)', 'sale(wip)':'Sale (WIP)',
  'sale (dcl)':'Sale (Declined)', 'sale(dcl)':'Sale (Declined)', 'sale (declined)':'Sale (Declined)',
  '1-leg demo':'Demo (1-Leg)', '1-leg':'Demo (1-Leg)', '1 leg demo':'Demo (1-Leg)', '1 leg':'Demo (1-Leg)', 'demo (1-leg)':'Demo (1-Leg)',
  'dns':'Demo No Sale', 'demo no sale':'Demo No Sale',
  'uncon':'Unconfirmed', 'unconfirmed':'Unconfirmed',
  'cxl':'Cancelled', 'cancel':'Cancelled', 'canceled':'Cancelled', 'cancelled':'Cancelled',
  'ctc':'Call To Cancel', 'call to cancel':'Call To Cancel',
  'ccd':'Customer Cancel at Door', 'customer cancel at door':'Customer Cancel at Door',
  'cns':'Customer No Show', 'customer no show':'Customer No Show',
};
function normalizeDisp(di){
  if(di==null) return di;
  const k = String(di).trim().replace(/\s+/g,' ').toLowerCase();
  return DISP_ALIASES[k] || di;
}
const MATERIAL_OPTIONS = ['Original','Wood','Vinyl','Metal'];
const ISSUE_OPTIONS = ['Condensation','Inoperable','Warping','Noisy','Wood Rot','Rust','Drafty','Broken Hardware','Broken Seals','Frame Rot','Cracking','Peeling Paint','Sun Fade/UV Damage'];
const PI_OPTIONS = ['Windows','Doors','Siding','Soffit','Fascia'];
const CALL_CODES = ['AP','CONF','UNCON','DNS','CXL','RESCHED','NA','LMST','OTHER'];

function bucket(di){
  if(!di) return 'Unknown';
  if(di.startsWith('Sale')) return 'Sale';
  if(di==='Cancelled') return 'Cancelled';
  if(di==='Call To Cancel') return 'Call To Cancel';
  if(di==='Customer Cancel at Door') return 'Customer Cancel at Door';
  if(di==='Customer No Show') return 'Customer No Show';
  if(di==='Demo No Sale') return 'Demo No Sale';
  if(di==='Pending'||di==='Unentered'||di==='Issue') return 'Pending / Unentered';
  if(di==='Unconfirmed') return 'Unconfirmed';
  if(di==='Called To Confirm') return 'Called To Confirm';
  if(di==='Data') return 'Data';
  if(di==='Set') return 'Set';
  return di;
}
function fmtMoney(n){ return '$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); }
function monthOf(d){ return d ? String(d).slice(0,7) : ''; }
function esc(s){ return (s==null?'':String(s)).replace(/"/g,'&quot;'); }
function newId(){ return 'tmp'+Date.now().toString(36); }

let DATA = [];
// Sort options for the "Sort" dropdown (works on phone + Mac). 'rowId' = position in the Sheet,
// so "Newest added" always puts the most recently created lead first, whatever date is on the sheet.
const SORT_OPTIONS = {
  new:       {k:'rowId', dir:'desc'},
  d_desc:    {k:'d',     dir:'desc'},
  d_asc:     {k:'d',     dir:'asc'},
  appt_desc: {k:'appt',  dir:'desc'},
  appt_asc:  {k:'appt',  dir:'asc'},
  cu_asc:    {k:'cu',    dir:'asc'},
  cv_asc:    {k:'cv',    dir:'asc'},
  di_asc:    {k:'di',    dir:'asc'},
  am_desc:   {k:'am',    dir:'desc'},
};
let sortChoice = (function(){ try{ const v = localStorage.getItem('mw_sort'); return (v && SORT_OPTIONS[v]) ? v : 'new'; }catch(e){ return 'new'; } })();
let sort = {...SORT_OPTIONS[sortChoice]};
let charts={};
let parseTargetId = null;
let viewFilter = localStorage.getItem('mw_view_as') || '';

async function api(action, payload){
  const url = getApiUrl();
  if(action==='list' || action==='settings'){
    const r = await fetch(url+'?action='+action);
    return r.json();
  }
  if(action==='update' && payload && payload.fields) payload = {...payload, fields: restoreOriginalNames(payload.fields)};
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({action, ...payload}) });
  return r.json();
}

// The Sheet is never rewritten just because the app displays a cleaner name/disposition:
// if a field still equals what the app translated it to, the ORIGINAL Sheet value is sent back.
// Only a value you actually changed gets written.
function restoreOriginalNames(fields){
  const f = {...fields};
  if(f._cvRaw!==undefined && f.cv===f._cvShown) f.cv = f._cvRaw;
  if(f._diRaw!==undefined && f.di===f._diShown) f.di = f._diRaw;
  delete f._cvRaw; delete f._cvShown; delete f._diRaw; delete f._diShown;
  return f;
}

let SETTINGS = [];

function parseAliases(s){ return String(s||'').split(',').map(x=>x.trim()).filter(Boolean); }

// alias (lowercase) → main canvasser name, from the "Aliases" column of the Canvasser Settings tab.
function buildAliasMap(){
  const m = {};
  SETTINGS.forEach(s=> parseAliases(s.aliases).forEach(a=>{ m[a.toLowerCase()] = s.cv; }));
  // Follow chains (A → B → C) so everything lands on the final main name.
  Object.keys(m).forEach(k=>{ let v=m[k], hops=0; while(m[String(v).toLowerCase()] && hops<5 && m[String(v).toLowerCase()]!==v){ v=m[String(v).toLowerCase()]; hops++; } m[k]=v; });
  return m;
}

// 1) Merges a canvasser's other names (e.g. GroupMe/sign-up alias "dragonchamp98" → LP name "Roy Compton").
// 2) Same name typed in different casing (e.g. "CHRISTIAN CANTON" vs "Christian Canton") is
//    almost always the same person — merge to whichever casing was entered first, everywhere.
// 3) LP disposition codes (DNS, UnCon, CXL…) → full names.
// Always works from the original Sheet values, so it can be re-run safely whenever aliases change.
function canonicalizeCanvassers(rows){
  const aliasMap = buildAliasMap();
  const seen = {};
  rows.forEach(r=>{
    if(r._cvRaw===undefined) r._cvRaw = r.cv;
    if(r._diRaw===undefined) r._diRaw = r.di;
    // If a value was edited in the app since the last load, that edit is now the "original".
    if(r._cvShown!==undefined && r.cv!==r._cvShown) r._cvRaw = r.cv;
    if(r._diShown!==undefined && r.di!==r._diShown) r._diRaw = r.di;
    let name = (r._cvRaw==null?'':String(r._cvRaw)).trim();
    if(name && aliasMap[name.toLowerCase()]) name = aliasMap[name.toLowerCase()];
    const key = name.toLowerCase();
    if(key){ if(!seen[key]) seen[key] = name; name = seen[key]; }
    r.cv = key ? name : r._cvRaw;
    r._cvShown = r.cv;
    r.di = normalizeDisp(r._diRaw);
    r._diShown = r.di;
  });
}

async function loadData(){
  if(!getApiUrl()){ showSetup(); return; }
  const badge = document.getElementById('syncBadge');
  badge.textContent = 'Syncing…';
  try{
    const res = await api('list');
    if(!res.ok) throw new Error(res.error||'load failed');
    DATA = res.rows;
    // Settings first now, because canvasser aliases live there and are needed before merging names.
    try{ const sres = await api('settings'); if(sres.ok) SETTINGS = sres.settings; }catch(e){ console.error(e); }
    canonicalizeCanvassers(DATA);
    badge.textContent = 'Synced ✓ '+DATA.length+' (tap to refresh)';
    document.getElementById('mainApp').style.display='block';
    document.getElementById('setupScreen').style.display='none';
    setupViewAs();
    render();
  }catch(err){
    badge.textContent = 'Sync error — tap to retry';
    console.error(err);
  }
}

function setupViewAs(){
  const sel = document.getElementById('viewAs');
  const names = [...new Set(DATA.map(r=>r.cv))].sort();
  if(viewFilter && !names.includes(viewFilter)){ // e.g. was viewing an alias that's now merged into the main name
    const main = buildAliasMap()[viewFilter.toLowerCase()];
    viewFilter = (main && names.includes(main)) ? main : '';
    localStorage.setItem('mw_view_as', viewFilter);
  }
  sel.innerHTML = '<option value="">Everyone (supervisor view)</option>' + names.map(n=>`<option ${n===viewFilter?'selected':''}>${n}</option>`).join('');
  sel.value = viewFilter;
  sel.onchange = ()=>{ viewFilter = sel.value; localStorage.setItem('mw_view_as', viewFilter); render(); };
  const note = document.getElementById('whoNote');
  note.textContent = viewFilter ? 'Viewing as a convenience filter — this is not access control; anyone with the link can switch it back.' : '';
}

function scopedData(){
  return viewFilter ? DATA.filter(r=>r.cv===viewFilter) : DATA;
}

function populateFilters(){
  const base = scopedData();
  const cvs = [...new Set(base.map(r=>r.cv))].sort();
  const dis = [...new Set(base.map(r=>r.di))].sort();
  const selC = document.getElementById('fCanvasser');
  const selD = document.getElementById('fDisp');
  const curC = selC.value, curD = selD.value;
  selC.innerHTML = '<option value="">All canvassers</option>' + cvs.map(c=>`<option ${c===curC?'selected':''}>${c}</option>`).join('');
  selD.innerHTML = '<option value="">All dispositions</option>' + dis.map(d=>`<option ${d===curD?'selected':''}>${d}</option>`).join('');

  const months = [...new Set(base.map(r=>monthOf(r.d)))].sort();
  const tabs = document.getElementById('monthTabs');
  const activeMonth = tabs.dataset.active || 'all';
  const names = {'2026-08':'August','2026-09':'September','2026-10':'October','2026-11':'November','2026-12':'December'};
  const rangeActive = document.getElementById('fDateFrom').value || document.getElementById('fDateTo').value;
  tabs.style.opacity = rangeActive ? '0.4' : '1';
  tabs.style.pointerEvents = rangeActive ? 'none' : 'auto';
  tabs.innerHTML = `<div class="tab ${activeMonth==='all'?'active':''}" data-m="all">All</div>` +
    months.map(m=>`<div class="tab ${activeMonth===m?'active':''}" data-m="${m}">${names[m]||m}</div>`).join('');
  tabs.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{ tabs.dataset.active=t.dataset.m; render(); });
}

function filtered(){
  const base = scopedData();
  const month = document.getElementById('monthTabs').dataset.active || 'all';
  const q = document.getElementById('search').value.toLowerCase();
  const fc = document.getElementById('fCanvasser').value;
  const fd = document.getElementById('fDisp').value;
  const dFrom = document.getElementById('fDateFrom').value; // yyyy-mm-dd or ''
  const dTo = document.getElementById('fDateTo').value;
  return base.filter(r=>{
    if(dFrom || dTo){
      if(dFrom && r.d < dFrom) return false;
      if(dTo && r.d > dTo) return false;
    } else if(month!=='all' && monthOf(r.d)!==month){
      return false;
    }
    if(fc && r.cv!==fc) return false;
    if(fd && r.di!==fd) return false;
    if(q && !(`${r.cu} ${r.ad} ${r.ct}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function isDeclinedDisp(di){ return (di||'').toLowerCase().includes('decl'); }

function netAmountFor(r){
  // Use the explicit Net Sale Amount if it's been entered for this lead; otherwise fall back
  // to the old estimate (gross, unless the disposition itself is a decline).
  if(r.netAm!=null && r.netAm!=='') return Number(r.netAm)||0;
  return isNetSaleDisp(r.di) ? (r.am||0) : 0;
}

function renderKPIs(rows){
  const sales = rows.filter(r=>isSaleDisp(r.di));
  const declined = rows.filter(r=>isDeclinedDisp(r.di));
  const total = rows.length;
  const grossRev = sales.reduce((s,r)=>s+(r.am||0),0);
  const netRev = sales.reduce((s,r)=>s+netAmountFor(r),0);
  const declinedAmt = declined.reduce((s,r)=>s+(r.am||0),0);
  const kpis = [
    ['Total leads', total],['Sales', sales.length],
    ['Gross revenue', fmtMoney(grossRev)],
    ['Net revenue', fmtMoney(netRev)],
    ['Declined sales', declined.length],
    ['$ lost to declines', fmtMoney(declinedAmt)],
    ['Close rate', total? Math.round(sales.length/total*100)+'%':'0%'],
    ['Avg deal (net)', sales.length? fmtMoney(netRev/sales.length):'$0'],
  ];
  document.getElementById('kpis').innerHTML = kpis.map(([l,v])=>`<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
}

function renderCharts(rows){
  const dispCounts={}; rows.forEach(r=>{ const b=bucket(r.di); dispCounts[b]=(dispCounts[b]||0)+1; });
  const palette=['#0F2B4C','#1D5FD6','#0F8A45','#B7791B','#6D3FC7','#C6362B','#5B6472'];
  function mk(id,cfg){ if(charts[id]) charts[id].destroy(); const el=document.getElementById(id); if(!el) return; charts[id]=new Chart(el,cfg); }
  mk('chartDisp',{type:'doughnut',data:{labels:Object.keys(dispCounts),datasets:[{data:Object.values(dispCounts),backgroundColor:palette}]},
    options:{maintainAspectRatio:true,aspectRatio:1,plugins:{legend:{position:'bottom',labels:{boxWidth:9,font:{size:9.5},padding:8}}}}});

  document.getElementById('repChartBox').style.display = viewFilter? 'none':'block';
  if(!viewFilter){
    const repCounts={}; rows.forEach(r=>{ repCounts[r.cv]=(repCounts[r.cv]||0)+1; });
    const repTop = Object.entries(repCounts).sort((a,b)=>b[1]-a[1]).slice(0,7);
    mk('chartRep',{type:'bar',data:{labels:repTop.map(x=>x[0]),datasets:[{data:repTop.map(x=>x[1]),backgroundColor:'#1D5FD6'}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:9.5}}},y:{ticks:{font:{size:9.5}}}}},maintainAspectRatio:false});
  }
  const months = [...new Set(scopedData().map(r=>monthOf(r.d)))].sort();
  const monthNet = months.map(m=> scopedData().filter(r=>monthOf(r.d)===m && isSaleDisp(r.di)).reduce((s,r)=>s+netAmountFor(r),0));
  mk('chartMonth',{data:{labels:months.map(m=>({'2026-08':'Aug','2026-09':'Sep','2026-10':'Oct','2026-11':'Nov','2026-12':'Dec'}[m]||m)),
    datasets:[
      {type:'bar',label:'Net revenue',data:monthNet,backgroundColor:'#0F8A45'},
      {type:'line',label:'Goal ($150k)',data:months.map(()=>MONTHLY_NET_GOAL),borderColor:'#C6362B',borderDash:[6,4],pointRadius:0,borderWidth:1.5}
    ]},
    options:{plugins:{legend:{display:true,labels:{boxWidth:9,font:{size:9.5}}}},scales:{y:{ticks:{font:{size:9.5}}},x:{ticks:{font:{size:9.5}}}}},maintainAspectRatio:false});
}

let tableLimit = 20;

// Turns a date/time string into a sortable "yyyy-mm-dd HH:MM" key. Handles "2026-10-03",
// "2026-10-03 @ 6:00 PM", "10/3/2026 6pm", "10/3 6:30 PM". Returns '' if no date is found.
function dateSortKey(v, fallbackYear){
  const s = (v==null?'':String(v));
  let y, m, d;
  let mt = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(mt){ y=+mt[1]; m=+mt[2]; d=+mt[3]; }
  else {
    mt = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if(!mt) return '';
    m=+mt[1]; d=+mt[2];
    y = mt[3] ? +mt[3] : (fallbackYear || new Date().getFullYear());
    if(y<100) y+=2000;
  }
  let hh=0, mm=0;
  const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i);
  if(tm){ hh=+tm[1]%12; mm=+(tm[2]||0); if(tm[3].toLowerCase()==='p') hh+=12; }
  const p = n=>String(n).padStart(2,'0');
  return y+'-'+p(m)+'-'+p(d)+' '+p(hh)+':'+p(mm);
}

function sortValue(r, k){
  if(k==='rowId') return Number(r.rowId)||0;
  if(k==='am') return Number(r.am)||0;
  if(k==='d') return dateSortKey(r.d) || (r.d||'').toString();
  if(k==='appt' || k==='sa' || k==='la'){
    const yr = parseInt(String(r.d||'').slice(0,4)) || undefined;
    const src = k==='appt' ? (r.la || r.sa) : r[k]; // "appt" = current appointment: LP date if rescheduled, else original
    return dateSortKey(src, yr) || (src||'').toString();
  }
  return (r[k]==null?'':String(r[k])).toLowerCase();
}

function renderTable(allRows){
  const numeric = sort.k==='rowId' || sort.k==='am';
  const rows = allRows.slice().sort((a,b)=>{
    const x = sortValue(a, sort.k), y = sortValue(b, sort.k);
    if(!numeric){ // blanks always go to the bottom, whichever direction
      if(x==='' && y!=='') return 1;
      if(y==='' && x!=='') return -1;
    }
    if(x<y) return sort.dir==='asc'?-1:1;
    if(x>y) return sort.dir==='asc'?1:-1;
    return (Number(b.rowId)||0) - (Number(a.rowId)||0); // tie → newest added first
  });
  const shown = tableLimit ? rows.slice(0, tableLimit) : rows;
  document.getElementById('rows').innerHTML = shown.map(r=>{
    const cls = DISP_STYLE[r.di]||'info';
    const laCell = r.la ? `<span style="color:var(--pur);font-weight:600">${r.la}</span>` : '—';
    return `<tr data-id="${r.rowId}">
      <td>${r.d}</td><td>${r.sa||'—'}</td><td>${laCell}</td><td>${r.cv}</td><td>${r.cu}</td><td>${r.ct}</td><td>${r.pr}</td>
      <td><span class="pill ${cls}">${r.di}</span></td><td>${r.sr}</td>
      <td class="amt ${r.am?'':'z'}">${r.am?fmtMoney(r.am):'—'}</td>
      <td class="c-m">
        <div class="mc1"><b>${r.cu||'—'}</b><span class="pill ${cls}">${r.di||'—'}</span></div>
        <div class="mc2">${[r.ct, r.cv, r.d].filter(Boolean).join(' · ')}</div>
        <div class="mc3">Appt ${r.sa||'—'}${r.la?` · LP <span style="color:var(--pur);font-weight:600">${r.la}</span>`:''}${r.am?` · <b style="color:var(--tx)">${fmtMoney(r.am)}</b>`:''}</div>
      </td>
    </tr>`;
  }).join('');
  const note = document.getElementById('countNote');
  if(tableLimit && rows.length > tableLimit){
    note.innerHTML = `Showing ${shown.length} of ${rows.length} — <a href="#" onclick="tableLimit=0; render(); return false;" style="color:var(--info)">show all</a>`;
  } else if(!tableLimit && rows.length > 20){
    note.innerHTML = `${rows.length} records shown — <a href="#" onclick="tableLimit=20; render(); return false;" style="color:var(--info)">collapse</a>`;
  } else {
    note.textContent = rows.length + ' record' + (rows.length===1?'':'s') + ' shown';
  }
  document.querySelectorAll('#rows tr').forEach(tr=>tr.onclick=()=>openDetail(tr.dataset.id));
}

const MONTHLY_NET_GOAL = 150000;

let goalMonthKey = null; // null = current real-world month

function currentMonthKey(){
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0');
}

function renderGoalBox(){
  if(goalMonthKey===null) goalMonthKey = currentMonthKey();
  const monthKey = goalMonthKey;
  const monthRows = DATA.filter(r=>monthOf(r.d)===monthKey && isSaleDisp(r.di));
  const netMTD = monthRows.reduce((s,r)=>s+netAmountFor(r),0);
  const pct = Math.min(100, Math.round(netMTD/MONTHLY_NET_GOAL*100));
  const [y,m] = monthKey.split('-').map(Number);
  const monthName = new Date(Date.UTC(y,m-1,1)).toLocaleString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
  const isCurrent = monthKey===currentMonthKey();
  const box = document.getElementById('goalBox');
  if(!box) return;
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px">
    <div style="display:flex;align-items:center;gap:6px">
      <button class="btn sm" onclick="shiftGoalMonth(-1)">&larr;</button>
      <b style="font-size:13.5px">${monthName} team goal: ${fmtMoney(MONTHLY_NET_GOAL)} net${isCurrent?' (current)':''}</b>
      <button class="btn sm" onclick="shiftGoalMonth(1)">&rarr;</button>
      ${!isCurrent ? `<button class="btn sm" onclick="goalMonthKey=null; renderGoalBox()">Jump to current</button>` : ''}
    </div>
    <span style="font-size:13px;color:var(--tx2)">${fmtMoney(netMTD)} (${pct}%)${netMTD<MONTHLY_NET_GOAL?' — '+fmtMoney(MONTHLY_NET_GOAL-netMTD)+' to go':' — goal hit!'}</span>
  </div>
  <div style="background:var(--bg);border-radius:8px;height:10px"><div style="background:${pct>=100?'var(--sale)':'var(--info)'};width:${pct}%;height:10px;border-radius:8px"></div></div>`;
}

function shiftGoalMonth(delta){
  const [y,m] = (goalMonthKey||currentMonthKey()).split('-').map(Number);
  const d = new Date(Date.UTC(y, m-1+delta, 1));
  goalMonthKey = d.toISOString().slice(0,7);
  renderGoalBox();
}

function render(){
  populateFilters();
  const rows = filtered();
  renderKPIs(rows);
  renderGoalBox();
  renderCharts(rows);
  renderTable(rows);
  const lb = document.getElementById('leaderboardBox');
  if(lb && lb.open) renderLeaderboard();
}

document.getElementById('search').addEventListener('input', render);
document.getElementById('fCanvasser').addEventListener('change', render);
document.getElementById('fDisp').addEventListener('change', render);
document.getElementById('fDateFrom').addEventListener('change', render);
document.getElementById('fDateTo').addEventListener('change', render);
document.getElementById('clearRangeBtn').addEventListener('click', ()=>{
  document.getElementById('fDateFrom').value='';
  document.getElementById('fDateTo').value='';
  render();
});
const sortSel = document.getElementById('fSort');
sortSel.value = sortChoice;
sortSel.addEventListener('change', ()=>{
  if(!SORT_OPTIONS[sortSel.value]) return;
  sortChoice = sortSel.value;
  sort = {...SORT_OPTIONS[sortChoice]};
  try{ localStorage.setItem('mw_sort', sortChoice); }catch(e){}
  renderTable(filtered());
});
document.querySelectorAll('thead th').forEach(th=>th.addEventListener('click',()=>{
  const k = th.dataset.k;
  sort.dir = (sort.k===k && sort.dir==='asc') ? 'desc' : 'asc';
  sort.k = k;
  const match = Object.keys(SORT_OPTIONS).find(o=>SORT_OPTIONS[o].k===sort.k && SORT_OPTIONS[o].dir===sort.dir);
  sortSel.value = match || 'custom'; // column-header clicks (Mac) show up in the dropdown too
  renderTable(filtered());
}));

function chipRow(id, options, selected){
  return `<div class="chipset" id="${id}">` + options.map(o=>
    `<div class="chipbtn ${selected.includes(o)?'on':''}" data-v="${esc(o)}">${o}</div>`
  ).join('') + `</div>`;
}
function chipVal(id){ return [...document.querySelectorAll('#'+id+' .chipbtn.on')].map(el=>el.dataset.v); }
function wireChips(){ document.querySelectorAll('.chipset .chipbtn').forEach(c=>{ c.onclick = ()=> c.classList.toggle('on'); }); }
function findRow(id){ return DATA.find(x=>String(x.rowId)===String(id)); }

function openDetail(id){
  const r = findRow(id); if(!r) return;
  const calls = r.calls||[], notes = r.notesLog||[];
  const core = [
    ['LP ID', r.lp||'—'],['Lead type', r.lt],['Phone', r.ph],['Secondary phone', r.ph2||'—'],
    ['Email', r.em||'—'],['Address', r.ad+', '+r.ct],['Set appointment', r.sa||'—'],['LP / actual appt', r.la||'—'],
    ['Sales rep', r.sr],['Product', r.pr],['Disposition', r.di],
    ['Gross amount', r.am?fmtMoney(r.am):'—'],
    ['Net amount', (r.netAm!=null&&r.netAm!=='')?fmtMoney(r.netAm):'—'],
    ['In GroupMe', r.gm?'Yes':'No'],['In LP', r.il?'Yes':'No'],['Notes', r.no||'—'],
  ];
  const leadSheet = [
    ['PR Associate', r.cv],['Mr.', r.mr||'—'],['Mrs.', r.mrs||'—'],['Marital status', r.ms||'—'],
    ['Year built', r.yb||'—'],['Energy bill', r.eb||'—'],['Total windows', r.tw||'—'],['Needing price', r.np||'—'],
    ['Material', (r.mat||[]).join(', ')||'—'],['Issues', (r.is||[]).join(', ')||'—'],
    ['Products interested in', (r.pi||[]).join(', ')||'—'],['Best time to call', r.btc||'—'],
    ['Appointment (sheet)', r.apsheet||'—'],
  ];
  const lp = [['Market', r.mk||'—'],['Rank', r.rk||'—'],['Call queue', r.q||'—'],['Queue desc', r.qd||'—'],
    ['Promoter', r.pm||'—'],['Directions', r.dir||'—']];
  document.getElementById('detailBody').innerHTML = `<button class="modal-close" onclick="document.getElementById('detailModal').classList.remove('open')">&times;</button>
    <h2>${r.cu}</h2><p style="color:var(--tx2);font-size:12.5px;margin:0 0 10px">${r.d} · ${r.cv}</p>
    ${core.map(([l,v])=>`<div class="row"><span>${l}</span><span>${v}</span></div>`).join('')}
    <details><summary>Lead sheet details</summary>${leadSheet.map(([l,v])=>`<div class="row"><span>${l}</span><span>${v}</span></div>`).join('')}</details>
    <details><summary>LP details</summary>${lp.map(([l,v])=>`<div class="row"><span>${l}</span><span>${v}</span></div>`).join('')}</details>
    <details open><summary>Call log (${calls.length})</summary>
      <div id="callsList">${calls.length? calls.map(c=>`<div class="logitem"><b>${c.result||c.code||''}</b> — ${c.type||''}<div class="meta">${c.date||''} · ${c.caller||''}</div></div>`).join('') : '<p class="note">No calls logged yet.</p>'}</div>
      <button class="btn sm" onclick="addCallRow('${id}')">+ Log a call</button>
    </details>
    <details open><summary>Notes (${notes.length})</summary>
      <div id="notesList">${notes.length? notes.map(n=>`<div class="logitem">${n.text}<div class="meta">${n.cat||'General'} · ${n.entered||''} ${n.enteredBy?('· '+n.enteredBy):''}</div></div>`).join('') : '<p class="note">No notes yet.</p>'}</div>
      <button class="btn sm" onclick="addNoteRow('${id}')">+ Add note</button>
    </details>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button class="btn primary" style="flex:1" onclick="openEdit('${id}')">Update manually</button>
      <button class="btn primary" style="flex:1" onclick="openParse('${id}')">Update from screenshot</button>
    </div>`;
  document.getElementById('detailModal').classList.add('open');
}

function addCallRow(id){
  document.getElementById('callsList').insertAdjacentHTML('beforeend', `<div class="field"><div class="grid3">
    <select id="nc_code">${CALL_CODES.map(c=>`<option>${c}</option>`).join('')}</select>
    <input type="text" id="nc_caller" placeholder="Caller name">
    <input type="text" id="nc_type" placeholder="Type">
    </div><button class="btn sm primary" style="margin-top:6px" onclick="saveCall('${id}')">Save call</button></div>`);
}
async function saveCall(id){
  const r = findRow(id); if(!r) return;
  const call = { date: new Date().toLocaleString('en-US'), code: document.getElementById('nc_code').value,
    result: document.getElementById('nc_code').value, phone: r.ph,
    caller: document.getElementById('nc_caller').value, type: document.getElementById('nc_type').value };
  const calls = (r.calls||[]).concat([call]);
  await api('update', {rowId: r.rowId, fields: {...r, calls}});
  r.calls = calls; openDetail(id);
}
function addNoteRow(id){
  document.getElementById('notesList').insertAdjacentHTML('beforeend', `<div class="field"><input type="text" id="nn_text" placeholder="Note text" style="width:100%">
    <button class="btn sm primary" style="margin-top:6px" onclick="saveNote('${id}')">Save note</button></div>`);
}
async function saveNote(id){
  const r = findRow(id); if(!r) return;
  const note = { text: document.getElementById('nn_text').value, cat:'General', entered: new Date().toLocaleString('en-US'), enteredBy: viewFilter||r.cv };
  const notesLog = (r.notesLog||[]).concat([note]);
  await api('update', {rowId: r.rowId, fields: {...r, notesLog}});
  r.notesLog = notesLog; openDetail(id);
}

function openEdit(id){
  const r = findRow(id); if(!r) return;
  document.getElementById('detailBody').innerHTML = `<button class="modal-close" onclick="document.getElementById('detailModal').classList.remove('open')">&times;</button>
    <h2>Update — ${r.cu}</h2><p style="color:var(--tx2);font-size:12.5px;margin:0 0 10px">${r.d} · ${r.cv} · LP ${r.lp||'—'}</p>
    <div class="grid2">
      <div class="field"><label>Disposition</label><select id="e_di">${DISP_OPTIONS.map(o=>`<option ${o===r.di?'selected':''}>${o}</option>`).join('')}</select></div>
      <div class="field"><label>Sales rep</label><input type="text" id="e_sr" value="${esc(r.sr)}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>LP / actual appt</label><input type="text" id="e_la" value="${esc(r.la)}"></div>
      <div class="field"><label>Gross sale amount</label><input type="text" id="e_am" value="${r.am||0}"></div>
      <div class="field"><label>Net sale amount</label><input type="text" id="e_netAm" value="${(r.netAm!=null&&r.netAm!=='')?r.netAm:''}" placeholder="Leave blank if same as gross / not a sale"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>In LP?</label><select id="e_il"><option value="1" ${r.il?'selected':''}>Yes</option><option value="0" ${!r.il?'selected':''}>No</option></select></div>
      <div class="field"><label>Rank</label><input type="text" id="e_rk" value="${esc(r.rk)}"></div>
    </div>
    <div class="field"><label>Notes</label><input type="text" id="e_no" value="${esc(r.no)}"></div>
    <details><summary>Edit lead sheet details</summary>
      <div class="grid2"><div class="field"><label>Mr.</label><input type="text" id="e_mr" value="${esc(r.mr)}"></div>
      <div class="field"><label>Mrs.</label><input type="text" id="e_mrs" value="${esc(r.mrs)}"></div></div>
      <div class="grid2"><div class="field"><label>Marital status</label><input type="text" id="e_ms" value="${esc(r.ms)}"></div>
      <div class="field"><label>Secondary phone</label><input type="text" id="e_ph2" value="${esc(r.ph2)}"></div></div>
      <div class="field"><label>Email</label><input type="email" id="e_em" value="${esc(r.em)}"></div>
      <div class="grid3"><div class="field"><label>Year built</label><input type="text" id="e_yb" value="${esc(r.yb)}"></div>
      <div class="field"><label>Energy bill</label><input type="text" id="e_eb" value="${esc(r.eb)}"></div>
      <div class="field"><label>Total windows</label><input type="text" id="e_tw" value="${esc(r.tw)}"></div></div>
      <div class="field"><label>Material</label>${chipRow('e_mat', MATERIAL_OPTIONS, r.mat||[])}</div>
      <div class="field"><label>Issues</label>${chipRow('e_is', ISSUE_OPTIONS, r.is||[])}</div>
      <div class="field"><label>Products interested in</label>${chipRow('e_pi', PI_OPTIONS, r.pi||[])}</div>
      <div class="field"><label>Best time to call</label><input type="text" id="e_btc" value="${esc(r.btc)}"></div>
      <div class="field"><label>Appointment (as on sheet)</label><input type="text" id="e_apsheet" value="${esc(r.apsheet)}"></div>
    </details>
    <details><summary>Edit LP details</summary>
      <div class="grid2"><div class="field"><label>Market</label><input type="text" id="e_mk" value="${esc(r.mk)}"></div>
      <div class="field"><label>Call queue</label><input type="text" id="e_q" value="${esc(r.q)}"></div></div>
      <div class="field"><label>Queue desc</label><input type="text" id="e_qd" value="${esc(r.qd)}"></div>
      <div class="field"><label>Promoter</label><input type="text" id="e_pm" value="${esc(r.pm)}"></div>
      <div class="field"><label>Directions</label><input type="text" id="e_dir" value="${esc(r.dir)}"></div>
    </details>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn" style="flex:1" onclick="openDetail('${id}')">Cancel</button>
      <button class="btn primary" style="flex:1" onclick="saveEdit('${id}')">Save update</button>
    </div>`;
  wireChips();
}

async function saveEdit(id){
  const r = findRow(id); if(!r) return;
  const fields = {
    di:document.getElementById('e_di').value, sr:document.getElementById('e_sr').value||'Unassigned',
    la:document.getElementById('e_la').value, am:parseFloat(document.getElementById('e_am').value)||0,
    netAm: document.getElementById('e_netAm').value==='' ? '' : (parseFloat(document.getElementById('e_netAm').value)||0),
    il:document.getElementById('e_il').value==='1', rk:document.getElementById('e_rk').value,
    no:document.getElementById('e_no').value, mr:document.getElementById('e_mr').value, mrs:document.getElementById('e_mrs').value,
    ms:document.getElementById('e_ms').value, ph2:document.getElementById('e_ph2').value, em:document.getElementById('e_em').value,
    yb:document.getElementById('e_yb').value, eb:document.getElementById('e_eb').value, tw:document.getElementById('e_tw').value,
    mat:chipVal('e_mat'), is:chipVal('e_is'), pi:chipVal('e_pi'),
    btc:document.getElementById('e_btc').value, apsheet:document.getElementById('e_apsheet').value,
    mk:document.getElementById('e_mk').value, q:document.getElementById('e_q').value, qd:document.getElementById('e_qd').value,
    pm:document.getElementById('e_pm').value, dir:document.getElementById('e_dir').value,
  };
  Object.assign(r, fields);
  await api('update', {rowId: r.rowId, fields: r});
  document.getElementById('detailModal').classList.remove('open');
  render();
}
document.getElementById('detailModal').addEventListener('click',e=>{ if(e.target.id==='detailModal') e.target.classList.remove('open'); });

function openAdd(){
  document.getElementById('addBody').innerHTML = `<button class="modal-close" onclick="document.getElementById('addModal').classList.remove('open')">&times;</button>
    <h2>Add entry</h2>
    <div class="grid2"><div class="field"><label>Date</label><input type="date" id="f_d"></div>
    <div class="field"><label>Lead type</label><select id="f_lt"><option>SATD</option><option>CTS</option></select></div></div>
    <div class="field"><label>Canvasser</label><input type="text" id="f_cv"></div>
    <div class="field"><label>Customer name</label><input type="text" id="f_cu"></div>
    <div class="grid2"><div class="field"><label>Phone</label><input type="text" id="f_ph"></div>
    <div class="field"><label>City</label><input type="text" id="f_ct"></div></div>
    <div class="field"><label>Address</label><input type="text" id="f_ad"></div>
    <div class="grid2"><div class="field"><label>Product</label><input type="text" id="f_pr" placeholder="Windows"></div>
    <div class="field"><label>Disposition</label><select id="f_di">${DISP_OPTIONS.map(o=>`<option>${o}</option>`).join('')}</select></div></div>
    <div class="grid2"><div class="field"><label>Sales rep</label><input type="text" id="f_sr"></div>
    <div class="field"><label>Gross sale amount</label><input type="text" id="f_am" placeholder="0.00"></div></div>
    <div class="field"><label>Net sale amount (if known)</label><input type="text" id="f_netAm" placeholder="Leave blank if not a sale yet"></div>
    <div class="field"><label>Notes</label><input type="text" id="f_no"></div>
    <button class="btn primary" style="width:100%" onclick="saveNewEntry()">Save entry</button>`;
  document.getElementById('f_d').value = new Date().toISOString().slice(0,10);
  document.getElementById('addModal').classList.add('open');
}
document.getElementById('addBtn').addEventListener('click', openAdd);
document.getElementById('addModal').addEventListener('click',e=>{ if(e.target.id==='addModal') e.target.classList.remove('open'); });

async function saveNewEntry(){
  const fields = { d:document.getElementById('f_d').value, cv:document.getElementById('f_cv').value||'Unassigned',
    lt:document.getElementById('f_lt').value, cu:document.getElementById('f_cu').value, ph:document.getElementById('f_ph').value,
    ad:document.getElementById('f_ad').value, ct:document.getElementById('f_ct').value,
    sr:document.getElementById('f_sr').value||'Unassigned', pr:document.getElementById('f_pr').value||'Windows',
    di:document.getElementById('f_di').value, am:parseFloat(document.getElementById('f_am').value)||0,
    netAm: document.getElementById('f_netAm').value==='' ? '' : (parseFloat(document.getElementById('f_netAm').value)||0),
    gm:true, il:true, no:document.getElementById('f_no').value, calls:[], notesLog:[] };
  const res = await api('add', {fields});
  if(res.ok){ document.getElementById('addModal').classList.remove('open'); loadData(); }
}

document.getElementById('exportBtn').addEventListener('click', ()=>{
  const rows = filtered();
  const headers = ['Date','Canvasser','Lead Type','LP ID','Customer','Phone','Address','City','Sales Rep','Product','Disposition','Gross Amount','Net Amount','In GroupMe','In LP','Notes'];
  const lines = [headers.join(',')].concat(rows.map(r=>[r.d,r.cv,r.lt,r.lp,r.cu,r.ph,r.ad,r.ct,r.sr,r.pr,r.di,r.am,r.netAm,r.gm,r.il,r.no]
    .map(v=>`"${(v??'').toString().replace(/"/g,'""')}"`).join(',')));
  const csv = lines.join(String.fromCharCode(10));
  const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='maverick_tracker_export.csv'; a.click();
});

// ---------- Parse a screenshot (via Gemini, proxied through Apps Script) ----------
let parseAccumulated = null;

function openParse(targetId){
  parseTargetId = targetId || null;
  parseAccumulated = null;
  const existing = targetId ? findRow(targetId) : null;
  document.getElementById('parseBody').innerHTML = `<button class="modal-close" onclick="closeParse()">&times;</button>
    <h2>${existing? 'Update '+existing.cu+' from screenshots' : 'New lead from a screenshot'}</h2>
    <p class="note" style="margin:0 0 10px">${existing? 'Add one or more LP or lead sheet screenshots (Calls tab, Notes tab, General tab, etc.) — paste or choose several at once, they combine into one review below.' : 'Got a lead sheet photo from GroupMe? Copy the photo there, then tap the button below — no need to save it to your phone first.'}</p>
    <button class="btn primary" id="pasteBtn" style="width:100%;margin-bottom:8px">📋 Paste image from clipboard</button>
    <p class="note" id="pasteHint" style="margin:0 0 10px;text-align:center">In GroupMe: press and hold the photo → Copy. Then tap the button above. You can paste more than one, one at a time.</p>
    <label class="drop" id="dropZone" for="fileInput">Or tap to choose image(s) from your photos — pick several at once if you have them<input type="file" id="fileInput" accept="image/*" multiple></label>
    <div id="parseResult"></div>`;
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  fi.onchange = ()=> fi.files.length && handleImageFiles(Array.from(fi.files));
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', ()=> dz.classList.remove('over'));
  dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('over'); const fs=Array.from(e.dataTransfer.files||[]); if(fs.length) handleImageFiles(fs); });
  document.getElementById('pasteBtn').addEventListener('click', pasteFromClipboard);
  document.getElementById('parseModal').classList.add('open');
}
function closeParse(){ document.getElementById('parseModal').classList.remove('open'); parseTargetId=null; }
document.getElementById('parseBtn').addEventListener('click', ()=> openParse(null));
document.getElementById('parseModal').addEventListener('click',e=>{ if(e.target.id==='parseModal') closeParse(); });
document.addEventListener('paste', e=>{
  if(!document.getElementById('parseModal').classList.contains('open')) return;
  const item = [...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));
  if(item) handleImageFiles([item.getAsFile()]);
});

async function pasteFromClipboard(){
  const box = document.getElementById('parseResult');
  const hint = document.getElementById('pasteHint');
  try{
    if(!navigator.clipboard || !navigator.clipboard.read){
      hint.textContent = 'Your browser can\'t paste this way — use "Tap to choose an image" below instead, and pick it from your photos (it still works if you copied it, most photo apps save a copy to your gallery too).';
      hint.style.color = 'var(--pend)';
      return;
    }
    const items = await navigator.clipboard.read();
    for(const item of items){
      const type = item.types.find(t=>t.startsWith('image/'));
      if(type){
        const blob = await item.getType(type);
        handleImageFiles([blob]);
        return;
      }
    }
    hint.textContent = 'Nothing but text is on your clipboard right now — copy the image first, then tap this button.';
    hint.style.color = 'var(--pend)';
  }catch(err){
    hint.textContent = 'Couldn\'t read the clipboard (your browser may be asking for permission — check for a popup, or try again). You can also use "Tap to choose an image" below.';
    hint.style.color = 'var(--pend)';
  }
}

function fileToBase64(file){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=> res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function mergeParsedObjects(a, b){
  if(!a) return b;
  if(!b) return a;
  const out = {...a};
  for(const k in b){
    const bv = b[k];
    if(bv==null || bv==='') continue;
    if(k==='calls' || k==='notesLog'){
      out[k] = (out[k]||[]).concat(bv);
    } else if(Array.isArray(bv)){
      out[k] = [...new Set([...(out[k]||[]), ...bv])];
    } else if(out[k]==null || out[k]===''){
      out[k] = bv;
    }
    // else: a scalar value we already have from an earlier image wins — first screenshot's answer for a field sticks
  }
  return out;
}

async function handleImageFiles(files){
  const box = document.getElementById('parseResult');
  const log = [];
  for(let i=0; i<files.length; i++){
    box.innerHTML = log.map(l=>'<p class="note">'+l+'</p>').join('') + '<p class="note">Reading image '+(i+1)+' of '+files.length+'…</p>';
    try{
      const base64 = await fileToBase64(files[i]);
      const res = await api('parseImage', { base64, mimeType: files[i].type || 'image/jpeg' });
      if(!res.ok){
        log.push('Image '+(i+1)+': could not read it — '+esc(res.error||'error'));
        box.innerHTML = log.map(l=>'<p class="note">'+l+'</p>').join('');
        continue;
      }
      const p = res.parsed || {};
      const fieldsFound = Object.keys(p).filter(k=>k!=='calls'&&k!=='notesLog'&&p[k]!=null&&p[k]!=='').length;
      log.push('Image '+(i+1)+': found '+fieldsFound+' field(s), '+(p.calls||[]).length+' call(s), '+(p.notesLog||[]).length+' note(s)');
      parseAccumulated = mergeParsedObjects(parseAccumulated, p);
    }catch(err){
      log.push('Image '+(i+1)+' failed: '+esc(err.message));
    }
  }
  if(parseAccumulated) renderParsePreview(parseAccumulated, log);
  else box.innerHTML = log.map(l=>'<p class="note">'+l+'</p>').join('');
}

const FIELD_LABELS = {
  d:'Entry date (NOT the appointment)', cu:'Customer name', ph:'Phone', ph2:'Secondary phone', em:'Email', ad:'Address', ct:'City',
  lp:'LP ID', cv:'Canvasser / PR Associate', lt:'Lead type (SATD/CTS)', sa:'Set appointment (original, from lead sheet)',
  la:'LP / actual appointment (current, from LP)', apsheet:'Appointment (as on sheet)', mr:'Mr.', mrs:'Mrs.', ms:'Marital status', yb:'Year built',
  eb:'Energy bill', tw:'Total windows', np:'Needing price', btc:'Best time to call', no:'Notes',
  di:'Disposition', sr:'Sales rep', am:'Gross sale amount', netAm:'Net sale amount', mk:'Market', rk:'Rank', q:'Call queue',
  qd:'Queue description', pm:'Promoter', dir:'Directions',
  mat:'Material', is:'Issues', pi:'Products interested in',
};
const PARSE_FIELD_ORDER = ['d','cu','ph','ph2','em','ad','ct','lp','cv','lt','sa','la','apsheet','mr','mrs','ms','yb','eb','tw','np','btc','no','di','sr','am','netAm','mk','rk','q','qd','pm','dir'];

function renderParsePreview(parsed, log){
  const existing = parseTargetId ? findRow(parseTargetId) : null;
  const rowsHtml = PARSE_FIELD_ORDER.map(k=>{
    const fromImage = parsed[k]!=null && parsed[k]!=='';
    const val = fromImage ? parsed[k] : (existing && existing[k] ? existing[k] : '');
    const tag = fromImage ? '<span style="color:var(--info)"> — from image</span>' : (val ? '<span style="color:var(--mut)"> — current value, unchanged</span>' : '');
    return `<div class="field"><label>${FIELD_LABELS[k]||k}${tag}</label><input type="text" id="pp_${k}" value="${esc(val)}"></div>`;
  }).join('');
  const arrHtml = ['mat','is','pi'].map(k=>{
    const fromImage = parsed[k]&&parsed[k].length;
    const val = fromImage ? parsed[k] : (existing && existing[k] ? existing[k] : []);
    const tag = fromImage ? '<span style="color:var(--info)"> — from image</span>' : (val.length ? '<span style="color:var(--mut)"> — current value, unchanged</span>' : '');
    return `<div class="field"><label>${FIELD_LABELS[k]}${tag}</label><input type="text" id="pp_${k}" value="${esc((val||[]).join(', '))}"></div>`;
  }).join('');
  const callsFound = (parsed.calls||[]).length;
  const notesFound = (parsed.notesLog||[]).length;
  window.__lastParsed = parsed;
  const logHtml = (log&&log.length) ? '<div style="background:var(--bg);border-radius:8px;padding:8px 10px;margin-bottom:10px">'+log.map(l=>'<p class="note" style="margin:2px 0">'+l+'</p>').join('')+'</div>' : '';
  document.getElementById('parseResult').innerHTML = logHtml + `<p class="note" style="margin:8px 0">Check these before saving — edit anything that's wrong. Blank boxes mean it wasn't visible in the image — fill in by hand if you know it.</p>
    <div>${rowsHtml}${arrHtml}</div>
    ${(callsFound||notesFound) ? `<p class="note" style="margin:8px 0">Also found: ${callsFound} call${callsFound===1?'':'s'}, ${notesFound} note${notesFound===1?'':'s'} — these will be added to the call/notes log${existing?' on save':' once the lead is created'}.</p>` : ''}
    <button class="btn primary" style="width:100%;margin-top:6px" onclick="confirmParse()">${existing? 'Save update to '+esc(existing.cu) : 'Create new lead'}</button>
    <div id="dupeWarning"></div>`;
}

function normPhone(p){ return (p||'').replace(/\D/g,'').slice(-10); }
function normAddr(a){ return (a||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }

function findPossibleDuplicates(address, phone){
  const addr = normAddr(address);
  const ph = normPhone(phone);
  const matches = [];
  DATA.forEach(r=>{
    const addrHit = addr && normAddr(r.ad) === addr;
    const phoneHit = ph && normPhone(r.ph) === ph;
    if(addrHit || phoneHit) matches.push({...r, _why: addrHit ? 'Same address' : 'Same phone number'});
  });
  return matches;
}

function renderDupeWarning(matches){
  const box = document.getElementById('dupeWarning');
  box.innerHTML = `<div style="margin-top:10px;background:var(--pend-bg);border:1px solid var(--pend);border-radius:10px;padding:10px 12px">
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:var(--pend)">This might already be a lead — found a match:</p>
    ${matches.map(m=>`<div class="logitem" style="margin-bottom:6px"><b>${esc(m.cu)}</b> — <span style="color:var(--pend)">${esc(m._why)}</span><div class="meta">${esc(m.ad)}, ${esc(m.ct)} · ${esc(m.ph)} · ${esc(m.d)} · ${esc(m.di)}</div></div>`).join('')}
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn sm primary" style="flex:1" onclick="parseTargetId='${matches[0].rowId}'; confirmParse(true)">Update ${esc(matches[0].cu)} instead</button>
      <button class="btn sm" style="flex:1" onclick="confirmParse(true)">Create as new lead anyway</button>
    </div>
  </div>`;
}

function mergeLog(existingLog, newEntries){
  existingLog = existingLog || [];
  const seen = new Set(existingLog.map(e=>JSON.stringify(e)));
  const merged = existingLog.slice();
  (newEntries||[]).forEach(e=>{ const key=JSON.stringify(e); if(!seen.has(key)){ merged.push(e); seen.add(key); } });
  return merged;
}

async function confirmParse(force){
  const parsed = window.__lastParsed || {};
  const edited = {};
  PARSE_FIELD_ORDER.forEach(k=>{ const el=document.getElementById('pp_'+k); if(el && el.value!=='') edited[k]=el.value; });
  ['mat','is','pi'].forEach(k=>{ const el=document.getElementById('pp_'+k); if(el && el.value) edited[k]=el.value.split(',').map(s=>s.trim()).filter(Boolean); });
  if(edited.am) edited.am = parseFloat(edited.am)||0;
  if(edited.netAm) edited.netAm = parseFloat(edited.netAm)||0;

  if(!parseTargetId && !force){
    const matches = findPossibleDuplicates(edited.ad || parsed.ad, edited.ph || parsed.ph);
    if(matches.length){ renderDupeWarning(matches); return; }
  }

  const wasUpdatingId = parseTargetId;
  if(parseTargetId){
    const r = findRow(parseTargetId);
    const calls = mergeLog(r.calls, parsed.calls);
    const notesLog = mergeLog(r.notesLog, parsed.notesLog);
    const mergedFields = {...r, ...edited, calls, notesLog};
    if(mergedFields.lp) mergedFields.il = true;
    await api('update', {rowId: r.rowId, fields: mergedFields});
  } else {
    const rec = { d:new Date().toISOString().slice(0,10), lt:'SATD', gm:true, il:false,
      calls: parsed.calls||[], notesLog: parsed.notesLog||[],
      cv:'Unassigned', sr:'Unassigned', pr:'Windows', di:'Data', ...edited };
    if(rec.lp) rec.il = true;
    await api('add', {fields: rec});
  }
  closeParse();
  await loadData();
  if(wasUpdatingId) openDetail(wasUpdatingId);
}

if(window.APP_CONFIG && window.APP_CONFIG.title){
  document.getElementById('pageTitle').textContent = 'Maverick Windows — ' + window.APP_CONFIG.title;
}
loadData();

// ===== Leaderboard: tiers, bonus table, pay periods =====
const TIERS = [
  {min:0,  max:4,  dns:25, sale:125, label:'Tier 1 (0–4)'},
  {min:5,  max:7,  dns:35, sale:135, label:'Tier 2 (5–7)'},
  {min:8,  max:10, dns:45, sale:145, label:'Tier 3 (8–10)'},
  {min:11, max:13, dns:55, sale:155, label:'Tier 4 (11–13)'},
  {min:14, max:16, dns:65, sale:165, label:'Tier 5 (14–16)'},
  {min:17, max:Infinity, dns:75, sale:175, label:'Tier 6 (17+)'},
];
const BONUS_TIERS = [
  {min:30000, max:39999,   amt:200},
  {min:40000, max:49999,   amt:300},
  {min:50000, max:59999,   amt:400},
  {min:60000, max:69999,   amt:500},
  {min:70000, max:Infinity,amt:600},
];
const RAISE_PER_NET = 100000; // $1/hr per this much net sales
const RAISE_CAP_RATE = 27;
const RAISE_CAP_NET = 1000000;
const RAISE_START_RATE = 17;

function buildPayPeriods(){
  // Generates periods from the anchor date through at least 1 year past today, so this
  // never runs out and "gets stuck" on a final period — recomputed fresh on every load.
  const periods = [];
  let s = new Date(Date.UTC(2025,11,21)); // Dec 21, 2025 — the confirmed real anchor date
  const horizon = new Date(); horizon.setUTCFullYear(horizon.getUTCFullYear()+1);
  let i = 0;
  while(s <= horizon){
    const e = new Date(s); e.setUTCDate(e.getUTCDate()+13);
    periods.push({n:i+1, start:new Date(s), end:new Date(e)});
    s = new Date(e); s.setUTCDate(s.getUTCDate()+1);
    i++;
  }
  return periods;
}
const PAY_PERIODS = buildPayPeriods();
let leaderboardPeriodIdx = null; // null = auto (current)

function ymd(d){ return d.toISOString().slice(0,10); }
function parseYmd(s){ const [y,m,d] = (s||'').slice(0,10).split('-').map(Number); return new Date(Date.UTC(y||2000,(m||1)-1,d||1)); }

function currentPeriodIndex(){
  const today = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  for(let i=0;i<PAY_PERIODS.length;i++){ if(today>=PAY_PERIODS[i].start && today<=PAY_PERIODS[i].end) return i; }
  return today < PAY_PERIODS[0].start ? 0 : PAY_PERIODS.length-1;
}

function tierFor(demos){ return TIERS.find(t=>demos>=t.min && demos<=t.max) || TIERS[TIERS.length-1]; }
function bonusFor(net){ if(net<30000) return null; return BONUS_TIERS.find(b=>net>=b.min && net<=b.max) || BONUS_TIERS[BONUS_TIERS.length-1]; }

function isSaleDisp(di){ return (di||'').startsWith('Sale'); }
function isNetSaleDisp(di){ return di==='Sale' || di==='Sale (WIP)'; }

function leadsInRange(rows, start, end){
  return rows.filter(r=>{ const d = parseYmd(r.d); return d>=start && d<=end; });
}

function computeCanvasserBoard(canvasser, period){
  const periodRows = leadsInRange(DATA.filter(r=>r.cv===canvasser), period.start, period.end);
  const dns = periodRows.filter(r=>r.di==='Demo No Sale').length;
  const sales = periodRows.filter(r=>isSaleDisp(r.di)).length;
  const demos = dns + sales;
  const tier = tierFor(demos);
  const commission = dns*tier.dns + sales*tier.sale;
  const nextTier = TIERS.find(t=>t.min > tier.max);

  // Net sales + bonus: for a real pay period, use the calendar month it falls in (bonus is monthly).
  // For a custom range, use that exact range instead — bonus tiers still applied for a quick "if this were the month" read.
  let netRows;
  if(period.isCustom){
    netRows = periodRows;
  } else {
    const monthStart = new Date(Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth()+1, 0));
    netRows = leadsInRange(DATA.filter(r=>r.cv===canvasser), monthStart, monthEnd);
  }
  const netThisMonth = netRows.filter(r=>isSaleDisp(r.di)).reduce((s,r)=>s+netAmountFor(r),0);
  const bonus = bonusFor(netThisMonth);
  const nextBonus = BONUS_TIERS.find(b=>b.min > (bonus?bonus.max:29999));

  const setting = SETTINGS.find(s=>s.cv===canvasser) || {lifetimeNet:0};
  const netIncludingThisMonth = setting.lifetimeNet; // manually maintained running total, see note in UI
  const raisesEarned = Math.min(Math.floor(netIncludingThisMonth/RAISE_PER_NET), RAISE_CAP_RATE-RAISE_START_RATE);
  const currentRate = Math.min(RAISE_START_RATE + raisesEarned, RAISE_CAP_RATE);
  const nextRaiseAt = (raisesEarned+RAISE_START_RATE < RAISE_CAP_RATE) ? (Math.floor(netIncludingThisMonth/RAISE_PER_NET)+1)*RAISE_PER_NET : null;
  const netRemainingToRaise = nextRaiseAt ? nextRaiseAt - netIncludingThisMonth : 0;

  return { canvasser, dns, sales, demos, tier, commission, nextTier,
    netThisMonth, bonus, nextBonus,
    lifetimeNet: netIncludingThisMonth, currentRate, nextRaiseAt, netRemainingToRaise };
}

let showArchived = false;
let expandedCanvasser = null;

function isActiveCanvasser(cv){
  const s = SETTINGS.find(x=>x.cv===cv);
  return s ? s.active : true; // no settings row yet = active by default
}

let lbRangeFrom = '';
let lbRangeTo = '';

function renderLeaderboard(){
  const box = document.getElementById('leaderboardBody');
  if(leaderboardPeriodIdx===null) leaderboardPeriodIdx = currentPeriodIndex();
  const rangeActive = lbRangeFrom || lbRangeTo;
  const period = rangeActive
    ? { start: lbRangeFrom?parseYmd(lbRangeFrom):new Date(Date.UTC(2000,0,1)), end: lbRangeTo?parseYmd(lbRangeTo):new Date(Date.UTC(2100,0,1)), isCustom:true }
    : PAY_PERIODS[leaderboardPeriodIdx];
  const allCanvassers = viewFilter ? [viewFilter] : [...new Set(DATA.map(r=>r.cv))].sort();
  const canvassers = viewFilter ? allCanvassers : allCanvassers.filter(cv => showArchived ? !isActiveCanvasser(cv) : isActiveCanvasser(cv));

  const periodOptions = PAY_PERIODS.map((p,i)=>`<option value="${i}" ${i===leaderboardPeriodIdx?'selected':''}>Period ${p.n}: ${ymd(p.start)} – ${ymd(p.end)}${i===currentPeriodIndex()?' (current)':''}</option>`).join('');
  const nav = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;${rangeActive?'opacity:.4;pointer-events:none':''}">
    <button class="btn sm" onclick="leaderboardPeriodIdx=Math.max(0,leaderboardPeriodIdx-1); renderLeaderboard()">&larr;</button>
    <select onchange="leaderboardPeriodIdx=parseInt(this.value); renderLeaderboard()" style="font-size:12.5px">${periodOptions}</select>
    <button class="btn sm" onclick="leaderboardPeriodIdx=Math.min(${PAY_PERIODS.length-1},leaderboardPeriodIdx+1); renderLeaderboard()">&rarr;</button>
    ${leaderboardPeriodIdx!==currentPeriodIndex() ? `<button class="btn sm" onclick="leaderboardPeriodIdx=null; renderLeaderboard()">Jump to current</button>` : ''}
  </div>
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <span class="note" style="margin:0">Or custom range:</span>
    <input type="date" value="${lbRangeFrom}" onchange="lbRangeFrom=this.value; renderLeaderboard()" style="font-size:12.5px">
    <span class="note" style="margin:0">to</span>
    <input type="date" value="${lbRangeTo}" onchange="lbRangeTo=this.value; renderLeaderboard()" style="font-size:12.5px">
    ${rangeActive ? `<button class="btn sm" onclick="lbRangeFrom='';lbRangeTo='';renderLeaderboard()">Clear range</button>` : ''}
    <div class="spacer"></div>
    ${!viewFilter ? `<label class="note" style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" ${showArchived?'checked':''} onchange="showArchived=this.checked; renderLeaderboard()"> Show archived</label>` : ''}
  </div>
  ${rangeActive ? `<p class="note" style="margin:0 0 10px">Showing ${lbRangeFrom||'the beginning'} to ${lbRangeTo||'now'} — tier/commission math applies the same way across this range, and "net" below is the net sales within this exact range (not a calendar month).</p>` : ''}`;

  const rows = canvassers.map(cv=>{
    const b = computeCanvasserBoard(cv, period);
    const open = expandedCanvasser === cv;
    const active = isActiveCanvasser(cv);
    const summary = `<div class="logitem" style="cursor:pointer;margin-bottom:${open?'0':'6px'};${open?'border-radius:8px 8px 0 0':''}" onclick="expandedCanvasser=expandedCanvasser==='${esc(cv)}'?null:'${esc(cv)}'; renderLeaderboard()">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b style="font-size:13.5px">${esc(cv)}</b>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="pill info">${b.tier.label}</span>
          <span style="font-size:12.5px;font-weight:600">${fmtMoney(b.commission)}</span>
          <span style="font-size:11px;color:var(--mut)">${open?'▲':'▼'}</span>
        </div>
      </div>
      <div class="meta">${b.dns} DNS + ${b.sales} Sale${b.sales===1?'':'s'} = ${b.demos} Demos &middot; ${period.isCustom?'Net in range':'Net this month'} ${fmtMoney(b.netThisMonth)} &middot; $${b.currentRate}/hr</div>
    </div>`;

    if(!open) return summary;

    const tierPct = b.nextTier ? Math.min(100, Math.round(b.demos/b.nextTier.min*100)) : 100;
    const bonusPct = b.nextBonus ? Math.min(100, Math.round(b.netThisMonth/b.nextBonus.min*100)) : 100;
    const raisePct = b.nextRaiseAt ? Math.min(100, Math.round(b.lifetimeNet/b.nextRaiseAt*100)) : 100;
    const detail = `<div style="border:1px solid var(--bd);border-top:none;border-radius:0 0 8px 8px;padding:.8rem 1rem;margin-bottom:6px">
      ${b.nextTier ? `<div style="background:var(--bg);border-radius:6px;height:6px;margin-bottom:6px"><div style="background:var(--info);width:${tierPct}%;height:6px;border-radius:6px"></div></div><p class="note" style="margin:0 0 10px">${b.nextTier.min-b.demos} more Demo${b.nextTier.min-b.demos===1?'':'s'} to ${b.nextTier.label}</p>` : `<p class="note" style="margin:0 0 10px;color:var(--sale)">Top tier reached</p>`}

      <div style="font-size:12.5px;color:var(--tx2);margin-bottom:4px">Bonus: <b style="color:var(--tx)">${b.bonus?fmtMoney(b.bonus.amt):'$0'}</b></div>
      ${b.nextBonus ? `<div style="background:var(--bg);border-radius:6px;height:6px;margin-bottom:6px"><div style="background:var(--sale);width:${bonusPct}%;height:6px;border-radius:6px"></div></div><p class="note" style="margin:0 0 10px">${fmtMoney(b.nextBonus.min-b.netThisMonth)} more net to $${b.nextBonus.amt} bonus tier</p>` : `<p class="note" style="margin:0 0 10px;color:var(--sale)">Max bonus tier reached</p>`}

      <div style="font-size:12.5px;color:var(--tx2);margin-bottom:4px">Lifetime net sales: <input type="text" id="lt_${esc(cv)}" value="${b.lifetimeNet}" style="width:90px;padding:3px 6px;border:1px solid var(--bd);border-radius:6px;background:var(--card);color:var(--tx);font-size:12px"> <button class="btn sm" onclick="saveLifetimeNet('${esc(cv)}')">Save</button></div>
      ${b.nextRaiseAt ? `<div style="background:var(--bg);border-radius:6px;height:6px"><div style="background:var(--pur);width:${raisePct}%;height:6px;border-radius:6px"></div></div><p class="note" style="margin:4px 0 10px">${fmtMoney(b.netRemainingToRaise)} more lifetime net to $${b.currentRate+1}/hr</p>` : `<p class="note" style="margin:4px 0 10px;color:var(--sale)">Pay cap reached ($${RAISE_CAP_RATE}/hr)</p>`}

      ${!viewFilter ? aliasEditorHtml(cv) : ''}

      ${!viewFilter ? `<button class="btn sm" onclick="toggleActive('${esc(cv)}', ${active})">${active ? 'Archive this canvasser' : 'Reactivate this canvasser'}</button>` : ''}
    </div>`;
    return summary + detail;
  }).join('');

  box.innerHTML = nav + (rows || `<p class="note">No ${showArchived?'archived':'active'} canvassers to show.</p>`) + `<p class="note" style="margin-top:8px">Tap a canvasser to expand. "Lifetime net sales" is entered by hand once per canvasser — the app tracks the pay-raise milestone forward from whatever you enter.</p>`;
}

async function saveLifetimeNet(cv){
  const el = document.getElementById('lt_'+cv);
  const val = parseFloat(el.value)||0;
  await api('saveSetting', {cv, lifetimeNet: val});
  const s = SETTINGS.find(x=>x.cv===cv);
  if(s) s.lifetimeNet = val; else SETTINGS.push({cv, lifetimeNet: val, active:true});
  renderLeaderboard();
}

// ----- Canvasser aliases ("Other names for this person") -----
// Lets you merge a GroupMe / sign-up alias (e.g. "dragonchamp98") into the person's LP name
// (e.g. "Roy Compton") from inside the app. Saved to the app's own "Canvasser Settings" tab —
// the Tracker tab is never touched.
function aliasEditorHtml(cv){
  const s = SETTINGS.find(x=>x.cv===cv);
  const current = parseAliases(s && s.aliases);
  const others = [...new Set(DATA.map(r=>r.cv))].filter(n=>n && n!==cv).sort((a,b)=>a.localeCompare(b));
  const chips = current.length
    ? current.map(a=>`<span class="pill info" style="margin:0 6px 6px 0">${a} <a href="#" data-cv="${esc(cv)}" data-alias="${esc(a)}" onclick="removeAlias(this); return false;" style="color:var(--cxl);text-decoration:none;margin-left:4px">✕</a></span>`).join('')
    : '<span class="note" style="margin:0">None yet.</span>';
  return `<div style="border-top:1px solid var(--bd);padding-top:10px;margin:4px 0 10px">
    <div style="font-size:12.5px;color:var(--tx2);margin-bottom:6px">Other names for this person <span class="note" style="margin:0">(GroupMe / sign-up alias — their leads count here)</span></div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:6px">${chips}</div>
    ${others.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <select style="font-size:12.5px;max-width:220px"><option value="">Pick a name to merge in…</option>${others.map(n=>`<option value="${esc(n)}">${n}</option>`).join('')}</select>
      <button class="btn sm primary" data-cv="${esc(cv)}" onclick="addAlias(this)">Add</button>
    </div>` : ''}
  </div>`;
}

async function saveAliases(cv, list){
  const aliases = list.join(', ');
  const res = await api('saveSetting', {cv, aliases});
  if(res && res.ok===false){ alert('Could not save: '+(res.error||'error')); return; }
  const s = SETTINGS.find(x=>x.cv===cv);
  if(s) s.aliases = aliases; else SETTINGS.push({cv, lifetimeNet:0, active:true, notes:'', aliases});
  canonicalizeCanvassers(DATA);
  expandedCanvasser = cv;
  setupViewAs();
  render();
  renderLeaderboard();
}

async function addAlias(btn){
  const cv = btn.dataset.cv;
  const sel = btn.previousElementSibling;
  const alias = sel && sel.value;
  if(!alias) return;
  btn.disabled = true; btn.textContent = 'Saving…';
  // Names already merged INTO the alias come along with it.
  const aliasSetting = SETTINGS.find(x=>x.cv===alias);
  const carried = parseAliases(aliasSetting && aliasSetting.aliases);
  // The raw spellings in the Sheet that currently show as this alias (e.g. different casing).
  const rawSpellings = [...new Set(DATA.filter(r=>r.cv===alias).map(r=>String(r._cvRaw||'').trim()).filter(Boolean))];
  const s = SETTINGS.find(x=>x.cv===cv);
  const list = parseAliases(s && s.aliases);
  [alias, ...rawSpellings, ...carried].forEach(a=>{ if(a.toLowerCase()!==cv.toLowerCase() && !list.some(x=>x.toLowerCase()===a.toLowerCase())) list.push(a); });
  if(aliasSetting && carried.length) await api('saveSetting', {cv: alias, aliases: ''}).then(()=>{ aliasSetting.aliases=''; });
  await saveAliases(cv, list);
}

async function removeAlias(a){
  const cv = a.dataset.cv, alias = a.dataset.alias;
  const s = SETTINGS.find(x=>x.cv===cv);
  const list = parseAliases(s && s.aliases).filter(x=>x!==alias);
  await saveAliases(cv, list);
}

async function toggleActive(cv, wasActive){
  await api('saveSetting', {cv, active: !wasActive});
  const s = SETTINGS.find(x=>x.cv===cv);
  if(s) s.active = !wasActive; else SETTINGS.push({cv, lifetimeNet:0, active: !wasActive});
  expandedCanvasser = null;
  renderLeaderboard();
}

document.getElementById('leaderboardBox').addEventListener('toggle', function(){
  if(this.open) renderLeaderboard();
});
