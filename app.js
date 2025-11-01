/* =========================================================
   Nexus Finance — app.js (COMPLETO)
   Reglas: Salón 45% ingreso, 408 = 10% del restante (ingreso
   mientras pendiente), Neto = gasto al pagar, 408/SS pagadas = gasto
   ========================================================= */

/* ============== Estado / Utils ============== */
const STORAGE_KEY = 'finanzas-state-v11';
const LOCK_KEY    = 'finanzas-lock-v3';

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
  payments: [],           // {id,date,to,gross,amount(net),salonIncome,ret408,ss,paid408,paidSS,status,...}
  ordinary: [],
  budgets: [],
  personal: [],
  invoices: [],
  quotes: [],
  reconciliations: [],
};

const $  = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));
const clone = o => JSON.parse(JSON.stringify(o));
const todayStr = ()=> new Date().toISOString().slice(0,10);
const toDate   = s  => new Date(s);
const nowMs    = ()=> Date.now();
function inRange(d, from, to){ const t=+toDate(d||'1970-01-01'); if(from && t<+toDate(from)) return false; if(to && t>(+toDate(to)+86400000-1)) return false; return true; }
const byDateDesc = (a,b)=> (+toDate(b.date||'1970-01-01')) - (+toDate(a.date||'1970-01-01'));

function load(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){ localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE)); return clone(DEFAULT_STATE); }
  try{
    const st = JSON.parse(raw);
    for (const k of Object.keys(DEFAULT_STATE)) if(!(k in st)) st[k]=clone(DEFAULT_STATE[k]);
    return st;
  }catch{ return clone(DEFAULT_STATE); }
}
let state = load();

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyTheme(); refreshAll();
}
function fmt(n){
  const cur = state.settings.currency || 'USD';
  const val = Number(n||0);
  try{ return new Intl.NumberFormat('es-PR',{style:'currency',currency:cur}).format(val); }
  catch{ return `${cur} ${val.toFixed(2)}`; }
}
function toast(msg){
  const c = $('#toastContainer'); if(!c){ console.log('[Toast]', msg); return; }
  const t = document.createElement('div'); t.className='toast'; t.textContent=msg; c.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(), 300); }, 2400);
}
const uid = ()=> Math.random().toString(36).slice(2,9)+Date.now().toString(36);

