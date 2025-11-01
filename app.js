/* =========================================================
   Nexus Finance — app.js (v18)
   Core, Estado, Tema, Login, Gastos, Ingresos (info),
   Nómina con Salón(45%) + Ret.408(10% remanente) + SS,
   Retenciones (historial + pagar), Reportes correctos,
   Export/Import, PDF, Conciliación, Firebase opcional
   ========================================================= */

/* ===================== Firebase (opcional) ===================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC66vv3-yaap1mV2n1GXRUopLqccobWqRE",
  authDomain: "finanzas-web-f4e05.firebaseapp.com",
  projectId: "finanzas-web-f4e05",
  storageBucket: "finanzas-web-f4e05.firebasestorage.app",
  messagingSenderId: "1047152523619",
  appId: "1:1047152523619:web:7d8f7d1f7a5ccc6090bb56"
};
const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);
enableIndexedDbPersistence(db).catch(()=>{});

/* ===================== Estado / Utils ===================== */
const STORAGE_KEY = 'finanzas-state-v12';
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
  incomesDaily: [],       // informativos (no suman dashboard)
  payments: [],           // nómina con bruto/salón/408/ss/neto
  ordinary: [],
  budgets: [],
  personal: [],
  invoices: [],
  quotes: [],
  reconciliations: [],
  _cloud: { updatedAt: 0 }
};

const $  = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));
const clone = o => JSON.parse(JSON.stringify(o));
const todayStr = ()=> new Date().toISOString().slice(0,10);
const nowMs = ()=> Date.now();

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

function save({skipCloud=false} = {}){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyTheme(); refreshAll();
  if(!skipCloud && cloud.autosync && cloud.user){ cloudPushDebounced(); }
}

function fmt(n){
  const cur = state.settings.currency || 'USD';
  const val = Number(n||0);
  try{ return new Intl.NumberFormat('es-PR',{style:'currency',currency:cur}).format(val); }
  catch{ return `${cur} ${val.toFixed(2)}`; }
}
function toast(msg){
  const c = $('#toastContainer');
  if(!c){ console.log('[Toast]', msg); return; }
  const t = document.createElement('div');
  t.className='toast'; t.textContent=msg; c.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(), 300); }, 2400);
}
const uid = ()=> Math.random().toString(36).slice(2,9)+Date.now().toString(36);
const toDate = s=> new Date(s);
function inRange(d, from, to){ const t=+toDate(d||'1970-01-01'); if(from && t<+toDate(from)) return false; if(to && t>(+toDate(to)+86400000-1)) return false; return true; }
const byDateDesc = (a,b)=> (+toDate(b.date||'1970-01-01')) - (+toDate(a.date||'1970-01-01'));
function ask(curr,label){ const v=prompt(label, curr??''); if(v===null) return {cancelled:true,value:curr}; return {cancelled:false,value:v}; }
function askNumber(curr,label){ const a=ask(String(curr??''),label); if(a.cancelled) return a; const n=parseFloat(String(a.value).replace(',','.')); if(Number.isNaN(n)) return {cancelled:true,value:curr}; return {cancelled:false,value:n}; }

/* ===================== Catálogos ===================== */
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
  upsertOptions($('#invMethod'), PAYMENT_METHODS);
  upsertOptions($('#quoMethod'), PAYMENT_METHODS);
}

