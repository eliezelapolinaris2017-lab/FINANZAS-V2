/* =========================================================
   Nexus Finance — app.js (Enfocado: guardado, sumas, exportar por fecha)
   - Guardado/Load robusto
   - Dashboard/Reportes con sumas correctas
   - Exportar PDF por rango de fechas (jsPDF)
   - Login/PIN visible y estable
   - No se modifica ni amplía la parte de nómina (queda como antes)
   ========================================================= */

/* ===================== Helpers básicos ===================== */
const STORAGE_KEY = 'finanzas-state-v11';
const LOCK_KEY = 'finanzas-lock-v3';

const DEFAULT_STATE = {
  settings: {
    businessName: 'Mi Negocio',
    logoBase64: '',
    theme: { primary: '#0B0D10', accent: '#C7A24B', text: '#F2F3F5' },
    pinHash: '',
    currency: 'USD'
  },
  expensesDaily: [],
  incomesDaily: [],
  payments: [],
  ordinary: [],
  budgets: [],
  personal: [],
  invoices: [],
  quotes: [],
  reconciliations: [],
  retenciones: [], // opcional, por si se usa más adelante
  _cloud: { updatedAt: 0 }
};

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const clone = o => JSON.parse(JSON.stringify(o));
const todayStr = () => new Date().toISOString().slice(0,10);
const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36);
const toDate = s => new Date(s);
const byDateDesc = (a,b) => (+toDate(b.date||'1970-01-01')) - (+toDate(a.date||'1970-01-01'));

function safeNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmt(n){
  const cur = (state && state.settings && state.settings.currency) ? state.settings.currency : 'USD';
  const val = Number(n||0);
  try{ return new Intl.NumberFormat('es-PR',{style:'currency',currency:cur}).format(val); }
  catch{ return `${cur} ${val.toFixed(2)}`; }
}
function toast(msg){
  const c = $('#toastContainer');
  if(!c){ console.log('[Toast]', msg); return; }
  const t = document.createElement('div'); t.className='toast'; t.textContent=msg; c.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 2200);
}

/* ===================== Load / Save ===================== */
function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) { localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE)); return clone(DEFAULT_STATE); }
  try{
    const st = JSON.parse(raw);
    // llenar keys faltantes
    for(const k of Object.keys(DEFAULT_STATE)) if(!(k in st)) st[k] = clone(DEFAULT_STATE[k]);
    return st;
  }catch(e){
    console.warn('Error parseando estado, restaurando por defecto', e);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE));
    return clone(DEFAULT_STATE);
  }
}
let state = loadState();

function saveState({skipRefresh=false} = {}){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if(!skipRefresh) refreshAll();
  }catch(e){
    console.error('Error guardando estado', e);
    toast('Error guardando datos');
  }
}

/* ===================== Tema / UI global ===================== */
function applyTheme(){
  const r = document.documentElement;
  r.style.setProperty('--primary', state.settings.theme.primary);
  r.style.setProperty('--accent', state.settings.theme.accent);
  r.style.setProperty('--text', state.settings.theme.text);
  const bn = $('#brandName'); if(bn) bn.textContent = state.settings.businessName || 'Mi Negocio';
  ['brandLogo','logoPreview'].forEach(id=>{ const el=$('#'+id); if(el) el.src = state.settings.logoBase64 || 'assets/logo.png'; });
}