/* ============== Tema / Router ============== */
function applyTheme(){
  const r = document.documentElement;
  r.style.setProperty('--primary', state.settings.theme.primary);
  r.style.setProperty('--accent',  state.settings.theme.accent);
  r.style.setProperty('--text',    state.settings.theme.text);
  $('#brandName') && ($('#brandName').textContent = state.settings.businessName || 'Mi Negocio');
  const FALLBACK_LOGO = 'assets/logo.png';
  ['brandLogo'].forEach(id=>{ const el=$('#'+id); if(el) el.src = state.settings.logoBase64 || FALLBACK_LOGO; });
}
function showView(id){
  $$('.view').forEach(v=>{ v.classList.toggle('visible', v.id===id); v.setAttribute('aria-hidden', v.id===id?'false':'true'); });
  $$('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.target===id));
  window.scrollTo({top:0, behavior:'smooth'});
}
document.addEventListener('click', (ev)=>{
  const btn=ev.target.closest?.('.nav-btn'); 
  if(btn && btn.dataset.target){ showView(btn.dataset.target); }
});

/* ============== Login (PIN simple) ============== */
async function sha256(msg){
  const enc = new TextEncoder().encode(msg);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const MAX_ATTEMPTS = 5;
const attempts     = () => Number(localStorage.getItem(LOCK_KEY)||0);
const setAttempts  = n  => localStorage.setItem(LOCK_KEY, String(n));
const attemptsLeft = () => Math.max(0, MAX_ATTEMPTS - attempts());
async function handleLogin(ev){
  if(ev) ev.preventDefault();
  const createMode = !state.settings.pinHash;
  const pin  = ($('#loginPIN')?.value || '').trim();
  const pin2 = ($('#loginPIN2')?.value|| '').trim();
  if(!pin) return toast('Introduce tu PIN');
  if(createMode){
    if(pin.length<4||pin.length>8) return toast('El PIN debe tener 4–8 dígitos');
    if(pin!==pin2) return toast('Los PIN no coinciden');
    state.settings.pinHash = await sha256(pin); save(); toast('PIN creado'); $('#login').classList.remove('visible'); showView('home'); return;
  }
  if(attempts()>=MAX_ATTEMPTS) return toast('Máximo de intentos alcanzado');
  const ok = (await sha256(pin))===state.settings.pinHash;
  if(ok){ setAttempts(0); $('#login').classList.remove('visible'); showView('home'); }
  else { setAttempts(attempts()+1); $('#loginAttempts').textContent=`Intentos restantes: ${attemptsLeft()}`; toast('PIN incorrecto'); }
}
function updateLoginUI(){
  const createMode = !state.settings.pinHash;
  $('#loginTitle').textContent = createMode?'Crear PIN':'Ingresar PIN';
  $('#loginHint').textContent  = createMode?'Crea un PIN de 4–8 dígitos.':'Introduce tu PIN';
  $('#loginPIN2Wrap').style.display = createMode?'block':'none';
  $('#loginAttempts').textContent = createMode?'':`Intentos restantes: ${attemptsLeft()}`;
  if($('#loginBtn')&&!$('#loginBtn')._bound){ $('#loginBtn').addEventListener('click',handleLogin); $('#loginForm').addEventListener('submit',handleLogin); $('#loginBtn')._bound=true; }
  $('#login').classList.add('visible');
}
$('#logoutBtn')?.addEventListener('click', ()=>{ $('#login').classList.add('visible'); showView('login'); });

/* ============== Catálogos ============== */
const EXPENSE_CATEGORIES = [
  "Gasolina","Comida","Transporte","Mantenimiento","Renta/Alquiler",
  "Servicios (Luz/Agua/Internet)","Insumos","Nómina","Impuestos","Herramientas",
  "Publicidad/Marketing","Viajes","Papelería","Licencias y Software","Seguros",
  "Equipos","Materiales","Otros"
];
const PAYMENT_METHODS = ["Efectivo","Tarjeta","Cheque","ATH Móvil","Transferencia"];
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
}

/* =========================================================
   GASTOS DIARIOS
   ========================================================= */
function renderExpenses(){
  const tbody = $('#expensesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from = $('#fExpFrom')?.value, to = $('#fExpTo')?.value; let total=0; const cats={};
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
    total+=Number(e.amount||0);
    cats[e.category]=(cats[e.category]||0)+Number(e.amount||0);
  });
  $('#expSumTotal').textContent = fmt(total);
  const pills = $('#expSumPills'); 
  if(pills){ pills.innerHTML=''; Object.entries(cats).forEach(([k,v])=>{ const s=document.createElement('span'); s.textContent=`${k}: ${fmt(v)}`; pills.appendChild(s); }); }
  $$('#expensesTable [data-del]').forEach(b=> b.onclick=()=>{ state.expensesDaily = state.expensesDaily.filter(x=>x.id!==b.dataset.del); save(); toast('Gasto eliminado'); });
  $$('#expensesTable [data-edit]').forEach(b=> b.onclick=()=> editExpense(b.dataset.edit));
}
function editExpense(id){
  const i=state.expensesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const e=state.expensesDaily[i];
  const val=prompt('Editar (fecha,cat,desc,método,ref,monto,nota)\n'+[e.date,e.category,e.desc,e.method,e.ref,e.amount,e.note].join(',')); if(!val) return;
  const [date,category,desc,method,ref,amount,note]=val.split(',');
  e.date=date||e.date; e.category=category||e.category; e.desc=desc||e.desc; e.method=method||e.method; e.ref=ref||e.ref; e.amount=parseFloat(amount||e.amount)||e.amount; e.note=note||e.note; save();
}
function wireExpenses(){
  $('#expenseForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), date:$('#expDate')?.value, category:$('#expCategory')?.value, desc:$('#expDesc')?.value, amount:Number($('#expAmount')?.value||0), method:$('#expMethod')?.value||'', ref:$('#expRef')?.value||'', note:$('#expNote')?.value };
    if(!rec.date) return toast('Fecha requerida');
    state.expensesDaily.push(rec); save(); toast('Gasto guardado'); ev.target.reset();
  });
  $('#fExpApply')?.addEventListener('click', renderExpenses);
  $('#addExpense')?.addEventListener('click', ()=>{ if($('#expDate')) $('#expDate').value=todayStr(); $('#expAmount')?.focus(); });
}