/* ===================== Tema / Router ===================== */
function applyTheme(){
  const r = document.documentElement;
  r.style.setProperty('--primary', state.settings.theme.primary);
  r.style.setProperty('--accent',  state.settings.theme.accent);
  r.style.setProperty('--text',    state.settings.theme.text);
  $('#brandName') && ($('#brandName').textContent = state.settings.businessName || 'Mi Negocio');
  const FALLBACK_LOGO = 'assets/logo.png';
  ['brandLogo','logoPreview'].forEach(id=>{ const el=$('#'+id); if(el) el.src = state.settings.logoBase64 || FALLBACK_LOGO; });
}
function showView(id){
  $$('.view').forEach(v=>{ if(v.id!=='login') v.classList.remove('visible'); });
  const t = $('#'+id) || $('#home'); if(t && t.id!=='login') t.classList.add('visible');
  $$('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.target===id));
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ===================== Login robusto ===================== */
const MAX_ATTEMPTS = 5;
const attempts     = () => Number(localStorage.getItem(LOCK_KEY)||0);
const setAttempts  = n  => localStorage.setItem(LOCK_KEY, String(n));
const attemptsLeft = () => Math.max(0, MAX_ATTEMPTS - attempts());

async function sha256(msg){
  const enc = new TextEncoder().encode(msg);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function hardHideOverlays(){
  document.body.classList.remove('modal-open','locked','dimmed');
  ['#scrim','.overlay','.backdrop'].forEach(sel=>{
    const el = document.querySelector(sel);
    if(el){ el.remove(); }
  });
}
function forceShowLogin(){
  $$('.view.visible').forEach(v=> v.classList.remove('visible'));
  const box = $('#login'); if(!box) return;
  box.style.display='block'; box.classList.add('visible'); box.removeAttribute('aria-hidden');
  document.body.classList.add('modal-open'); hardHideOverlays();
}
function closeLogin(){
  const box = $('#login'); if(!box) return;
  box.classList.remove('visible'); box.style.display='none'; box.setAttribute('aria-hidden','true');
  hardHideOverlays();
}

async function handleLogin(ev){
  if(ev) ev.preventDefault();
  const createMode = !state.settings.pinHash;
  const pinEl  = $('#loginPIN');
  const pin2El = $('#loginPIN2');
  const pin  = (pinEl?.value  || '').trim();
  const pin2 = (pin2El?.value || '').trim();
  if(!pin){ toast('Introduce tu PIN'); pinEl?.focus(); return; }

  if(createMode){
    if(pin.length<4 || pin.length>8){ toast('El PIN debe tener entre 4 y 8 dígitos'); return; }
    if(pin!==pin2){ toast('Los PIN no coinciden'); return; }
    state.settings.pinHash = await sha256(pin);
    save();
    toast('PIN creado correctamente'); closeLogin(); showView('home'); return;
  }

  if(attempts()>=MAX_ATTEMPTS){ toast('Has alcanzado el máximo de intentos'); return; }
  const ok = (await sha256(pin)) === state.settings.pinHash;
  if(ok){ setAttempts(0); toast('Bienvenido'); closeLogin(); showView('home'); }
  else { setAttempts(attempts()+1); updateLoginUI(); toast(`PIN incorrecto. Intentos restantes: ${attemptsLeft()}`); }
}

function updateLoginUI(){
  const createMode = !state.settings.pinHash;
  $('#loginTitle')  && ($('#loginTitle').textContent = createMode ? 'Crear PIN' : 'Ingresar PIN');
  $('#loginHint')   && ($('#loginHint').textContent  = createMode ? 'Crea un PIN de 4–8 dígitos.' : 'Introduce tu PIN.');
  const pin2Wrap = $('#loginPIN2Wrap') || $('#loginPIN2')?.parentElement;
  if(pin2Wrap && pin2Wrap instanceof HTMLElement) pin2Wrap.style.display = createMode ? 'block' : 'none';
  const left = attemptsLeft();
  $('#loginAttempts') && ($('#loginAttempts').textContent = createMode ? '' : `Intentos restantes: ${left}`);
  if($('#loginBtn') && !$('#loginBtn')._bound){ $('#loginBtn').addEventListener('click', handleLogin); $('#loginBtn')._bound=true; }
  if($('#loginForm') && !$('#loginForm')._bound){ $('#loginForm').addEventListener('submit', handleLogin); $('#loginForm')._bound=true; }
  const pinEl = $('#loginPIN');
  if(pinEl && !pinEl._bound){ pinEl.addEventListener('keydown', e=>{ if(e.key==='Enter') handleLogin(e); }); pinEl._bound = true; }
  if(pinEl){ pinEl.value=''; pinEl.focus(); }
  requestAnimationFrame(()=>{ forceShowLogin(); });
}
window.resetPIN = async function(){
  if(confirm('¿Borrar el PIN guardado y crear uno nuevo?')){
    state.settings.pinHash = ''; localStorage.removeItem(LOCK_KEY); save(); toast('PIN eliminado. Crea uno nuevo.'); updateLoginUI();
  }
};

/* ===================== Gastos Diarios ===================== */
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
  $('#expSumTotal') && ($('#expSumTotal').textContent = fmt(total));
  const pills = $('#expSumPills'); 
  if(pills){ pills.innerHTML=''; Object.entries(cats).forEach(([k,v])=>{ const s=document.createElement('span'); s.className='pill'; s.textContent=`${k}: ${fmt(v)}`; pills.appendChild(s); }); }
  $$('#expensesTable [data-del]').forEach(b=> b.onclick=()=>{ state.expensesDaily = state.expensesDaily.filter(x=>x.id!==b.dataset.del); save(); toast('Gasto eliminado'); });
  $$('#expensesTable [data-edit]').forEach(b=> b.onclick=()=> editExpense(b.dataset.edit));
}
function editExpense(id){
  const i=state.expensesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const e=state.expensesDaily[i];
  let r=ask(e.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; e.date=r.value||e.date;
  r=ask(e.category,'Categoría'); if(r.cancelled) return; e.category=r.value||e.category;
  r=ask(e.desc,'Descripción'); if(r.cancelled) return; e.desc=r.value||e.desc;
  r=ask(e.method,'Método'); if(r.cancelled) return; e.method=r.value||e.method;
  r=ask(e.ref,'Referencia'); if(r.cancelled) return; e.ref=r.value||e.ref;
  r=askNumber(e.amount,'Monto'); if(r.cancelled) return; e.amount=r.value;
  r=ask(e.note,'Nota'); if(r.cancelled) return; e.note=r.value||e.note;
  save(); toast('Gasto actualizado');
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

/* ===================== Ingresos (informativos) ===================== */
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
  $('#incSumTotal') && ($('#incSumTotal').textContent = fmt(total));
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
  let r=ask(r0.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; r0.date=r.value||r0.date;
  r=ask(r0.client,'Empleado/Origen'); if(r.cancelled) return; r0.client=r.value||r0.client;
  r=ask(r0.method,'Método'); if(r.cancelled) return; r0.method=r.value||r0.method;
  r=ask(r0.ref,'Referencia'); if(r.cancelled) return; r0.ref=r.value||r0.ref;
  r=askNumber(r0.amount,'Monto'); if(r.cancelled) return; r0.amount=r.value;
  save(); toast('Ingreso actualizado');
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

/* ===================== Nómina (Salón 45% + Ret. 408 10% del remanente) ===================== */
function computeSalon(gross){ return Math.max(0, Number(gross||0)*0.45); }
function computeRet408(gross, salon){ return Math.max(0, (Number(gross||0)-Number(salon||0))*0.10); }
function computeNet(gross, salon, ret408, ss){ const n = Number(gross||0)-Number(salon||0)-Number(ret408||0)-Number(ss||0); return n>=0?n:0; }

function payrollComputeAll(){
  const g  = parseFloat($('#payGross')?.value || '0') || 0;
  const salon= computeSalon(g);
  const r408 = computeRet408(g, salon);
  const ss   = parseFloat($('#payRetSS')?.value || '0') || 0;
  const net  = computeNet(g, salon, r408, ss);
  if ($('#paySalon'))  $('#paySalon').value  = salon.toFixed(2);
  if ($('#payRet408')) $('#payRet408').value = r408.toFixed(2);
  if ($('#payAmount')) $('#payAmount').value = net.toFixed(2);
  return {g, salon, r408, ss, net};
}
function wirePayrollInputs(){
  ['payGross','payRetSS'].forEach(id=>{
    const el=$('#'+id);
    if(el && !el._bound){ el.addEventListener('input', payrollComputeAll); el._bound=true; }
  });
  payrollComputeAll();
}

function renderPayments(){
  const tbody=$('#paymentsTable tbody'); if(!tbody) return; tbody.innerHTML='';
  state.payments.slice().sort(byDateDesc).forEach(p=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${p.date||''}</td>
      <td>${p.to||''}</td>
      <td>${fmt(p.gross||0)}</td>
      <td>${fmt(p.salon||0)}</td>
      <td>${fmt(p.ret408||0)} ${p.irsPaid? '✓' : ''}</td>
      <td>${fmt(p.retSS||0)} ${p.ssPaid? '✓' : ''}</td>
      <td>${fmt(p.amount||0)}</td>
      <td>${p.status||'Pendiente'}</td>
      <td class="row-actions">
        <button class="btn-outline" data-irs="${p.id}">${p.irsPaid?'408 Pagada':'Pagar 408'}</button>
        <button class="btn-outline" data-ss="${p.id}">${p.ssPaid?'SS Pagada':'Pagar SS'}</button>
        <button class="btn-outline" data-edit="${p.id}">Editar</button>
        <button class="btn-outline" data-del="${p.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $$('#paymentsTable [data-del]').forEach(b=> b.onclick=()=>{ state.payments = state.payments.filter(x=>x.id!==b.dataset.del); save(); toast('Pago eliminado'); });
  $$('#paymentsTable [data-edit]').forEach(b=> b.onclick=()=> editPayment(b.dataset.edit));
  $$('#paymentsTable [data-irs]').forEach(b=> b.onclick=()=> toggleIRS(b.dataset.irs));
  $$('#paymentsTable [data-ss]').forEach(b=> b.onclick=()=> toggleSS(b.dataset.ss));
  updatePayrollSummaryCards();
}
function editPayment(id){
  const i=state.payments.findIndex(x=>x.id===id); if(i<0) return;
  const p=state.payments[i];
  let r=ask(p.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; p.date=r.value||p.date;
  r=ask(p.to,'Empleado'); if(r.cancelled) return; p.to=r.value||p.to;
  r=ask(p.category,'Categoría'); if(r.cancelled) return; p.category=r.value||p.category;
  r=askNumber(p.gross,'Monto bruto'); if(r.cancelled) return; p.gross=r.value;
  // recalcular dependientes
  p.salon = computeSalon(p.gross);
  p.ret408 = computeRet408(p.gross, p.salon);
  r=askNumber(p.retSS ?? 0,'Seguro Social'); if(r.cancelled) return; p.retSS=r.value;
  p.amount = computeNet(p.gross, p.salon, p.ret408, p.retSS);
  r=ask(p.status,'Estado (Pendiente/Pagado)'); if(r.cancelled) return; p.status=r.value||p.status;
  save(); toast('Pago actualizado');
}
function toggleIRS(id){
  const p=state.payments.find(x=>x.id===id); if(!p) return;
  p.irsPaid = !p.irsPaid; p.irsPaidAt = p.irsPaid ? todayStr() : null;
  save(); toast(p.irsPaid?'Ret. 408 marcada como PAGADA':'Ret. 408 vuelta a PENDIENTE');
}
function toggleSS(id){
  const p=state.payments.find(x=>x.id===id); if(!p) return;
  p.ssPaid = !p.ssPaid; p.ssPaidAt = p.ssPaid ? todayStr() : null;
  save(); toast(p.ssPaid?'SS marcada como PAGADA':'SS vuelta a PENDIENTE');
}
function wirePayments(){
  wirePayrollInputs();
  $('#paymentForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const {g, salon, r408, ss, net} = payrollComputeAll();
    const rec={
      id:uid(),
      date:     $('#payDate')?.value,
      to:       $('#payTo')?.value,
      category: $('#payCategory')?.value||'Nómina',
      gross:    g,
      salon:    salon,
      ret408:   r408,
      retSS:    ss,
      amount:   net,     // neto
      status:   $('#payStatus')?.value || 'Pendiente',
      irsPaid:  false,
      ssPaid:   false
    };
    if(!rec.date || !rec.to) return toast('Fecha y empleado requeridos');
    state.payments.push(rec); save(); toast('Pago guardado'); ev.target.reset(); wirePayrollInputs();
  });
  $('#addPayment')?.addEventListener('click', ()=>{ if($('#payDate')) $('#payDate').value=todayStr(); payrollComputeAll(); });
}
function updatePayrollSummaryCards(){
  const now=new Date(); const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const today=now.toISOString().slice(0,10);
  const inMonth = state.payments.filter(p=>inRange(p.date,monthStart,today));
  const sumSalon = inMonth.reduce((a,p)=>a+Number(p.salon||0),0);
  const sum408Pending = inMonth.filter(p=>!p.irsPaid).reduce((a,p)=>a+Number(p.ret408||0),0);
  const sum408Paid    = inMonth.filter(p=> p.irsPaid).reduce((a,p)=>a+Number(p.ret408||0),0);
  const sumSSPending  = inMonth.filter(p=>!p.ssPaid ).reduce((a,p)=>a+Number(p.retSS||0),0);
  const sumSSPaid     = inMonth.filter(p=> p.ssPaid ).reduce((a,p)=>a+Number(p.retSS||0),0);

  $('#sumSalonMonth')       && ($('#sumSalonMonth').textContent       = fmt(sumSalon));
  $('#sum408PendingMonth')  && ($('#sum408PendingMonth').textContent  = fmt(sum408Pending));
  $('#sum408PaidMonth')     && ($('#sum408PaidMonth').textContent     = fmt(sum408Paid));
  $('#sumSSPendingMonth')   && ($('#sumSSPendingMonth').textContent   = fmt(sumSSPending));
  $('#sumSSPaidMonth')      && ($('#sumSSPaidMonth').textContent      = fmt(sumSSPaid));

  // Totales de nómina (neto)
  let total=0, paid=0;
  inMonth.forEach(p=>{ total+=Number(p.amount||0); if((p.status||'')==='Pagado') paid+=Number(p.amount||0); });
  const pending = total - paid;
  $('#payrollTotal')   && ($('#payrollTotal').textContent   = fmt(total));
  $('#payrollPaid')    && ($('#payrollPaid').textContent    = fmt(paid));
  $('#payrollPending') && ($('#payrollPending').textContent = fmt(pending));
}

/* ===================== Retenciones (historial) ===================== */
function renderRetentions(){
  const tbody = $('#retTable tbody'); if(!tbody) return;
  tbody.innerHTML='';
  const from=$('#fRetFrom')?.value, to=$('#fRetTo')?.value;
  const who=($('#fRetEmp')?.value||'').trim().toLowerCase();

  let total408Pend=0,total408Paid=0,totalSSPend=0,totalSSPaid=0;

  state.payments.filter(p=>{
    if(!inRange(p.date,from,to)) return false;
    if(who && !(p.to||'').toLowerCase().includes(who)) return false;
    return true;
  }).sort(byDateDesc).forEach(p=>{
    if(p.irsPaid) total408Paid+=Number(p.ret408||0); else total408Pend+=Number(p.ret408||0);
    if(p.ssPaid ) totalSSPaid +=Number(p.retSS||0); else totalSSPend +=Number(p.retSS||0);

    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${p.date}</td>
      <td>${p.to||''}</td>
      <td>${fmt(p.gross||0)}</td>
      <td>${fmt(p.salon||0)}</td>
      <td>${fmt(p.ret408||0)}</td>
      <td>${p.irsPaid? '✓ '+(p.irsPaidAt||'') : '—'}</td>
      <td>${fmt(p.retSS||0)}</td>
      <td>${p.ssPaid? '✓ '+(p.ssPaidAt||'') : '—'}</td>
      <td>${fmt(p.amount||0)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-irs="${p.id}">${p.irsPaid?'408 Pagada':'Pagar 408'}</button>
        <button class="btn-outline" data-ss="${p.id}">${p.ssPaid?'SS Pagada':'Pagar SS'}</button>
      </td>`;
    tbody.appendChild(tr);
  });

  $('#r408Pend') && ($('#r408Pend').textContent = fmt(total408Pend));
  $('#r408Paid') && ($('#r408Paid').textContent = fmt(total408Paid));
  $('#rssPend')  && ($('#rssPend').textContent  = fmt(totalSSPend));
  $('#rssPaid')  && ($('#rssPaid').textContent  = fmt(totalSSPaid));

  $$('#retTable [data-irs]').forEach(b=> b.onclick=()=> toggleIRS(b.dataset.irs));
  $$('#retTable [data-ss]').forEach(b=> b.onclick=()=> toggleSS(b.dataset.ss));
}
function wireRetentions(){
  $('#fRetApply')?.addEventListener('click', renderRetentions);
}

/* ===================== Reportes / Inicio (REGLA NUEVA) ===================== */
function sumRange(list, from, to){ if(!Array.isArray(list)) return 0; return list.filter(r=>inRange(r.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0); }
function sumExpensesDailySplit(from, to){
  let recurrent=0, nonRec=0;
  const isRec=e=>(e.method==='Automático'||(e.desc||'').toLowerCase().startsWith('recurrente'));
  state.expensesDaily.filter(e=>inRange(e.date, from, to)).forEach(e=>{
    const amt=Number(e.amount||0); if(isRec(e)) recurrent+=amt; else nonRec+=amt;
  });
  return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec };
}
function sumPersonalRange(from, to){ return state.personal.filter(p=>inRange(p.date,from,to)).reduce((a,b)=>a+Number(b.amount||0),0); }

// Ingreso de negocio = Salón ingreso + Ret. 408 PENDIENTE
function sumSalonIncomeRange(from,to){ return state.payments.filter(p=>inRange(p.date,from,to)).reduce((a,p)=>a+Number(p.salon||0),0); }
function sumRet408PendingRange(from,to){ return state.payments.filter(p=>inRange(p.date,from,to) && !p.irsPaid).reduce((a,p)=>a+Number(p.ret408||0),0); }

// Gastos de nómina = Neto + 408 PAGADA (SS también como gasto cuando se paga)
function payrollNetRange(from, to){ return state.payments.filter(p=>inRange(p.date,from,to)).reduce((a,p)=>a+Number(p.amount||0),0); }
function ret408PaidRange(from,to){ return state.payments.filter(p=>inRange(p.date,from,to) && p.irsPaid).reduce((a,p)=>a+Number(p.ret408||0),0); }
function ssPaidRange(from,to){ return state.payments.filter(p=>inRange(p.date,from,to) && p.ssPaid).reduce((a,p)=>a+Number(p.retSS||0),0); }

function renderReports(){
  const now=new Date(); const today=now.toISOString().slice(0,10);
  const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const yearStart=new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
  const weekStart=(()=>{ const x=new Date(now); const day=x.getDay()||7; x.setDate(x.getDate()-day+1); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); })();

  // INGRESOS
  const incToday = sumSalonIncomeRange(today,today) + sumRet408PendingRange(today,today);
  const incWeek  = sumSalonIncomeRange(weekStart,today) + sumRet408PendingRange(weekStart,today);
  const incMonth = sumSalonIncomeRange(monthStart,today) + sumRet408PendingRange(monthStart,today);
  const incYear  = sumSalonIncomeRange(yearStart,today) + sumRet408PendingRange(yearStart,today);

  // GASTOS
  const expTodaySplit=sumExpensesDailySplit(today,today);
  const expWeekSplit=sumExpensesDailySplit(weekStart,today);
  const expMonthSplit=sumExpensesDailySplit(monthStart,today);
  const expYearSplit=sumExpensesDailySplit(yearStart,today);

  const perToday=sumPersonalRange(today,today);
  const perWeek=sumPersonalRange(weekStart,today);
  const perMonth=sumPersonalRange(monthStart,today);
  const perYear=sumPersonalRange(yearStart,today);

  const payToday= payrollNetRange(today,today) + ret408PaidRange(today,today) + ssPaidRange(today,today);
  const payWeek = payrollNetRange(weekStart,today) + ret408PaidRange(weekStart,today) + ssPaidRange(weekStart,today);
  const payMonth= payrollNetRange(monthStart,today) + ret408PaidRange(monthStart,today) + ssPaidRange(monthStart,today);
  const payYear = payrollNetRange(yearStart,today) + ret408PaidRange(yearStart,today) + ssPaidRange(yearStart,today);

  const expToday=expTodaySplit.total+perToday+payToday;
  const expWeek=expWeekSplit.total+perWeek+payWeek;
  const expMonth=expMonthSplit.total+perMonth+payMonth;
  const expYear=expYearSplit.total+perYear+payYear;

  $('#rToday') && ($('#rToday').textContent = `${fmt(incToday)} / ${fmt(expToday)}`);
  $('#rWeek')  && ($('#rWeek').textContent  = `${fmt(incWeek)} / ${fmt(expWeek)}`);
  $('#rMonth') && ($('#rMonth').textContent = `${fmt(incMonth)} / ${fmt(expMonth)}`);
  $('#rYear')  && ($('#rYear').textContent  = `${fmt(incYear)} / ${fmt(expYear)}`);
}
function renderHome(){
  const now=new Date(); 
  const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10); 
  const today=now.toISOString().slice(0,10);

  // INGRESO MES = Salón + 408 pendiente
  const incMonth = sumSalonIncomeRange(monthStart, today) + sumRet408PendingRange(monthStart, today);

  // GASTOS MES = gastos + personales + neto + 408 pagada + SS pagada
  const expSplit=sumExpensesDailySplit(monthStart, today); 
  const perMonth=sumPersonalRange(monthStart,today); 
  const payMonth= payrollNetRange(monthStart,today) + ret408PaidRange(monthStart,today) + ssPaidRange(monthStart,today);
  const totalExp=expSplit.total+perMonth+payMonth; 
  const balance=incMonth-totalExp;

  $('#kpiIncomesMonth') && ($('#kpiIncomesMonth').textContent=fmt(incMonth));
  $('#kpiExpensesMonth') && ($('#kpiExpensesMonth').textContent=fmt(totalExp));
  $('#kpiBalanceMonth') && ($('#kpiBalanceMonth').textContent=fmt(balance));

  // Gráfica 12 meses — Ingreso = Salón + 408 pendiente
  const c=$('#chart12'); if(!c) return; const ctx=c.getContext('2d'); 
  c.width=c.clientWidth; c.height=180; ctx.clearRect(0,0,c.width,c.height);
  const months=[], inc=[], exp=[];
  for(let i=11;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const from=new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10);
    const to=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10);
    months.push(d.toLocaleDateString('es-ES',{month:'short'}));
    const incM = sumSalonIncomeRange(from,to) + sumRet408PendingRange(from, to);
    const expSplitM=sumExpensesDailySplit(from, to);
    const perM=sumPersonalRange(from,to);
    const payM= payrollNetRange(from,to) + ret408PaidRange(from,to) + ssPaidRange(from,to);
    exp.push(expSplitM.total+perM+payM); inc.push(incM);
  }
  const max=Math.max(...inc,...exp,1); const barW=Math.floor((c.width-40)/(months.length*2));
  months.forEach((m,idx)=>{
    const x=idx*(barW*2)+20; 
    const hI=Math.round((inc[idx]/max)*(c.height-30)); 
    const hE=Math.round((exp[idx]/max)*(c.height-30));
    ctx.fillStyle='#C7A24B'; ctx.fillRect(x,c.height-10-hI,barW,hI);
    ctx.fillStyle='#555';    ctx.fillRect(x+barW+4,c.height-10-hE,barW,hE);
    ctx.fillStyle='#aaa';    ctx.font='12px system-ui'; ctx.fillText(m,x,c.height-2);
  });
}

/* ===================== Exportar/Importar JSON ===================== */
function exportJSON(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='finanzas-backup.json'; a.click(); URL.revokeObjectURL(a.href);
  toast('JSON exportado');
}
function importJSON(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const incoming=JSON.parse(reader.result);
      if(confirm('¿Reemplazar TODO con el archivo? (Cancelar = fusionar)')){
        state=incoming; save(); toast('Datos reemplazados'); location.reload();
      }else{
        state.settings=Object.assign({},state.settings,incoming.settings||{});
        ['expensesDaily','incomesDaily','payments','ordinary','budgets','personal','invoices','quotes','reconciliations'].forEach(k=>{
          if(Array.isArray(incoming[k])) state[k]=state[k].concat(incoming[k]);
        });
        save(); toast('Datos fusionados'); location.reload();
      }
    }catch{ toast('Archivo inválido'); }
  };
  reader.readAsText(file);
}

/* ===================== PDF (jsPDF B/N) ===================== */
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
async function generatePDF(view="expenses", optionalId=null){
  await ensureJsPDF(); const { jsPDF }=window.jspdf; const doc=new jsPDF({unit:"mm",format:"a4"});

  const business=state.settings.businessName||"Mi Negocio";
  const logo=state.settings.logoBase64;

  function header(title){
    try{ if(logo && logo.startsWith('data:')) doc.addImage(logo,'PNG',14,10,24,24);}catch{}
    doc.setFont("helvetica","bold"); doc.setTextColor(0); doc.setFontSize(16); doc.text(business,42,18);
    doc.setFontSize(12); doc.text(title,42,26); doc.line(14,36,200,36);
  }
  function table(headers, rows, startY=42){ let y=startY; const colW=180/headers.length;
    doc.setFont("helvetica","bold"); doc.setFontSize(10); headers.forEach((h,i)=>doc.text(String(h),14+i*colW,y));
    y+=6; doc.line(14,y,200,y); y+=6; doc.setFont("helvetica","normal");
    rows.forEach(r=>{ r.forEach((c,i)=>doc.text(String(c??'').slice(0,32),14+i*colW,y)); y+=6; if(y>280){doc.addPage(); y=20;} });
    return y;
  }

  if(view==='retentions'){
    header('RETENCIONES (408 / SS)');
    const rows = state.payments.slice().sort(byDateDesc).map(p=>[
      p.date, p.to||'', (p.gross||0).toFixed(2), (p.salon||0).toFixed(2),
      (p.ret408||0).toFixed(2), p.irsPaid?'Sí':'No', (p.retSS||0).toFixed(2), p.ssPaid?'Sí':'No', (p.amount||0).toFixed(2)
    ]);
    let y=table(["Fecha","Empleado","Bruto","Salón","Ret408","408 Pag.","SS","SS Pag.","Neto"], rows, 42);
    doc.save(`${(business||'Negocio').replace(/\s+/g,'_')}_Retenciones.pdf`); return;
  }

  // Listas estándar
  const titleMap={ payments:"PAGO DE NÓMINA", invoices:"FACTURAS", quotes:"COTIZACIONES", reconciliations:"CONCILIACIÓN BANCARIA" };
  const title = titleMap[view] || view.toUpperCase();
  header(title);
  let headers=[], rows=[], total=null;

  if(view==="expenses"){ headers=["Fecha","Categoría","Descripción","Método","Ref","Monto"]; rows=state.expensesDaily.map(e=>[e.date,e.category,e.desc,e.method,e.ref||'',Number(e.amount||0).toFixed(2)]); total=state.expensesDaily.reduce((a,e)=>a+Number(e.amount||0),0); }
  else if(view==="incomes"){ headers=["Fecha","Empleado/Origen","Método","Ref","Monto"]; rows=state.incomesDaily.map(i=>[i.date,i.client,i.method,i.ref||'',Number(i.amount||0).toFixed(2)]); total=state.incomesDaily.reduce((a,i)=>a+Number(i.amount||0),0); }
  else if(view==="payments"){ headers=["Fecha","Empleado","Bruto","Salón","Ret408","SS","Neto","Estado"]; rows=state.payments.map(p=>[p.date,p.to,Number(p.gross||0).toFixed(2),Number(p.salon||0).toFixed(2),Number(p.ret408||0).toFixed(2),Number(p.retSS||0).toFixed(2),Number(p.amount||0).toFixed(2),p.status||'']); total=state.payments.reduce((a,p)=>a+Number(p.amount||0),0); }
  else if(view==="ordinary"){ headers=["Nombre","Monto","Frecuencia","Próxima"]; rows=state.ordinary.map(o=>[o.name,Number(o.amount||0).toFixed(2),o.freq,o.next]); }
  else if(view==="personal"){ headers=["Fecha","Categoría","Descripción","Monto"]; rows=state.personal.map(p=>[p.date,p.category,p.desc,Number(p.amount||0).toFixed(2)]); total=state.personal.reduce((a,p)=>a+Number(p.amount||0),0); }
  else if(view==="invoices"){ headers=["Fecha","# Factura","Cliente","Total","Método"]; rows=state.invoices.map(f=>[f.date,f.number,f.client?.name||"",Number(f.total||0).toFixed(2),f.method||""]); total=state.invoices.reduce((a,f)=>a+Number(f.total||0),0); }
  else if(view==="quotes"){ headers=["Fecha","# Cotización","Cliente","Total","Método"]; rows=state.quotes.map(q=>[q.date,q.number,q.client?.name||"",Number(q.total||0).toFixed(2),q.method||""]); total=state.quotes.reduce((a,q)=>a+Number(q.total||0),0); }
  else if(view==="reconciliations"){ headers=["Fecha","Saldo Banco","Balance App","Diferencia","Nota"]; rows=state.reconciliations.map(r=>[r.date,Number(r.bank||0).toFixed(2),Number(r.app||0).toFixed(2),Number(r.diff||0).toFixed(2),(r.note||'').slice(0,24)]); }

  let y=table(headers, rows, 42);
  if(total!==null){ if(y+10>290){doc.addPage(); y=20;} doc.line(14,y,200,y); y+=7; doc.setFont("helvetica","bold"); doc.text("TOTAL",154,y); doc.text(fmt(total),200,y,{align:'right'}); }
  doc.save(`${(business||'Negocio').replace(/\s+/g,'_')}_${(title||view)}.pdf`);
}
function wireExports(){
  $$('[data-print-view]').forEach(b=> b.addEventListener('click', ()=> generatePDF(b.dataset.printView)));
  $('#printBtn')?.addEventListener('click', ()=>{ const current=document.querySelector('.view.visible')?.id||'home'; generatePDF(current); });
}

/* ===================== Configuración / Datos / PIN ===================== */
function wireSettings(){
  $('#saveSettings')?.addEventListener('click', ()=>{
    state.settings.businessName=$('#setName')?.value||'Mi Negocio';
    state.settings.currency=$('#setCurrency')?.value||'USD';
    state.settings.theme.primary=$('#colorPrimary')?.value||state.settings.theme.primary;
    state.settings.theme.accent=$('#colorAccent')?.value||state.settings.theme.accent;
    state.settings.theme.text=$('#colorText')?.value||state.settings.theme.text;
    save(); toast('Configuración guardada');
  });
  $('#setLogo')?.addEventListener('change', async (ev)=>{
    const f=ev.target.files[0]; if(!f) return;
    const base64=await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f); });
    state.settings.logoBase64=base64; save(); toast('Logo actualizado');
  });
  $('#delLogo')?.addEventListener('click', ()=>{ state.settings.logoBase64=''; save(); toast('Logo eliminado'); });
  $('#exportJSON')?.addEventListener('click', exportJSON);
  $('#importJSON')?.addEventListener('change', (ev)=>{ const f=ev.target.files[0]; if(f) importJSON(f); });
  $('#changePIN')?.addEventListener('click', async ()=>{
    const old=$('#pinOld')?.value; const n1=$('#pinNew')?.value; const n2=$('#pinNew2')?.value;
    if(!state.settings.pinHash) return toast('Primero crea un PIN');
    const hashOld=await sha256(old||''); if(hashOld!==state.settings.pinHash) return toast('PIN actual incorrecto');
    if(n1!==n2 || (n1||'').length<4 || (n1||'').length>8) return toast('Nuevo PIN inválido');
    state.settings.pinHash=await sha256(n1); save(); toast('PIN actualizado'); ['pinOld','pinNew','pinNew2'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
  });
}

/* ===================== Conciliación Bancaria (resumen simple) ===================== */
function calcBalanceApp(){
  // Ingreso "de negocio" acumulado total = salón + 408 pendiente (en cualquier fecha)
  // Pero para balance contable general simple, usamos todos los movimientos
  const inc=state.incomesDaily.reduce((a,b)=>a+Number(b.amount||0),0); // informativos
  const salon = state.payments.reduce((a,b)=>a+Number(b.salon||0),0);
  const r408Pend = state.payments.filter(p=>!p.irsPaid).reduce((a,b)=>a+Number(b.ret408||0),0);
  const ingresoNegocio = salon + r408Pend;

  const exp=state.expensesDaily.reduce((a,b)=>a+Number(b.amount||0),0);
  const payNeto=state.payments.reduce((a,b)=>a+Number(b.amount||0),0);
  const r408Pag=state.payments.filter(p=>p.irsPaid).reduce((a,b)=>a+Number(b.ret408||0),0);
  const ssPag=state.payments.filter(p=>p.ssPaid).reduce((a,b)=>a+Number(b.retSS||0),0);
  const per=state.personal.reduce((a,b)=>a+Number(b.amount||0),0);

  return (ingresoNegocio) - (exp + payNeto + r408Pag + ssPag + per);
}
function renderReconciliations(){
  const tbody=$('#reconTable tbody'); if(!tbody)return; tbody.innerHTML="";
  state.reconciliations.slice().sort(byDateDesc).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${r.date}</td><td>${fmt(r.bank)}</td><td>${fmt(r.app)}</td>
      <td>${fmt(r.diff)}</td><td>${r.note||""}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${r.id}">Editar</button>
        <button class="btn-outline" data-del="${r.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $$('#reconTable [data-del]').forEach(b=>b.onclick=()=>{ state.reconciliations=state.reconciliations.filter(x=>x.id!==b.dataset.del); save(); toast("Eliminado"); });
  $$('#reconTable [data-edit]').forEach(b=>b.onclick=()=>editReconciliation(b.dataset.edit));
}
function editReconciliation(id){
  const i=state.reconciliations.findIndex(x=>x.id===id); if(i<0)return;
  const r=state.reconciliations[i];
  let q=ask(r.date,"Fecha (YYYY-MM-DD)"); if(q.cancelled)return; r.date=q.value;
  q=askNumber(r.bank,"Saldo banco"); if(q.cancelled)return; r.bank=q.value;
  q=ask(r.note,"Nota"); if(q.cancelled)return; r.note=q.value;
  r.app=calcBalanceApp(); r.diff=(r.bank||0)-(r.app||0); save(); toast("Conciliación actualizada");
}
function wireReconciliation(){
  $('#reconForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), date:$('#reconDate').value, bank:Number($('#reconBank').value||0),
      app:calcBalanceApp(), diff:0, note:$('#reconNote').value };
    rec.diff=rec.bank-rec.app; state.reconciliations.push(rec); save(); toast("Conciliación guardada"); ev.target.reset();
  });
  $('#reconExport')?.addEventListener('click',()=>generatePDF("reconciliations"));
}

/* ===================== Cloud (Firestore) ===================== */
const cloud={ user:null, autosync: JSON.parse(localStorage.getItem('autosync')||'false'), unsub:null };
function uiCloud(){
  $('#cloudStatus') && ($('#cloudStatus').textContent = cloud.user ? `Conectado como ${cloud.user.displayName||cloud.user.email||cloud.user.uid}` : 'No conectado');
  $('#btnSignIn') && ($('#btnSignIn').style.display  = cloud.user ? 'none' : 'inline-block');
  $('#btnSignOut') && ($('#btnSignOut').style.display = cloud.user ? 'inline-block' : 'none');
  $('#cloudAuto') && ($('#cloudAuto').checked = !!cloud.autosync);
}
function setAutosync(v){ cloud.autosync=!!v; localStorage.setItem('autosync', JSON.stringify(cloud.autosync)); uiCloud(); }
function cloudDocRef(){ if(!cloud.user) return null; return doc(db,'users',cloud.user.uid,'state','app'); }
async function cloudPull(replace=true){
  const ref=cloudDocRef(); if(!ref) return toast('Inicia sesión primero');
  const snap=await getDoc(ref); if(!snap.exists()) return toast('No hay datos en la nube');
  const remote=snap.data(), rU=remote?._cloud?.updatedAt||0, lU=state?._cloud?.updatedAt||0;
  if(replace || rU>=lU){ state=remote; } else {
    state.settings=Object.assign({}, state.settings, remote.settings||{});
    ['expensesDaily','incomesDaily','payments','ordinary','budgets','personal','invoices','quotes','reconciliations'].forEach(k=>{
      if(Array.isArray(remote[k])) state[k]=state[k].concat(remote[k]);
    });
    state._cloud.updatedAt=Math.max(lU,rU);
  }
  save({skipCloud:true}); toast('Datos cargados desde la nube'); refreshAll();
}
async function cloudPush(){
  const ref=cloudDocRef(); if(!ref) return toast('Inicia sesión primero');
  state._cloud.updatedAt=nowMs();
  await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge:true });
  save({skipCloud:true}); toast('Datos guardados en la nube');
}
let pushTimer; function cloudPushDebounced(){ clearTimeout(pushTimer); pushTimer=setTimeout(cloudPush,600); }
function cloudSubscribe(){
  if(!cloud.user) return; const ref=cloudDocRef(); cloud.unsub?.();
  cloud.unsub = onSnapshot(ref,(snap)=>{
    if(!snap.exists()) return;
    const remote=snap.data();
    if((remote?._cloud?.updatedAt||0)>(state?._cloud?.updatedAt||0)){
      state=remote; save({skipCloud:true}); toast('Actualizado desde la nube'); refreshAll();
    }
  });
}
function wireCloudUI(){
  const provider=new GoogleAuthProvider();
  $('#btnSignIn')?.addEventListener('click', async ()=>{
    try{ await signInWithPopup(auth, provider); }catch(e){ await signInWithRedirect(auth, provider); }
  });
  $('#btnSignOut')?.addEventListener('click', async ()=>{ await signOut(auth); });
  $('#cloudPull')?.addEventListener('click', ()=> cloudPull(true));
  $('#cloudPush')?.addEventListener('click', ()=> cloudPush());
  $('#cloudAuto')?.addEventListener('change', (e)=> setAutosync(e.target.checked));
  uiCloud(); getRedirectResult(auth).catch(()=>{});
  onAuthStateChanged(auth,(user)=>{ cloud.user=user||null; uiCloud(); if(user){ cloudSubscribe(); } else { cloud.unsub?.(); cloud.unsub=null; }});
}

/* ===================== Buscadores en historiales ===================== */
function wireHistorySearch(){
  $('#invSearch')?.addEventListener('input', (e)=> renderInvoicesHistory(e.target.value));
  $('#quoSearch')?.addEventListener('input', (e)=> renderQuotesHistory(e.target.value));
}

/* ===================== Facturas/Cotizaciones (igual que antes) ===================== */
function uidItem(){ return Math.random().toString(36).slice(2,7); }
function addItemRow(tbody){
  const tr=document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" placeholder="Descripción"></td>
    <td><input type="number" step="0.01" value="1"></td>
    <td><input type="number" step="0.01" value="0"></td>
    <td><input type="number" step="0.01" value="0"></td>
    <td class="amount-cell">0.00</td>
    <td><button type="button" class="btn-outline btnDelRow">✕</button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btnDelRow').onclick=()=> tr.remove();
}
function readItemsFromTable(tbody){
  const items=[];
  tbody.querySelectorAll('tr').forEach(tr=>{
    const [desc, qty, price, tax] = Array.from(tr.querySelectorAll('input')).map(i=>i.value);
    const q=parseFloat(qty||'0')||0, p=parseFloat(price||'0')||0, t=parseFloat(tax||'0')||0;
    items.push({ id:uidItem(), desc:(desc||'').trim(), qty:q, price:p, tax:t });
  });
  return items;
}
function calcTotals(items){
  let subtotal=0,taxTotal=0;
  items.forEach(it=>{
    const base=(it.qty||0)*(it.price||0);
    const tax=base*((it.tax||0)/100);
    subtotal+=base; taxTotal+=tax;
  });
  return { subtotal, taxTotal, total: subtotal+taxTotal };
}
function paintRowAmounts(tbody){
  tbody.querySelectorAll('tr').forEach(tr=>{
    const [desc, qty, price, tax] = Array.from(tr.querySelectorAll('input')).map(i=>i.value);
    const q=parseFloat(qty||'0')||0, p=parseFloat(price||'0')||0, t=parseFloat(tax||'0')||0;
    const base=q*p, taxAmt=base*(t/100), amt=base+taxAmt;
    tr.querySelector('.amount-cell').textContent = amt.toFixed(2);
  });
}
function renderInvoicesKPI(){ /* opcional, sin cambios fuertes */ }
function wireInvoicesCreate(){
  $('#invAddItem')?.addEventListener('click', ()=> addItemRow($('#invItemsTable tbody')));
  $('#invCalc')?.addEventListener('click', ()=>{
    const tb=$('#invItemsTable tbody'); paintRowAmounts(tb);
    const t = calcTotals(readItemsFromTable(tb));
    $('#invSubtotal').textContent=fmt(t.subtotal);
    $('#invTaxTotal').textContent=fmt(t.taxTotal);
    $('#invGrandTotal').textContent=fmt(t.total);
  });
  $('#addInvoiceToday')?.addEventListener('click', ()=>{ if($('#invDate')) $('#invDate').value=todayStr(); });
  $('#invoiceForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const items=readItemsFromTable($('#invItemsTable tbody'));
    const t=calcTotals(items);
    const inv={
      id:uid(),
      date:$('#invDate')?.value,
      dueDate:$('#invDueDate')?.value,
      number:$('#invNumber')?.value,
      method:$('#invMethod')?.value,
      client:{
        name:$('#invClient')?.value,
        email:$('#invClientEmail')?.value,
        phone:$('#invClientPhone')?.value,
        address:$('#invClientAddress')?.value
      },
      items,
      subtotal:t.subtotal, taxTotal:t.taxTotal, total:t.total,
      note:$('#invNote')?.value, terms:$('#invTerms')?.value
    };
    if(!inv.date || !inv.number) return toast('Fecha y número requeridos');
    // NO auto-registrar ingreso contable (tu ingreso de negocio viene por nómina reglas)
    state.invoices.push(inv); save(); toast('Factura creada');
    ev.target.reset(); $('#invItemsTable tbody').innerHTML='';
    $('#invSubtotal').textContent='—'; $('#invTaxTotal').textContent='—'; $('#invGrandTotal').textContent='—';
  });
}
function renderInvoicesHistory(q=''){
  const tb=$('#invoicesTable tbody'); if(!tb) return; tb.innerHTML='';
  const s=(q||'').toLowerCase().trim();
  state.invoices.slice().sort(byDateDesc).forEach(inv=>{
    const hay = `${inv.number||''} ${inv.client?.name||''}`.toLowerCase();
    if(s && !hay.includes(s)) return;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${inv.date||''}</td>
      <td>${inv.number||''}</td>
      <td>${inv.client?.name||''}</td>
      <td>${fmt(inv.total||0)}</td>
      <td>${inv.method||''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-pdf="${inv.id}">PDF</button>
        <button class="btn-outline" data-edit="${inv.id}">Editar</button>
        <button class="btn-outline" data-del="${inv.id}">Eliminar</button>
      </td>`;
    tb.appendChild(tr);
  });
  $$('#invoicesTable [data-del]').forEach(b=> b.onclick=()=> deleteInvoice(b.dataset.del));
  $$('#invoicesTable [data-edit]').forEach(b=> b.onclick=()=> editInvoiceBasic(b.dataset.edit));
  $$('#invoicesTable [data-pdf]').forEach(b=> b.onclick=()=> generatePDF('invoices', b.dataset.pdf));
}
function deleteInvoice(id){ state.invoices = state.invoices.filter(x=>x.id!==id); save(); toast('Factura eliminada'); }
function editInvoiceBasic(id){
  const i=state.invoices.findIndex(x=>x.id===id); if(i<0) return;
  const inv=state.invoices[i];
  let r=ask(inv.date,'Fecha'); if(r.cancelled) return; inv.date=r.value||inv.date;
  r=ask(inv.dueDate,'Vence'); if(r.cancelled) return; inv.dueDate=r.value||inv.dueDate;
  r=ask(inv.number,'# Factura'); if(r.cancelled) return; inv.number=r.value||inv.number;
  r=ask(inv.method,'Método'); if(r.cancelled) return; inv.method=r.value||inv.method;
  r=ask(inv.client?.name,'Cliente'); if(r.cancelled) return; inv.client=inv.client||{}; inv.client.name=r.value||inv.client.name;
  save(); toast('Factura actualizada');
}
function wireQuotesCreate(){
  $('#quoAddItem')?.addEventListener('click', ()=> addItemRow($('#quoItemsTable tbody')));
  $('#quoCalc')?.addEventListener('click', ()=>{
    const tb=$('#quoItemsTable tbody'); paintRowAmounts(tb);
    const t=calcTotals(readItemsFromTable(tb));
    $('#quoSubtotal').textContent=fmt(t.subtotal);
    $('#quoTaxTotal').textContent=fmt(t.taxTotal);
    $('#quoGrandTotal').textContent=fmt(t.total);
  });
  $('#addQuoteToday')?.addEventListener('click', ()=>{ if($('#quoDate')) $('#quoDate').value=todayStr(); });
  $('#quoteForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const items=readItemsFromTable($('#quoItemsTable tbody'));
    const t=calcTotals(items);
    const q={
      id:uid(),
      date:$('#quoDate')?.value,
      validUntil:$('#quoValidUntil')?.value,
      number:$('#quoNumber')?.value,
      method:$('#quoMethod')?.value,
      client:{
        name:$('#quoClient')?.value,
        email:$('#quoClientEmail')?.value,
        phone:$('#quoClientPhone')?.value,
        address:$('#quoClientAddress')?.value
      },
      items, subtotal:t.subtotal, taxTotal:t.taxTotal, total:t.total,
      note:$('#quoNote')?.value, terms:$('#quoTerms')?.value
    };
    if(!q.date || !q.number) return toast('Fecha y número requeridos');
    state.quotes.push(q); save(); toast('Cotización creada');
    ev.target.reset(); $('#quoItemsTable tbody').innerHTML='';
    $('#quoSubtotal').textContent='—'; $('#quoTaxTotal').textContent='—'; $('#quoGrandTotal').textContent='—';
  });
}
function renderQuotesHistory(q=''){
  const tb=$('#quotesTable tbody'); if(!tb) return; tb.innerHTML='';
  const s=(q||'').toLowerCase().trim();
  state.quotes.slice().sort(byDateDesc).forEach(qu=>{
    const hay = `${qu.number||''} ${qu.client?.name||''}`.toLowerCase();
    if(s && !hay.includes(s)) return;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${qu.date||''}</td>
      <td>${qu.number||''}</td>
      <td>${qu.client?.name||''}</td>
      <td>${fmt(qu.total||0)}</td>
      <td>${qu.method||''}</td>
      <td class="row-actions">
        <button class="btn-outline" data-pdf="${qu.id}">PDF</button>
        <button class="btn-outline" data-edit="${qu.id}">Editar</button>
        <button class="btn-outline" data-del="${qu.id}">Eliminar</button>
      </td>`;
    tb.appendChild(tr);
  });
  $$('#quotesTable [data-del]').forEach(b=> b.onclick=()=>{ state.quotes = state.quotes.filter(x=>x.id!==b.dataset.del); save(); toast('Cotización eliminada'); });
  $$('#quotesTable [data-edit]').forEach(b=> b.onclick=()=> editQuoteBasic(b.dataset.edit));
  $$('#quotesTable [data-pdf]').forEach(b=> b.onclick=()=> generatePDF('quotes', b.dataset.pdf));
}
function editQuoteBasic(id){
  const i=state.quotes.findIndex(x=>x.id===id); if(i<0) return;
  const q=state.quotes[i];
  let r=ask(q.date,'Fecha'); if(r.cancelled) return; q.date=r.value||q.date;
  r=ask(q.validUntil,'Vigencia'); if(r.cancelled) return; q.validUntil=r.value||q.validUntil;
  r=ask(q.number,'# Cotización'); if(r.cancelled) return; q.number=r.value||q.number;
  r=ask(q.method,'Método'); if(r.cancelled) return; q.method=r.value||q.method;
  r=ask(q.client?.name,'Cliente'); if(r.cancelled) return; q.client=q.client||{}; q.client.name=r.value||q.client.name;
  save(); toast('Cotización actualizada');
}

/* ===================== Refresh / Init ===================== */
function refreshAll(){
  renderExpenses(); renderIncomes(); renderPayments(); renderRetentions();
  renderReports(); renderHome(); renderInvoicesHistory($('#invSearch')?.value||''); renderQuotesHistory($('#quoSearch')?.value||'');
  renderReconciliations();
}
function wireAll(){
  const sidebar=$('#sidebar');
  sidebar?.addEventListener('click',(ev)=>{
    const btn=ev.target.closest?.('.nav-btn'); 
    if(btn && btn.dataset.target){ showView(btn.dataset.target); sidebar.classList.remove('open'); }
  });
  $('#menuToggle')?.addEventListener('click', ()=> sidebar?.classList.toggle('open'));

  wireExports(); wireSettings();
  wireExpenses(); wireIncomes(); wirePayments(); wireRetentions();
  wireInvoicesCreate(); wireQuotesCreate(); wireReconciliation();
  wireCloudUI(); wireHistorySearch();

  initCatalogs(); applyTheme(); refreshAll();

  // Login visible al arrancar
  updateLoginUI();
}
window.addEventListener('pageshow', (e)=>{ if(e.persisted){ updateLoginUI(); }});
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && $('#login')?.classList.contains('visible')){ forceShowLogin(); }});

/* ===================== API consola (opcional) ===================== */
self.app = { state, generatePDF, cloudPull, cloudPush };

/* ===================== Arranque ===================== */
document.addEventListener('DOMContentLoaded', wireAll);