function showView(id){
  $$('.view').forEach(v=>{ if(v.id!=='login') v.classList.remove('visible'); });
  const t = $('#'+id) || $('#home');
  if(t && t.id!=='login') t.classList.add('visible');
  $$('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.target===id));
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ===================== Login / PIN ===================== */
const MAX_ATTEMPTS = 5;
const attempts = () => Number(localStorage.getItem(LOCK_KEY)||0);
const setAttempts = n => localStorage.setItem(LOCK_KEY, String(n));
const attemptsLeft = () => Math.max(0, MAX_ATTEMPTS - attempts());

async function sha256(msg){
  const enc = new TextEncoder().encode(msg);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function forceShowLogin(){
  $$('.view.visible').forEach(v=> v.classList.remove('visible'));
  const box = $('#login'); if(!box) return;
  box.style.display='block'; box.classList.add('visible'); box.removeAttribute('aria-hidden');
  document.body.classList.add('modal-open');
}
function closeLogin(){
  const box = $('#login'); if(!box) return;
  box.classList.remove('visible'); box.style.display='none'; box.setAttribute('aria-hidden','true');
  document.body.classList.remove('modal-open');
}

async function handleLogin(ev){
  if(ev) ev.preventDefault();
  const createMode = !state.settings.pinHash;
  const pinEl = $('#loginPIN');
  const pin2El = $('#loginPIN2');
  const pin = (pinEl?.value || '').trim();
  const pin2 = (pin2El?.value || '').trim();
  if(!pin){ toast('Introduce tu PIN'); pinEl?.focus(); return; }
  if(createMode){
    if(pin.length<4 || pin.length>8){ toast('El PIN debe tener entre 4 y 8 dígitos'); return; }
    if(pin!==pin2){ toast('Los PIN no coinciden'); return; }
    state.settings.pinHash = await sha256(pin);
    saveState(); toast('PIN creado'); closeLogin(); showView('home'); return;
  }
  if(attempts() >= MAX_ATTEMPTS){ toast('Has alcanzado el máximo de intentos'); return; }
  const ok = (await sha256(pin)) === state.settings.pinHash;
  if(ok){ setAttempts(0); toast('Bienvenido'); closeLogin(); showView('home'); }
  else { setAttempts(attempts()+1); updateLoginUI(); toast(`PIN incorrecto. Intentos restantes: ${attemptsLeft()}`); }
}

function updateLoginUI(){
  const createMode = !state.settings.pinHash;
  $('#loginTitle') && ($('#loginTitle').textContent = createMode ? 'Crear PIN' : 'Ingresar PIN');
  $('#loginHint') && ($('#loginHint').textContent = createMode ? 'Crea un PIN de 4–8 dígitos.' : 'Introduce tu PIN.');
  const pin2Wrap = $('#loginPIN2Wrap') || $('#loginPIN2')?.parentElement;
  if(pin2Wrap && pin2Wrap instanceof HTMLElement) pin2Wrap.style.display = createMode ? 'block' : 'none';
  $('#loginAttempts') && ($('#loginAttempts').textContent = createMode ? '' : `Intentos restantes: ${attemptsLeft()}`);
  if($('#loginBtn') && !$('#loginBtn')._bound){ $('#loginBtn').addEventListener('click', handleLogin); $('#loginBtn')._bound=true; }
  if($('#loginForm') && !$('#loginForm')._bound){ $('#loginForm').addEventListener('submit', handleLogin); $('#loginForm')._bound=true; }
  const pinEl = $('#loginPIN');
  if(pinEl && !pinEl._bound){ pinEl.addEventListener('keydown', e=>{ if(e.key==='Enter') handleLogin(e); }); pinEl._bound = true; }
  if(pinEl){ pinEl.value=''; setTimeout(()=>pinEl.focus(),50); }
  requestAnimationFrame(()=>{ forceShowLogin(); });
}

/* ===================== Catálogos simples ===================== */
const EXPENSE_CATEGORIES = [
  "Gasolina","Comida","Transporte","Mantenimiento","Renta/Alquiler",
  "Servicios (Luz/Agua/Internet)","Insumos","Nómina","Impuestos","Herramientas",
  "Publicidad/Marketing","Viajes","Papelería","Licencias y Software","Seguros",
  "Equipos","Materiales","Otros","Retención 408","Retención SS"
];
const PAYMENT_METHODS = ["Efectivo","Tarjeta","Cheque","ATH Móvil","Transferencia","Salón ingreso","Otras"];

function upsertOptions(selectEl, items){
  if(!selectEl) return;
  const existing = new Set(Array.from(selectEl.options).map(o => (o.value||'').trim()));
  items.forEach(txt=>{
    if(!existing.has(txt)){
      const opt = document.createElement('option');
      opt.value = txt; opt.textContent = txt;
      selectEl.appendChild(opt);
    }
  });
}
function initCatalogs(){
  upsertOptions($('#expCategory'), EXPENSE_CATEGORIES);
  upsertOptions($('#expMethod'), PAYMENT_METHODS);
  upsertOptions($('#incMethod'), PAYMENT_METHODS);
  upsertOptions($('#invMethod'), PAYMENT_METHODS);
  upsertOptions($('#quoMethod'), PAYMENT_METHODS);
}

/* ===================== Render Gastos ===================== */
function inRange(d, from, to){
  const t = +toDate(d||'1970-01-01');
  if(from && t < +toDate(from)) return false;
  if(to   && t > (+toDate(to) + 86400000 - 1)) return false;
  return true;
}

function renderExpenses(){
  const tbody = $('#expensesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from = $('#fExpFrom')?.value, to = $('#fExpTo')?.value;
  let total = 0; const cats = {};
  state.expensesDaily.filter(e=>inRange(e.date, from, to)).sort(byDateDesc).forEach(e=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date||''}</td><td>${e.category||''}</td><td>${e.desc||''}</td>
      <td>${e.method||''}</td><td>${e.ref||''}</td><td>${fmt(e.amount)}</td><td>${e.note||''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${e.id}">Editar</button>
        <button class="btn-outline" data-del="${e.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
    total += safeNum(e.amount);
    cats[e.category] = (cats[e.category]||0) + safeNum(e.amount);
  });
  $('#expSumTotal') && ($('#expSumTotal').textContent = fmt(total));
  const pills = $('#expSumPills'); 
  if(pills){ pills.innerHTML=''; Object.entries(cats).forEach(([k,v])=>{ const s=document.createElement('span'); s.className='pill'; s.textContent=`${k}: ${fmt(v)}`; pills.appendChild(s); }); }
  $$('#expensesTable [data-del]').forEach(b=> b.onclick=()=>{ state.expensesDaily = state.expensesDaily.filter(x=>x.id!==b.dataset.del); saveState(); toast('Gasto eliminado'); });
  $$('#expensesTable [data-edit]').forEach(b=> b.onclick=()=> editExpense(b.dataset.edit));
}
function editExpense(id){
  const i = state.expensesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const e = state.expensesDaily[i];
  let r = prompt('Fecha (YYYY-MM-DD)', e.date||todayStr()); if(r===null) return; e.date = r||e.date;
  r = prompt('Categoría', e.category||''); if(r===null) return; e.category = r||e.category;
  r = prompt('Descripción', e.desc||''); if(r===null) return; e.desc = r||e.desc;
  r = prompt('Método', e.method||''); if(r===null) return; e.method = r||e.method;
  r = prompt('Referencia', e.ref||''); if(r===null) return; e.ref = r||e.ref;
  r = prompt('Monto', String(e.amount||0)); if(r===null) return; e.amount = safeNum(r);
  r = prompt('Nota', e.note||''); if(r===null) return; e.note = r||e.note;
  saveState(); toast('Gasto actualizado');
}
function wireExpenses(){
  $('#expenseForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: $('#expDate')?.value || todayStr(),
      category: $('#expCategory')?.value || 'Otros',
      desc: $('#expDesc')?.value || '',
      amount: safeNum($('#expAmount')?.value),
      method: $('#expMethod')?.value || '',
      ref: $('#expRef')?.value || '',
      note: $('#expNote')?.value || ''
    };
    if(!rec.date) return toast('Fecha requerida');
    state.expensesDaily.push(rec); saveState(); toast('Gasto guardado'); ev.target.reset();
  });
  $('#fExpApply')?.addEventListener('click', renderExpenses);
  $('#addExpense')?.addEventListener('click', ()=>{ if($('#expDate')) $('#expDate').value=todayStr(); $('#expAmount')?.focus(); });
}

/* ===================== Render Ingresos ===================== */
function renderIncomes(){
  const tbody = $('#incomesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from = $('#fIncFrom')?.value, to = $('#fIncTo')?.value;
  let total = 0;
  const totalsByMethod = {};
  state.incomesDaily.filter(r=>inRange(r.date, from, to)).sort(byDateDesc).forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date||''}</td><td>${r.client||''}</td><td>${r.method||''}</td>
      <td>${r.ref||''}</td><td>${fmt(r.amount)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${r.id}">Editar</button>
        <button class="btn-outline" data-del="${r.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
    total += safeNum(r.amount);
    totalsByMethod[r.method] = (totalsByMethod[r.method]||0) + safeNum(r.amount);
  });
  $('#incSumTotal') && ($('#incSumTotal').textContent = fmt(total));
  const methodWrap = $('#incSumMethods');
  if(methodWrap){
    methodWrap.innerHTML=''; Object.entries(totalsByMethod).forEach(([m,v])=>{
      const sp=document.createElement('span'); sp.className='pill'; sp.textContent=`${m}: ${fmt(v)}`; methodWrap.appendChild(sp);
    });
  }
  $$('#incomesTable [data-del]').forEach(b=> b.onclick=()=>{ state.incomesDaily = state.incomesDaily.filter(x=>x.id!==b.dataset.del); saveState(); toast('Ingreso eliminado'); });
  $$('#incomesTable [data-edit]').forEach(b=> b.onclick=()=> editIncome(b.dataset.edit));
}
function editIncome(id){
  const i = state.incomesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const r0 = state.incomesDaily[i];
  let r = prompt('Fecha (YYYY-MM-DD)', r0.date||todayStr()); if(r===null) return; r0.date = r||r0.date;
  r = prompt('Cliente/Origen', r0.client||''); if(r===null) return; r0.client = r||r0.client;
  r = prompt('Método', r0.method||''); if(r===null) return; r0.method = r||r0.method;
  r = prompt('Referencia', r0.ref||''); if(r===null) return; r0.ref = r||r0.ref;
  r = prompt('Monto', String(r0.amount||0)); if(r===null) return; r0.amount = safeNum(r);
  saveState(); toast('Ingreso actualizado');
}
function wireIncomes(){
  $('#incomeForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec = {
      id: uid(),
      date: $('#incDate')?.value || todayStr(),
      client: $('#incClient')?.value || '',
      method: $('#incMethod')?.value || 'Otras',
      ref: $('#incRef')?.value || '',
      amount: safeNum($('#incAmount')?.value)
    };
    if(!rec.date) return toast('Fecha requerida');
    state.incomesDaily.push(rec); saveState(); toast('Ingreso guardado'); ev.target.reset();
  });
  $('#fIncApply')?.addEventListener('click', renderIncomes);
  $('#addIncome')?.addEventListener('click', ()=>{ if($('#incDate')) $('#incDate').value=todayStr(); $('#incAmount')?.focus(); });
}