/* =========================================================
   INGRESOS MANUALES
   ========================================================= */
function renderIncomes(){
  const tbody=$('#incomesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from=$('#fIncFrom')?.value, to=$('#fIncTo')?.value; let total=0;
  const totalsByMethod = { 'Efectivo':0,'Tarjeta':0,'Cheque':0,'ATH Móvil':0,'Transferencia':0 };

  state.incomesDaily.filter(r=>inRange(r.date, from, to)).sort(byDateDesc).forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date||''}</td><td>${r.client||''}</td><td>${r.method||''}</td>
      <td>${r.ref||''}</td><td>${fmt(r.amount)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${r.id}">Editar</button>
        <button class="btn-outline" data-del="${r.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr); total+=Number(r.amount||0);
    if (totalsByMethod[r.method] !== undefined) totalsByMethod[r.method]+=Number(r.amount||0);
  });
  $('#incSumTotal').textContent = fmt(total);
  const methodWrap = $('#incSumMethods');
  if (methodWrap){
    methodWrap.innerHTML='';
    Object.entries(totalsByMethod).forEach(([method, value])=>{
      const div=document.createElement('span'); div.className='pill'; div.textContent=`${method}: ${fmt(value)}`; methodWrap.appendChild(div);
    });
  }
  $$('#incomesTable [data-del]').forEach(b=> b.onclick=()=>{ state.incomesDaily = state.incomesDaily.filter(x=>x.id!==b.dataset.del); save(); toast('Ingreso eliminado'); });
  $$('#incomesTable [data-edit]').forEach(b=> b.onclick=()=> editIncome(b.dataset.edit));
}
function editIncome(id){
  const i=state.incomesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const r0=state.incomesDaily[i];
  const val=prompt('Editar (fecha,cliente,método,ref,monto)\n'+[r0.date,r0.client,r0.method,r0.ref,r0.amount].join(',')); if(!val) return;
  const [date,client,method,ref,amount]=val.split(',');
  r0.date=date||r0.date; r0.client=client||r0.client; r0.method=method||r0.method; r0.ref=ref||r0.ref; r0.amount=parseFloat(amount||r0.amount)||r0.amount; save();
}
function wireIncomes(){
  $('#incomeForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), date:$('#incDate')?.value, client:$('#incClient')?.value, method:$('#incMethod')?.value, ref:$('#incRef')?.value, amount:Number($('#incAmount')?.value||0) };
    if(!rec.date) return toast('Fecha requerida');
    state.incomesDaily.push(rec); save(); toast('Ingreso guardado'); ev.target.reset();
  });
  $('#fIncApply')?.addEventListener('click', renderIncomes);
  $('#addIncome')?.addEventListener('click', ()=>{ if($('#incDate')) $('#incDate').value=todayStr(); $('#incAmount')?.focus(); });
}

/* =========================================================
   NÓMINA (+ reglas salón/408/ss)
   ========================================================= */
function round2(n){ return Math.round((Number(n)||0)*100)/100; }
function computePayrollDerived(p){
  const gross  = Number(p.gross||0);
  const salonPct = 0.45;
  const salon    = +(gross * salonPct);
  const baseAfterSalon = +(gross - salon);
  const r408Pct  = 0.10;
  const ret408   = +(baseAfterSalon * r408Pct);
  const ss       = Number(p.ss)||0; // si no usas, queda 0
  const net      = +(baseAfterSalon - ret408 - ss);
  return { salonIncome: round2(salon), baseAfterSalon: round2(baseAfterSalon), ret408: round2(ret408), ss: round2(ss), net: round2(Math.max(net,0)) };
}
function payrollComputeNet(){
  const g  = parseFloat($('#payGross')?.value || '0') || 0;
  const d = computePayrollDerived({gross:g, ss: parseFloat($('#payRetSS')?.value||'0')||0});
  if ($('#payAmount')) $('#payAmount').value = d.net.toFixed(2);
  return d.net;
}
function payrollBindRetentionInputs(){
  ['payGross','payRetSS'].forEach(id=>{
    const el=$('#'+id); if(el && !el._retBound){ el.addEventListener('input', payrollComputeNet); el._retBound=true; }
  });
  payrollComputeNet();
}
function renderPayments(){
  const tbody=$('#paymentsTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const totals={Pendiente:0,Pagado:0};
  state.payments.slice().sort(byDateDesc).forEach(p=>{
    const tr=document.createElement('tr');
    const badge408 = p.paid408 ? '408 Pagada' : '408 Pendiente';
    const badgeSS  = p.ss ? (p.paidSS ? 'SS Pagada' : 'SS Pendiente') : '—';
    tr.innerHTML = `
      <td>${p.date||''}</td>
      <td>${p.to||''}</td>
      <td>${p.category||''}</td>
      <td title="Salón: ${fmt(p.salonIncome)} · 408: ${fmt(p.ret408)} · SS: ${fmt(p.ss)}">${fmt(p.amount)}</td>
      <td>${p.status}</td>
      <td class="row-actions">
        <button class="btn-outline" data-toggle408="${p.id}">${badge408}</button>
        <button class="btn-outline" data-toggleSS="${p.id}">${badgeSS}</button>
        <button class="btn-outline" data-edit="${p.id}">Editar</button>
        <button class="btn-outline" data-del="${p.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
    totals[p.status]=(totals[p.status]||0)+Number(p.amount||0);
  });
  // resumen top (si existe)
  const paid = state.payments.filter(p=>p.status==='Pagado').reduce((a,p)=>a+Number(p.amount||0),0);
  const all  = state.payments.reduce((a,p)=>a+Number(p.amount||0),0);
  $('#payrollTotal')  && ($('#payrollTotal').textContent  = fmt(paid));
  $('#payrollPaid')   && ($('#payrollPaid').textContent   = fmt(paid));
  $('#payrollPending')&& ($('#payrollPending').textContent= fmt(all-paid));

  // acciones
  $$('#paymentsTable [data-del]').forEach(b=> b.onclick=()=>{ state.payments = state.payments.filter(x=>x.id!==b.dataset.del); save(); toast('Pago eliminado'); });
  $$('#paymentsTable [data-edit]').forEach(b=> b.onclick=()=> editPayment(b.dataset.edit));
  $$('#paymentsTable [data-toggle408]').forEach(b=> b.onclick=()=>{
    const p=state.payments.find(x=>x.id===b.dataset.toggle408); if(!p) return;
    p.paid408=!p.paid408; save(); toast(p.paid408?'Ret. 408 pagada':'Ret. 408 pendiente');
  });
  $$('#paymentsTable [data-toggleSS]').forEach(b=> b.onclick=()=>{
    const p=state.payments.find(x=>x.id===b.dataset.toggleSS); if(!p) return;
    if(!p.ss){ toast('SS=0'); return; }
    p.paidSS=!p.paidSS; save(); toast(p.paidSS?'SS pagada':'SS pendiente');
  });
}
function editPayment(id){
  const i=state.payments.findIndex(x=>x.id===id); if(i<0) return;
  const p=state.payments[i];
  const val=prompt('Editar (fecha,empleado,categoría,bruto,estado)\n'+[p.date,p.to,p.category,p.gross,p.status].join(',')); if(!val) return;
  const [date,to,cat,gross,status]=val.split(',');
  if(date) p.date=date; if(to) p.to=to; if(cat) p.category=cat; if(gross){ p.gross=parseFloat(gross)||p.gross; const d=computePayrollDerived({gross:p.gross, ss:p.ss||0}); p.salonIncome=d.salonIncome; p.ret408=d.ret408; p.amount=d.net; }
  if(status) p.status=status;
  save();
}
function wirePayments(){
  payrollBindRetentionInputs();
  $('#paymentForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const gross=parseFloat($('#payGross')?.value||'0')||0;
    const d=computePayrollDerived({gross, ss: parseFloat($('#payRetSS')?.value||'0')||0});
    const rec={
      id:uid(),
      date:     $('#payDate')?.value,
      to:       $('#payTo')?.value,
      category: $('#payCategory')?.value || 'Nómina',
      gross,
      salonIncome:d.salonIncome,
      ret408:     d.ret408,
      ss:         d.ss,
      amount:     d.net,
      status:     $('#payStatus')?.value || 'Pendiente',
      paid408: false, paidSS:false
    };
    if(!rec.date) return toast('Fecha requerida');
    state.payments.push(rec); save(); toast('Pago guardado'); ev.target.reset(); payrollBindRetentionInputs();
  });
  $('#addPayment')?.addEventListener('click', ()=>{ if($('#payDate')) $('#payDate').value=todayStr(); payrollComputeNet(); });
}

/* =========================================================
   RETENCIONES (vista)
   ========================================================= */
function sumRet408PendingRange(from,to){
  return state.payments.filter(p=>inRange(p.date,from,to)&&!p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
}
function sumRet408PaidRange(from,to){
  return state.payments.filter(p=>inRange(p.date,from,to)&&p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
}
function sumSSPendingRange(from,to){
  return state.payments.filter(p=>inRange(p.date,from,to)&&!p.paidSS).reduce((a,p)=>a+Number(p.ss||0),0);
}
function sumSSPaidRange(from,to){
  return state.payments.filter(p=>inRange(p.date,from,to)&&p.paidSS).reduce((a,p)=>a+Number(p.ss||0),0);
}
function renderWithholdings(){
  const from=$('#whFrom')?.value||'', to=$('#whTo')?.value||'';
  const rows=state.payments.filter(p=>inRange(p.date,from,to));
  $('#whSum408Pend') && ($('#whSum408Pend').textContent = fmt(rows.filter(p=>!p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0)));
  $('#whSum408Paid') && ($('#whSum408Paid').textContent = fmt(rows.filter(p=> p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0)));
  $('#whSumSSPend')  && ($('#whSumSSPend').textContent  = fmt(rows.filter(p=>!p.paidSS ).reduce((a,p)=>a+Number(p.ss||0),0)));
  $('#whSumSSPaid')  && ($('#whSumSSPaid').textContent  = fmt(rows.filter(p=> p.paidSS ).reduce((a,p)=>a+Number(p.ss||0),0)));
  const tb=$('#withholdingsTable tbody'); if(!tb) return; tb.innerHTML='';
  rows.sort(byDateDesc).forEach(p=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${p.date||''}</td>
      <td>${p.to||''}</td>
      <td>${fmt(p.gross||0)}</td>
      <td>${fmt(p.salonIncome||0)}</td>
      <td>${fmt(p.ret408||0)}</td>
      <td>${p.paid408?'408 Pagada':'408 Pendiente'}</td>
      <td>${fmt(p.ss||0)}</td>
      <td>${p.ss?(p.paidSS?'SS Pagada':'SS Pendiente'):'—'}</td>
      <td class="row-actions">
        <button class="btn-outline" data-toggle408="${p.id}">${p.paid408?'Desmarcar 408':'Pagar 408'}</button>
        ${p.ss? `<button class="btn-outline" data-toggleSS="${p.id}">${p.paidSS?'Desmarcar SS':'Pagar SS'}</button>`:''}
      </td>`;
    tb.appendChild(tr);
  });
  $$('#withholdingsTable [data-toggle408]').forEach(b=> b.onclick=()=>{ const p=state.payments.find(x=>x.id===b.dataset.toggle408); if(!p) return; p.paid408=!p.paid408; save(); });
  $$('#withholdingsTable [data-toggleSS]').forEach(b=> b.onclick=()=>{ const p=state.payments.find(x=>x.id===b.dataset.toggleSS); if(!p) return; p.paidSS=!p.paidSS; save(); });
}
$('#whApply')?.addEventListener('click', renderWithholdings);

/* =========================================================
   REPORTES + DASHBOARD
   ========================================================= */
function sumRange(list, from, to){ if(!Array.isArray(list)) return 0; return list.filter(r=>inRange(r.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0); }
function sumPersonalRange(from, to){ return state.personal.filter(p=>inRange(p.date,from,to)).reduce((a,b)=>a+Number(b.amount||0),0); }
function sumPaymentsNetPaid(from,to){ return state.payments.filter(p=>inRange(p.date,from,to) && p.status==='Pagado').reduce((a,b)=>a+Number(b.amount||0),0); }
function sumSalonIncomeRange(from,to){ return state.payments.filter(p=>inRange(p.date,from,to)).reduce((a,p)=>a+Number(p.salonIncome||0),0); }

function renderReports(){
  const now=new Date(); const today=now.toISOString().slice(0,10);
  const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const yearStart=new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
  const weekStart=(()=>{ const x=new Date(now); const day=x.getDay()||7; x.setDate(x.getDate()-day+1); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); })();

  const salonDay   = state.payments.filter(p=>inRange(p.date,today,today)).reduce((a,p)=>a+Number(p.salonIncome||0),0);
  const salonWeek  = state.payments.filter(p=>inRange(p.date,weekStart,today)).reduce((a,p)=>a+Number(p.salonIncome||0),0);
  const salonMonth = sumSalonIncomeRange(monthStart,today);
  const salonYear  = state.payments.filter(p=>inRange(p.date,yearStart,today)).reduce((a,p)=>a+Number(p.salonIncome||0),0);

  const r408PendDay   = state.payments.filter(p=>inRange(p.date,today,today)&&!p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
  const r408PendWeek  = state.payments.filter(p=>inRange(p.date,weekStart,today)&&!p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
  const r408PendMonth = sumRet408PendingRange(monthStart,today);
  const r408PendYear  = state.payments.filter(p=>inRange(p.date,yearStart,today)&&!p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);

  const incDay   = salonDay   + r408PendDay   + sumRange(state.incomesDaily,today,today);
  const incWeek  = salonWeek  + r408PendWeek  + sumRange(state.incomesDaily,weekStart,today);
  const incMonth = salonMonth + r408PendMonth + sumRange(state.incomesDaily,monthStart,today);
  const incYear  = salonYear  + r408PendYear  + sumRange(state.incomesDaily,yearStart,today);

  const expDay   = state.expensesDaily.filter(e=>inRange(e.date,today,today)).reduce((a,e)=>a+Number(e.amount||0),0)
                  + sumPersonalRange(today,today)
                  + sumPaymentsNetPaid(today,today)
                  + state.payments.filter(p=>inRange(p.date,today,today)&&p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
  const expWeek  = state.expensesDaily.filter(e=>inRange(e.date,weekStart,today)).reduce((a,e)=>a+Number(e.amount||0),0)
                  + sumPersonalRange(weekStart,today) + sumPaymentsNetPaid(weekStart,today)
                  + state.payments.filter(p=>inRange(p.date,weekStart,today)&&p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
  const expMonth = state.expensesDaily.filter(e=>inRange(e.date,monthStart,today)).reduce((a,e)=>a+Number(e.amount||0),0)
                  + sumPersonalRange(monthStart,today) + sumPaymentsNetPaid(monthStart,today)
                  + sumRet408PaidRange(monthStart,today);
  const expYear  = state.expensesDaily.filter(e=>inRange(e.date,yearStart,today)).reduce((a,e)=>a+Number(e.amount||0),0)
                  + sumPersonalRange(yearStart,today) + sumPaymentsNetPaid(yearStart,today)
                  + state.payments.filter(p=>inRange(p.date,yearStart,today)&&p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);

  $('#rToday').textContent = `${fmt(incDay)} / ${fmt(expDay)}`;
  $('#rWeek').textContent  = `${fmt(incWeek)} / ${fmt(expWeek)}`;
  $('#rMonth').textContent = `${fmt(incMonth)} / ${fmt(expMonth)}`;
  $('#rYear').textContent  = `${fmt(incYear)} / ${fmt(expYear)}`;
}
function renderHome(){
  const now=new Date(); 
  const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10); 
  const today=now.toISOString().slice(0,10);

  const salon     = sumSalonIncomeRange(monthStart,today);
  const r408Pend  = sumRet408PendingRange(monthStart,today);
  const ssPend    = sumSSPendingRange(monthStart,today);
  const otherInc  = sumRange(state.incomesDaily, monthStart, today);
  const incMonth  = salon + r408Pend + ssPend + otherInc;

  const expDaily  = state.expensesDaily.filter(e=>inRange(e.date,monthStart,today)).reduce((a,e)=>a+Number(e.amount||0),0);
  const perMonth  = sumPersonalRange(monthStart,today);
  const netPaid   = sumPaymentsNetPaid(monthStart,today);
  const r408Paid  = sumRet408PaidRange(monthStart,today);
  const ssPaid    = sumSSPaidRange(monthStart,today);

  const expMonth  = expDaily + perMonth + netPaid + r408Paid + ssPaid;
  const balance   = incMonth - expMonth;

  $('#kpiIncomesMonth').textContent  = fmt(incMonth);
  $('#kpiExpensesMonth').textContent = fmt(expMonth);
  $('#kpiBalanceMonth').textContent  = fmt(balance);

  const c=$('#chart12'); if(!c) return; const ctx=c.getContext('2d'); 
  c.width=c.clientWidth; c.height=180; ctx.clearRect(0,0,c.width,c.height);
  const months=[], inc=[], exp=[];
  for(let i=11;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const from=new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10);
    const to=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10);
    months.push(d.toLocaleDateString('es-ES',{month:'short'}));
    const salonM   = state.payments.filter(p=>inRange(p.date,from,to)).reduce((a,p)=>a+Number(p.salonIncome||0),0);
    const r408PM   = state.payments.filter(p=>inRange(p.date,from,to)&&!p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
    const otherM   = sumRange(state.incomesDaily, from, to);
    const incM     = salonM + r408PM + otherM;
    const expM     = state.expensesDaily.filter(e=>inRange(e.date,from,to)).reduce((a,e)=>a+Number(e.amount||0),0)
                     + sumPersonalRange(from,to)
                     + sumPaymentsNetPaid(from,to)
                     + state.payments.filter(p=>inRange(p.date,from,to)&&p.paid408).reduce((a,p)=>a+Number(p.ret408||0),0);
    exp.push(expM); inc.push(incM);
  }
  const max=Math.max(...inc,...exp,1); const barW=Math.floor((c.width-40)/(months.length*2));
  months.forEach((m,idx)=>{
    const x=idx*(barW*2)+20; 
    const hI=Math.round((inc[idx]/max)*(c.height-30)); 
    const hE=Math.round((exp[idx]/max)*(c.height-30));
    ctx.fillStyle='#C7A24B'; ctx.fillRect(x,c.height-10-hI,barW,hI);
    ctx.fillStyle='#555'; ctx.fillRect(x+barW+4,c.height-10-hE,barW,hE);
    ctx.fillStyle='#aaa'; ctx.font='12px system-ui'; ctx.fillText(m,x,c.height-2);
  });
}

/* =========================================================
   ORDINARIOS / PRESUPUESTOS / PERSONALES (mantenidos)
   ========================================================= */
function renderOrdinary(){
  const tb=$('#ordinaryTable tbody'); if(!tb) return; tb.innerHTML='';
  state.ordinary.forEach(o=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${o.name}</td><td>${fmt(o.amount)}</td><td>${o.freq}</td><td>${o.next}</td>
      <td class="row-actions"><button class="btn-outline" data-del="${o.id}">Eliminar</button></td>`;
    tb.appendChild(tr);
  });
  $('#ordSumCount').textContent=state.ordinary.length.toString();
  const next=state.ordinary.map(o=>o.next).filter(Boolean).sort()[0]||'—';
  $('#ordSumNext').textContent=next;
  $$('#ordinaryTable [data-del]').forEach(b=> b.onclick=()=>{ state.ordinary=state.ordinary.filter(x=>x.id!==b.dataset.del); save(); });
}
function wireOrdinary(){
  $('#ordinaryForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), name:$('#ordName')?.value, amount:Number($('#ordAmount')?.value||0), freq:$('#ordFreq')?.value, next:$('#ordNext')?.value };
    if(!rec.next) return toast('Próxima fecha requerida');
    state.ordinary.push(rec); save(); toast('Recurrente guardado'); ev.target.reset();
  });
  $('#addOrd')?.addEventListener('click', ()=>{ if($('#ordNext')) $('#ordNext').value=todayStr(); $('#ordAmount')?.focus(); });
}
function spendByCategory(cat){ return state.expensesDaily.filter(e=>e.category===cat).reduce((a,b)=>a+Number(b.amount||0),0); }
function renderBudgets(){
  const wrap=$('#budgetBars'); if(!wrap) return; wrap.innerHTML='';
  state.budgets.forEach(b=>{
    const used=spendByCategory(b.category);
    const pct=b.limit>0?Math.min(100,Math.round(100*used/b.limit)):0;
    const div=document.createElement('div');
    div.className='budget-bar'+(used>b.limit?' over':'');
    div.innerHTML=`<div class="label"><strong>${b.category}</strong> <span>${fmt(used)} / ${fmt(b.limit)} (${pct}%)</span></div>
      <div class="bar"><span style="width:${pct}%"></span></div>`;
    wrap.appendChild(div);
  });
}
function wireBudgets(){
  $('#budgetForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), category:$('#budCategory')?.value, limit:Number($('#budLimit')?.value||0) };
    state.budgets.push(rec); save(); toast('Presupuesto guardado'); ev.target.reset();
  });
}
function renderPersonal(){
  const tb=$('#personalTable tbody'); if(!tb) return; tb.innerHTML=''; let total=0;
  state.personal.slice().sort(byDateDesc).forEach(p=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${p.date||''}</td><td>${p.category||''}</td><td>${p.desc||''}</td><td>${fmt(p.amount)}</td>
      <td class="row-actions"><button class="btn-outline" data-del="${p.id}">Eliminar</button></td>`;
    tb.appendChild(tr); total+=Number(p.amount||0);
  });
  $('#perSumTotal').textContent=fmt(total);
  $$('#personalTable [data-del]').forEach(b=> b.onclick=()=>{ state.personal=state.personal.filter(x=>x.id!==b.dataset.del); save(); });
}
function wirePersonal(){
  $('#personalForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), date:$('#perDate')?.value, category:$('#perCategory')?.value, desc:$('#perDesc')?.value, amount:Number($('#perAmount')?.value||0) };
    if(!rec.date) return toast('Fecha requerida');
    state.personal.push(rec); save(); toast('Gasto personal guardado'); ev.target.reset();
  });
  $('#addPersonal')?.addEventListener('click', ()=>{ if($('#perDate')) $('#perDate').value=todayStr(); $('#perAmount')?.focus(); });
}

/* =========================================================
   REFRESH / INIT
   ========================================================= */
function refreshAll(){
  renderExpenses(); renderIncomes(); renderPayments();
  renderOrdinary(); renderBudgets(); renderPersonal();
  renderReports(); renderHome();
  renderWithholdings();
}
function wireAll(){
  initCatalogs(); applyTheme(); refreshAll(); updateLoginUI();
  wireExpenses(); wireIncomes(); wirePayments(); wireOrdinary(); wireBudgets(); wirePersonal();
  $('#menuToggle')?.addEventListener('click', ()=> $('#sidebar')?.classList.toggle('open'));
}
document.addEventListener('DOMContentLoaded', wireAll);