/* ===================== Reportes / Dashboard ===================== */
function sumRange(list, from, to){
  if(!Array.isArray(list)) return 0;
  return list.filter(r=>inRange(r.date, from, to)).reduce((a,b)=>a + safeNum(b.amount||0), 0);
}
function sumExpensesDailySplit(from, to){
  let recurrent=0, nonRec=0;
  const isRec = e => (e.method === 'Automático' || (e.desc||'').toLowerCase().startsWith('recurrente'));
  state.expensesDaily.filter(e=>inRange(e.date, from, to)).forEach(e=>{
    const amt = safeNum(e.amount);
    if(isRec(e)) recurrent += amt; else nonRec += amt;
  });
  return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec };
}
function sumPaymentsRange(from,to){ return state.payments.filter(p=>inRange(p.date,from,to)).reduce((a,b)=>a+safeNum(b.amount||0),0); }
function sumPersonalRange(from,to){ return state.personal.filter(p=>inRange(p.date,from,to)).reduce((a,b)=>a+safeNum(b.amount||0),0); }

function renderReports(){
  const now = new Date(); const today = now.toISOString().slice(0,10);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
  const weekStart = (()=>{ const x=new Date(now); const day=x.getDay()||7; x.setDate(x.getDate()-day+1); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); })();

  const incToday = sumRange(state.incomesDaily, today, today);
  const incWeek = sumRange(state.incomesDaily, weekStart, today);
  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const incYear = sumRange(state.incomesDaily, yearStart, today);

  const expTodaySplit = sumExpensesDailySplit(today,today);
  const expWeekSplit  = sumExpensesDailySplit(weekStart,today);
  const expMonthSplit = sumExpensesDailySplit(monthStart,today);
  const expYearSplit  = sumExpensesDailySplit(yearStart,today);

  const perToday = sumPersonalRange(today,today);
  const perWeek  = sumPersonalRange(weekStart,today);
  const perMonth = sumPersonalRange(monthStart,today);
  const perYear  = sumPersonalRange(yearStart,today);

  const payToday = sumPaymentsRange(today,today);
  const payWeek  = sumPaymentsRange(weekStart,today);
  const payMonth = sumPaymentsRange(monthStart,today);
  const payYear  = sumPaymentsRange(yearStart,today);

  const expToday = expTodaySplit.total + perToday + payToday;
  const expWeek  = expWeekSplit.total + perWeek + payWeek;
  const expMonth = expMonthSplit.total + perMonth + payMonth;
  const expYear  = expYearSplit.total + perYear + payYear;

  $('#rToday') && ($('#rToday').textContent = `${fmt(incToday)} / ${fmt(expToday)}`);
  $('#rWeek')  && ($('#rWeek').textContent = `${fmt(incWeek)} / ${fmt(expWeek)}`);
  $('#rMonth') && ($('#rMonth').textContent = `${fmt(incMonth)} / ${fmt(expMonth)}`);
  $('#rYear')  && ($('#rYear').textContent = `${fmt(incYear)} / ${fmt(expYear)}`);
}

function renderHome(){
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const today = now.toISOString().slice(0,10);
  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const expSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const totalExp = expSplit.total + perMonth + payMonth;
  const balance = incMonth - totalExp;
  $('#kpiIncomesMonth') && ($('#kpiIncomesMonth').textContent = fmt(incMonth));
  $('#kpiExpensesMonth') && ($('#kpiExpensesMonth').textContent = fmt(totalExp));
  $('#kpiBalanceMonth') && ($('#kpiBalanceMonth').textContent = fmt(balance));

  // gráfico sencillo (canvas)
  const c = $('#chart12'); if(!c) return;
  const ctx = c.getContext('2d');
  c.width = c.clientWidth; c.height = 180; ctx.clearRect(0,0,c.width,c.height);
  const months=[], inc=[], exp=[];
  for(let i=11;i>=0;i--){
    const d=new Date(now.getFullYear(), now.getMonth()-i, 1);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10);
    const to = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
    months.push(d.toLocaleDateString('es-ES',{month:'short'}));
    inc.push(sumRange(state.incomesDaily, from, to));
    const s = sumExpensesDailySplit(from, to);
    exp.push(s.total + sumPersonalRange(from,to) + sumPaymentsRange(from,to));
  }
  const max = Math.max(...inc, ...exp, 1);
  const barW = Math.floor((c.width-40) / (months.length*2));
  months.forEach((m,idx)=>{
    const x = idx*(barW*2) + 20;
    const hI = Math.round((inc[idx]/max)*(c.height-30));
    const hE = Math.round((exp[idx]/max)*(c.height-30));
    ctx.fillStyle = state.settings.theme.accent || '#C7A24B'; ctx.fillRect(x, c.height-10-hI, barW, hI);
    ctx.fillStyle = '#555'; ctx.fillRect(x+barW+4, c.height-10-hE, barW, hE);
    ctx.fillStyle = '#aaa'; ctx.font = '12px system-ui'; ctx.fillText(m, x, c.height-2);
  });
}

/* ===================== Exportar / jsPDF con rango ===================== */
let jsPDFReady=false;
async function ensureJsPDF(){
  if(jsPDFReady) return;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
  jsPDFReady=true;
}

/**
 * generatePDF(view, from, to)
 * - view: 'expenses'|'incomes'|'payments'|'personal'|'invoices'|'quotes'...
 * - from/to: optional 'YYYY-MM-DD' strings to filter rows
 */
async function generatePDF(view="expenses", from=null, to=null){
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  const business = state.settings.businessName || 'Mi Negocio';
  const logo = state.settings.logoBase64;

  function header(title){
    try{ if(logo && logo.startsWith('data:')) doc.addImage(logo,'PNG',14,10,24,24);}catch(e){}
    doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.text(business,42,18);
    doc.setFontSize(12); doc.text(title,42,26); doc.line(14,36,200,36);
  }
  function table(headers, rows, startY=42){
    let y = startY; const colW = 180 / headers.length;
    doc.setFont("helvetica","bold"); doc.setFontSize(10);
    headers.forEach((h,i)=> doc.text(String(h), 14 + i*colW, y));
    y += 6; doc.line(14,y,200,y); y+=6; doc.setFont("helvetica","normal");
    rows.forEach(r=>{
      r.forEach((c,i)=> doc.text(String(c||'').slice(0,40), 14 + i*colW, y));
      y+=6; if(y>280){ doc.addPage(); y=20; }
    });
    return y;
  }

  const titleMap = { expenses:"GASTOS", incomes:"INGRESOS", payments:"PAGO DE NÓMINA", personal:"GASTOS PERSONALES", invoices:"FACTURAS", quotes:"COTIZACIONES", reconciliations:"CONCILIACIÓN" };
  const title = titleMap[view] || view.toUpperCase();
  header(title);

  let headers = [], rows = [], total = null;
  if(view === "expenses"){
    headers = ["Fecha","Categoría","Descripción","Método","Ref","Monto"];
    rows = state.expensesDaily.filter(r=>inRange(r.date, from, to)).map(e=>[e.date,e.category,e.desc,e.method,e.ref, Number(e.amount||0).toFixed(2)]);
    total = state.expensesDaily.filter(r=>inRange(r.date, from, to)).reduce((a,e)=>a+safeNum(e.amount),0);
  } else if(view === "incomes"){
    headers = ["Fecha","Cliente","Método","Ref","Monto"];
    rows = state.incomesDaily.filter(r=>inRange(r.date, from, to)).map(i=>[i.date,i.client,i.method,i.ref, Number(i.amount||0).toFixed(2)]);
    total = state.incomesDaily.filter(r=>inRange(r.date, from, to)).reduce((a,i)=>a+safeNum(i.amount),0);
  } else if(view === "personal"){
    headers = ["Fecha","Categoría","Descripción","Monto"];
    rows = state.personal.filter(r=>inRange(r.date, from, to)).map(p=>[p.date,p.category,p.desc, Number(p.amount||0).toFixed(2)]);
    total = state.personal.filter(r=>inRange(r.date, from, to)).reduce((a,p)=>a+safeNum(p.amount),0);
  } else if(view === "payments"){
    headers = ["Fecha","Empleado/Benef.","Categoría","Neto","Estado"];
    rows = state.payments.filter(r=>inRange(r.date, from, to)).map(p=>[p.date,p.to,p.category, Number(p.amount||0).toFixed(2), p.status]);
    total = state.payments.filter(r=>inRange(r.date, from, to)).reduce((a,p)=>a+safeNum(p.amount),0);
  } else if(view === "invoices"){
    headers = ["Fecha","#","Cliente","Total","Método"];
    rows = state.invoices.filter(r=>inRange(r.date, from, to)).map(f=>[f.date,f.number,f.client?.name||'', Number(f.total||0).toFixed(2), f.method||'']);
    total = state.invoices.filter(r=>inRange(r.date, from, to)).reduce((a,f)=>a+safeNum(f.total),0);
  } else {
    headers = ["Fecha","Detalle"]; rows = []; total = 0;
  }

  let y = table(headers, rows, 42);
  if(total !== null){
    if(y+10 > 290){ doc.addPage(); y = 20; }
    doc.line(14,y,200,y); y += 7; doc.setFont("helvetica","bold"); doc.text("TOTAL", 154, y); doc.text(fmt(total), 200, y, {align:'right'});
  }

  const fileName = `${(business||'Negocio').replace(/\s+/g,'_')}_${title}_${from||'all'}.pdf`.replace(/[:/\\]/g,'_');
  doc.save(fileName);
}

/* Ayuda: pedir rango al usuario */
function askDateRange(){
  const from = prompt('Fecha desde (YYYY-MM-DD) — dejar vacío = sin filtro');
  if(from === null) return null; // cancel
  const to = prompt('Fecha hasta (YYYY-MM-DD) — dejar vacío = sin filtro');
  if(to === null) return null;
  const f = (from||'').trim() || null;
  const t = (to||'').trim() || null;
  return { from: f, to: t };
}

/* Wiring: botones de Exportar en la UI (usarán prompt para rango) */
function wireExports(){
  $$('[data-print-view]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const view = b.dataset.printView;
      const r = confirm('¿Exportar todo (Aceptar) o elegir un rango de fechas (Cancelar)?');
      if(r){
        generatePDF(view);
      }else{
        const range = askDateRange();
        if(range) generatePDF(view, range.from, range.to);
      }
    });
  });
  $('#printBtn')?.addEventListener('click', ()=>{
    const current = document.querySelector('.view.visible')?.id || 'home';
    if(current==='home'){ toast('Selecciona una vista exportable en Exportaciones'); return; }
    const r = confirm('Exportar todo (Aceptar) o elegir rango de fechas (Cancelar)?');
    if(r) generatePDF(current);
    else{
      const range = askDateRange();
      if(range) generatePDF(current, range.from, range.to);
    }
  });
}

/* ===================== Configuración básica UI ===================== */
function wireSettings(){
  $('#saveSettings')?.addEventListener('click', ()=>{
    state.settings.businessName = $('#setName')?.value || state.settings.businessName;
    state.settings.currency = $('#setCurrency')?.value || state.settings.currency;
    state.settings.theme.primary = $('#colorPrimary')?.value || state.settings.theme.primary;
    state.settings.theme.accent  = $('#colorAccent')?.value || state.settings.theme.accent;
    state.settings.theme.text    = $('#colorText')?.value || state.settings.theme.text;
    saveState();
    toast('Configuración guardada');
  });
  $('#setLogo')?.addEventListener('change', async (ev)=>{
    const f = ev.target.files[0]; if(!f) return;
    const base64 = await new Promise((res,rej)=>{ const fr = new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f); });
    state.settings.logoBase64 = base64; saveState(); toast('Logo actualizado');
  });
  $('#delLogo')?.addEventListener('click', ()=>{ state.settings.logoBase64=''; saveState(); toast('Logo eliminado'); });
  $('#exportJSON')?.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'finanzas-backup.json'; a.click(); URL.revokeObjectURL(a.href);
    toast('JSON exportado');
  });
  $('#importJSON')?.addEventListener('change', (ev)=>{ const f = ev.target.files[0]; if(!f) return importJSON(f); });
  $('#changePIN')?.addEventListener('click', async ()=>{
    const old = $('#pinOld')?.value || ''; const n1 = $('#pinNew')?.value || ''; const n2 = $('#pinNew2')?.value || '';
    if(!state.settings.pinHash) return toast('Primero crea un PIN');
    const hashOld = await sha256(old||''); if(hashOld !== state.settings.pinHash) return toast('PIN actual incorrecto');
    if(n1 !== n2 || (n1||'').length<4 || (n1||'').length>8) return toast('Nuevo PIN inválido');
    state.settings.pinHash = await sha256(n1); saveState(); toast('PIN actualizado'); ['pinOld','pinNew','pinNew2'].forEach(id=>{ const el = $('#'+id); if(el) el.value=''; });
  });
}

/* Import JSON */
function importJSON(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const incoming = JSON.parse(reader.result);
      if(confirm('¿Reemplazar TODO con el archivo? (Aceptar=Reemplazar, Cancelar=Fusionar)')){
        state = incoming; saveState(); location.reload();
      }else{
        state.settings = Object.assign({}, state.settings, incoming.settings||{});
        ['expensesDaily','incomesDaily','payments','ordinary','budgets','personal','invoices','quotes','reconciliations'].forEach(k=>{
          if(Array.isArray(incoming[k])) state[k] = state[k].concat(incoming[k]);
        });
        saveState(); toast('Datos fusionados'); location.reload();
      }
    }catch(e){ toast('Archivo inválido'); }
  };
  reader.readAsText(file);
}

/* ===================== Conciliación (importe CSV) - funciones ya integradas ===================== */
/* (mantengo las funciones de parse/normalize/detect que tenías; solo wire) */
function detectDelimiter(headerLine){ if(headerLine.includes(';')) return ';'; if(headerLine.includes('\t')) return '\t'; return ','; }
function normalizeAmount(raw){
  if(raw==null) return 0; let s = String(raw).trim(); const isParen = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g,'').replace(/[$€£]/g,'').replace(/\s/g,'');
  if(s.includes(',') && !s.includes('.')) s = s.replace(',','.');
  const n = parseFloat(s); if(Number.isNaN(n)) return 0; return isParen ? -Math.abs(n) : n;
}
function normalizeDate(s, baseYear = (new Date()).getFullYear()){
  if(!s) return ''; s = String(s).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){ let M=parseInt(m[1],10), d=parseInt(m[2],10), y=parseInt(m[3],10); if(y<100) y+=2000; return `${y}-${String(M).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  const dt = new Date(s); if(!isNaN(+dt)) return dt.toISOString().slice(0,10); return '';
}
function parseCSV(text, yearBase){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0); if(lines.length===0) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = lines[0].split(delim).map(h=>h.trim().toLowerCase());
  const idxDate = headers.findIndex(h=>/date|fecha/.test(h));
  const idxDesc = headers.findIndex(h=>/desc|concept|detalle|description|descripcion/.test(h));
  const idxAmt  = headers.findIndex(h=>/amount|monto|importe|valor|cantidad/.test(h));
  const idxRef  = headers.findIndex(h=>/ref|referencia|doc|num/i.test(h));
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(delim);
    if(cols.length < 2) continue;
    const date = normalizeDate(cols[idxDate]?.trim(), yearBase);
    const desc = (cols[idxDesc]||'').trim();
    const amount = normalizeAmount(cols[idxAmt]);
    const ref = (idxRef>=0?cols[idxRef]:'')?.trim();
    if(!date || (!desc && amount===0)) continue;
    rows.push({ date, desc, amount, ref });
  }
  return rows;
}
let reconImportRows = [];
function renderReconImportTable(){
  const tb = $('#reconImportTable tbody'); if(!tb) return; tb.innerHTML='';
  let total=0, matches=0, nomatch=0;
  reconImportRows.forEach(r=>{
    total += Number(r.amount||0);
    if(r.match) matches++; else nomatch++;
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td><td>${r.ref||''}</td><td>${r.desc||''}</td><td>${Number(r.amount||0).toFixed(2)}</td><td>${r.match?'Coincide':'Sin coincidencia'}</td><td>${r.match ? (r.match.type+'#'+String(r.match.id).slice(0,6)) : '—'}</td>`;
    tb.appendChild(tr);
  });
  $('#reconImpTotal') && ($('#reconImpTotal').textContent = fmt(total));
  if($('#matchCount')) $('#matchCount').textContent = String(matches);
  if($('#unmatchedCount')) $('#unmatchedCount').textContent = String(nomatch);
}
function tryMatchRow(row){
  // matching simple: buscar en incomes/expenses/payments/personal por monto absoluto y fecha cercana
  const pools = [
    { list: state.incomesDaily, type: 'income', sign: +1 },
    { list: state.expensesDaily, type: 'expense', sign: -1 },
    { list: state.payments, type: 'payroll', sign: -1 },
    { list: state.personal, type: 'personal', sign: -1 }
  ];
  const absAmt = Math.abs(row.amount);
  for(const p of pools){
    for(const item of p.list){
      const itAbs = Math.abs(Number(item.amount||0));
      const days = Math.abs( (new Date(item.date) - new Date(row.date)) / 86400000 );
      if(Math.abs(itAbs - absAmt) <= 0.01 && days <= 3){
        return { type: p.type, id: item.id, date: item.date, amount: item.amount };
      }
    }
  }
  return null;
}
function wireReconciliationImport(){
  $('#reconImportPreview')?.addEventListener('click', async ()=>{
    const f = $('#reconFile')?.files?.[0]; if(!f) return toast('Selecciona un CSV');
    const text = await f.text(); const rows = parseCSV(text, Number($('#reconYear')?.value||new Date().getFullYear()));
    if(rows.length===0) return toast('CSV vacío o sin columnas detectables');
    reconImportRows = rows.map(r=> ({ ...r, match: null }));
    reconImportRows.forEach(r=> r.match = tryMatchRow(r));
    renderReconImportTable(); toast('Previsualización lista');
  });
  $('#reconImportMatch')?.addEventListener('click', ()=>{
    if(reconImportRows.length===0) return toast('No hay datos importados');
    reconImportRows.forEach(r=> r.match = tryMatchRow(r));
    renderReconImportTable(); toast('Matching ejecutado');
  });
}

/* ===================== Refresh / Init ===================== */
function refreshAll(){
  applyTheme();
  renderExpenses(); renderIncomes();
  renderReports(); renderHome();
  renderReconciliations();
  renderInvoicesKPI && typeof renderInvoicesKPI === 'function' && renderInvoicesKPI();
  renderQuotesKPI && typeof renderQuotesKPI === 'function' && renderQuotesKPI();
}

/* Stub: algunas funciones que están en tu HTML/JS original (facturas, quotes, reconciliations) */
function renderReconciliations(){
  const tbody = $('#reconTable tbody'); if(!tbody) return; tbody.innerHTML='';
  state.reconciliations.slice().sort(byDateDesc).forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.date}</td><td>${fmt(r.bank)}</td><td>${fmt(r.app)}</td><td>${fmt(r.diff)}</td><td>${r.note||''}</td><td class="row-actions"><button class="btn-outline" data-edit="${r.id}">Editar</button><button class="btn-outline" data-del="${r.id}">Eliminar</button></td>`;
    tbody.appendChild(tr);
  });
  $$('#reconTable [data-del]').forEach(b=> b.onclick=()=>{ state.reconciliations = state.reconciliations.filter(x=>x.id!==b.dataset.del); saveState(); toast('Eliminado'); });
  $$('#reconTable [data-edit]').forEach(b=> b.onclick=()=>{/* implementar edición simple si se requiere */});
}

/* Facturas KPI stub */
function renderInvoicesKPI(){ /* opcional */ }
function renderQuotesKPI(){ /* opcional */ }

/* ===================== Wire all UI ===================== */
function wireAll(){
  const sidebar = $('#sidebar');
  sidebar?.addEventListener('click',(ev)=>{
    const btn = ev.target.closest?.('.nav-btn');
    if(btn && btn.dataset.target){ showView(btn.dataset.target); sidebar.classList.remove('open'); }
  });
  $('#menuToggle')?.addEventListener('click', ()=> sidebar?.classList.toggle('open'));

  // wire forms / features
  initCatalogs();
  wireExpenses(); wireIncomes();
  wireExports();
  wireSettings();
  wireReconciliationImport();

  // Login
  updateLoginUI();

  // Inicial render
  refreshAll();
}

/* ============== Start ============== */
document.addEventListener('DOMContentLoaded', wireAll);
window.addEventListener('pageshow', (e)=>{ if(e.persisted){ updateLoginUI(); }});
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && $('#login')?.classList.contains('visible')){ forceShowLogin(); }});

/* API dev */
window.app = { state, saveState, generatePDF };
