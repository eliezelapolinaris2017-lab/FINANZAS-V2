/* =========================================================
   Nexus Finance — app.js (Parte 1 de 3)
   ========================================================= */

/* ===================== Firebase ===================== */
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
const STORAGE_KEY = 'finanzas-state-v9';
const LOCK_KEY    = 'finanzas-lock-v2';

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
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(), 300); }, 2000);
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
  $$('.view').forEach(v=>v.classList.remove('visible'));
  const t = $('#'+id) || $('#home'); t?.classList.add('visible');
  $$('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.target===id));
  $('#viewTitle') && ($('#viewTitle').textContent = t?.dataset?.title || id || '');
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ===================== Login / PIN ===================== */
async function sha256(msg){
  const enc = new TextEncoder().encode(msg);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const attempts = ()=> Number(localStorage.getItem(LOCK_KEY)||0);
const setAttempts = n => localStorage.setItem(LOCK_KEY, String(n));
const attemptsLeft = ()=> Math.max(0, 5 - attempts());
async function handleLogin(){
  const createMode = !state.settings.pinHash;
  const pin = $('#loginPIN')?.value?.trim(); if(!pin) return toast('Introduce un PIN');
  if(createMode){
    const pin2 = $('#loginPIN2')?.value?.trim();
    if(pin.length<4 || pin.length>8) return toast('El PIN debe tener 4–8 dígitos');
    if(pin!==pin2) return toast('Los PIN no coinciden');
    state.settings.pinHash = await sha256(pin); save(); toast('PIN creado');
    $('#login')?.classList.remove('visible'); showView('home');
  }else{
    if(attempts()>=5) return toast('Bloqueado.');
    const ok = await sha256(pin) === state.settings.pinHash;
    if(ok){ setAttempts(0); toast('Bienvenido'); $('#login')?.classList.remove('visible'); showView('home'); }
    else { setAttempts(attempts()+1); toast('PIN incorrecto'); updateLoginUI(); }
  }
}
function updateLoginUI(){
  const createMode = !state.settings.pinHash;
  $('#loginTitle')  && ($('#loginTitle').textContent = createMode ? 'Crear PIN' : 'Ingresar PIN');
  $('#loginHint')   && ($('#loginHint').textContent  = createMode ? 'Crea un PIN de 4–8 dígitos.' : 'Introduce tu PIN.');
  const pin2Wrap = $('#loginPIN2');
  if(pin2Wrap) pin2Wrap.style.display = createMode ? 'block' : 'none';
  const left = attemptsLeft();
  $('#loginAttempts') && ($('#loginAttempts').textContent = createMode ? '' : (left===0 ? 'Bloqueado.' : `Intentos restantes: ${left}`));
  $('#loginBtn')?.addEventListener('click', handleLogin);
}

/* ===================== Gastos Diarios ===================== */
function renderExpenses(){
  const tbody = $('#expensesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from = $('#fExpFrom')?.value, to = $('#fExpTo')?.value; let total=0; const cats={};
  state.expensesDaily.filter(e=>inRange(e.date, from, to)).sort(byDateDesc).forEach(e=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date||''}</td><td>${e.category||''}</td><td>${e.desc||''}</td>
      <td>${e.method||''}</td><td>${fmt(e.amount)}</td><td>${e.note||''}</td>
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
  if(pills){ 
    pills.innerHTML='';
    Object.entries(cats).forEach(([k,v])=>{
      const s=document.createElement('span'); s.className='pill'; s.textContent=`${k}: ${fmt(v)}`; pills.appendChild(s);
    });
  }
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
  r=askNumber(e.amount,'Monto'); if(r.cancelled) return; e.amount=r.value;
  r=ask(e.note,'Nota'); if(r.cancelled) return; e.note=r.value||e.note;
  save(); toast('Gasto actualizado');
}
function wireExpenses(){
  $('#expenseForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), date:$('#expDate')?.value, category:$('#expCategory')?.value, desc:$('#expDesc')?.value, amount:Number($('#expAmount')?.value||0), method:$('#expMethod')?.value||'', note:$('#expNote')?.value };
    if(!rec.date) return toast('Fecha requerida');
    state.expensesDaily.push(rec); save(); toast('Gasto guardado'); ev.target.reset();
  });
  $('#fExpApply')?.addEventListener('click', renderExpenses);
  $('#addExpense')?.addEventListener('click', ()=>{ if($('#expDate')) $('#expDate').value=todayStr(); $('#expAmount')?.focus(); });
}

/* ===================== Ingresos ===================== */
function renderIncomes(){
  const tbody=$('#incomesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from=$('#fIncFrom')?.value, to=$('#fIncTo')?.value; let total=0;

  const totalsByMethod = {
    'Efectivo': 0,
    'Tarjeta': 0,
    'Cheque': 0,
    'ATH Móvil': 0,
    'Transferencia': 0
  };

  state.incomesDaily.filter(r=>inRange(r.date, from, to)).sort(byDateDesc).forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date||''}</td><td>${r.client||''}</td><td>${r.method||''}</td>
      <td>${fmt(r.amount)}</td>
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
      const div=document.createElement('div'); div.className='pill'; div.textContent=`${method}: ${fmt(value)}`; methodWrap.appendChild(div);
    });
  }
  $$('#incomesTable [data-del]').forEach(b=> b.onclick=()=>{ state.incomesDaily = state.incomesDaily.filter(x=>x.id!==b.dataset.del); save(); toast('Ingreso eliminado'); });
  $$('#incomesTable [data-edit]').forEach(b=> b.onclick=()=> editIncome(b.dataset.edit));
}
function editIncome(id){
  const i=state.incomesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const r0=state.incomesDaily[i];
  let r=ask(r0.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; r0.date=r.value||r0.date;
  r=ask(r0.client,'Cliente/Origen'); if(r.cancelled) return; r0.client=r.value||r0.client;
  r=ask(r0.method,'Método'); if(r.cancelled) return; r0.method=r.value||r0.method;
  r=askNumber(r0.amount,'Monto'); if(r.cancelled) return; r0.amount=r.value;
  save(); toast('Ingreso actualizado');
}
function wireIncomes(){
  $('#incomeForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), date:$('#incDate')?.value, client:$('#incClient')?.value, method:$('#incMethod')?.value, amount:Number($('#incAmount')?.value||0) };
    if(!rec.date) return toast('Fecha requerida');
    state.incomesDaily.push(rec); save(); toast('Ingreso guardado'); ev.target.reset();
  });
  $('#fIncApply')?.addEventListener('click', renderIncomes);
  $('#addIncome')?.addEventListener('click', ()=>{ if($('#incDate')) $('#incDate').value=todayStr(); $('#incAmount')?.focus(); });
}

/* =========================================================
   Nexus Finance — app.js (Parte 2 de 3)
   Sección: Nómina con retenciones, Facturas, Cotizaciones,
            Ordinarios, Presupuestos, Personales
   ========================================================= */

/* ======= Helpers de Nómina / Retenciones ======= */
function payrollComputeNet() {
  const g  = parseFloat($('#payGross')?.value || '0') || 0;
  const isr= parseFloat($('#payRetISR')?.value || '0') || 0;
  const ss = parseFloat($('#payRetSS')?.value || '0') || 0;
  const ot = parseFloat($('#payRetOther')?.value || '0') || 0;
  const net = g - (isr + ss + ot);
  if ($('#payNet'))    $('#payNet').value    = (net >= 0 ? net : 0).toFixed(2);
  if ($('#payAmount')) $('#payAmount').value = (net >= 0 ? net : 0).toFixed(2); // compat con lógica previa
  return net >= 0 ? net : 0;
}
function payrollBindRetentionInputs() {
  ['payGross','payRetISR','payRetSS','payRetOther'].forEach(id => {
    const el = $('#'+id);
    if (el && !el._retBound) {
      el.addEventListener('input', payrollComputeNet);
      el._retBound = true;
    }
  });
  payrollComputeNet();
}

/* ===================== Nómina (Pagos) ===================== */
function renderPayments(){
  const tbody=$('#paymentsTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const totals={Pendiente:0,Pagado:0};
  state.payments.slice().sort(byDateDesc).forEach(p=>{
    const breakdown = [
      (p.gross!=null ? `Bruto: ${fmt(p.gross)}` : null),
      (p.retISR!=null ? `ISR: ${fmt(p.retISR)}` : null),
      (p.retSS!=null ? `SS: ${fmt(p.retSS)}` : null),
      (p.retOther!=null ? `Otras: ${fmt(p.retOther)}` : null),
      (p.amount!=null ? `Neto: ${fmt(p.amount)}` : null),
    ].filter(Boolean).join(' · ');
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${p.date||''}</td>
      <td>${p.to||''}</td>
      <td>${p.category||''}</td>
      <td title="${breakdown}">${fmt(p.amount)}</td>
      <td>${p.status}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${p.id}">Editar</button>
        <button class="btn-outline" data-del="${p.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
    totals[p.status]=(totals[p.status]||0)+Number(p.amount||0);
  });
  $('#paySumPend') && ($('#paySumPend').textContent = fmt(totals['Pendiente']||0));
  $('#paySumPaid') && ($('#paySumPaid').textContent = fmt(totals['Pagado']||0));
  $('#paySumAll')  && ($('#paySumAll').textContent  = fmt((totals['Pagado']||0)+(totals['Pendiente']||0)));
  $$('#paymentsTable [data-del]').forEach(b=> b.onclick=()=>{ state.payments = state.payments.filter(x=>x.id!==b.dataset.del); save(); toast('Pago eliminado'); });
  $$('#paymentsTable [data-edit]').forEach(b=> b.onclick=()=> editPayment(b.dataset.edit));
}
function editPayment(id){
  const i=state.payments.findIndex(x=>x.id===id); if(i<0) return;
  const p=state.payments[i];
  let r=ask(p.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; p.date=r.value||p.date;
  r=ask(p.to,'Empleado/Beneficiario'); if(r.cancelled) return; p.to=r.value||p.to;
  r=ask(p.category,'Categoría'); if(r.cancelled) return; p.category=r.value||p.category;
  r=askNumber(p.gross ?? p.amount,'Monto bruto'); if(r.cancelled) return; p.gross=r.value;
  r=askNumber(p.retISR ?? 0,'ISR'); if(r.cancelled) return; p.retISR=r.value;
  r=askNumber(p.retSS ?? 0,'Seguro Social'); if(r.cancelled) return; p.retSS=r.value;
  r=askNumber(p.retOther ?? 0,'Otras deducciones'); if(r.cancelled) return; p.retOther=r.value;
  const net = (Number(p.gross||0) - Number(p.retISR||0) - Number(p.retSS||0) - Number(p.retOther||0));
  p.amount = (net>=0?net:0);
  r=ask(p.status,'Estado (Pendiente/Pagado)'); if(r.cancelled) return; p.status=r.value||p.status;
  save(); toast('Pago actualizado');
}
function wirePayments(){
  payrollBindRetentionInputs();
  $('#paymentForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const net = payrollComputeNet();
    const rec={
      id:uid(),
      date:     $('#payDate')?.value,
      to:       $('#payTo')?.value,
      category: $('#payCategory')?.value,
      gross:    parseFloat($('#payGross')?.value||'0')||0,
      retISR:   parseFloat($('#payRetISR')?.value||'0')||0,
      retSS:    parseFloat($('#payRetSS')?.value||'0')||0,
      retOther: parseFloat($('#payRetOther')?.value||'0')||0,
      amount:   net, // NETO
      status:   $('#payStatus')?.value || 'Pendiente'
    };
    if(!rec.date) return toast('Fecha requerida');
    state.payments.push(rec); save(); toast('Pago guardado'); ev.target.reset(); payrollBindRetentionInputs();
  });
  $('#addPayment')?.addEventListener('click', ()=>{ if($('#payDate')) $('#payDate').value=todayStr(); payrollComputeNet(); });
}

/* ===================== Helpers Factura/Cotización ===================== */
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

/* ===================== Facturación (crear + KPI + historial) ===================== */
function renderInvoicesKPI(){
  const now=new Date();
  const mStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);
  const today=now.toISOString().slice(0,10);
  const sumMonth = state.invoices.filter(x=>inRange(x.date, mStart, today)).reduce((a,b)=>a+Number(b.total||0),0);
  $('#invSumMonth') && ($('#invSumMonth').textContent = fmt(sumMonth));
}
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

    // Al crear factura -> registrar ingreso
    const income={ id:uid(), date:inv.date, client:inv.client.name, method:inv.method, amount:inv.total, invoiceNumber:inv.number };
    state.incomesDaily.push(income); inv.incomeId=income.id;

    state.invoices.push(inv); save(); toast('Factura creada y registrada en Ingresos');
    ev.target.reset();
    $('#invItemsTable tbody').innerHTML='';
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
function deleteInvoice(id){
  const inv=state.invoices.find(x=>x.id===id); if(!inv) return toast('No encontrada');
  if(inv.incomeId){ state.incomesDaily = state.incomesDaily.filter(r=>r.id!==inv.incomeId); }
  state.invoices = state.invoices.filter(x=>x.id!==id);
  save(); toast('Factura eliminada (y su ingreso)');
}
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

/* ===================== Cotizaciones (crear + historial) ===================== */
function renderQuotesKPI(){
  const now=new Date();
  const mStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);
  const today=now.toISOString().slice(0,10);
  const countMonth=state.quotes.filter(q=>inRange(q.date,mStart,today)).length;
  $('#quoCountMonth') && ($('#quoCountMonth').textContent=String(countMonth));
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
    ev.target.reset();
    $('#quoItemsTable tbody').innerHTML='';
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

/* ===================== Ordinarios / Recurrentes ===================== */
function renderOrdinary(){
  const tb=$('#ordinaryTable tbody'); if(!tb) return; tb.innerHTML='';
  state.ordinary.forEach(o=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${o.name}</td>
      <td>${fmt(o.amount)}</td>
      <td>${o.freq}</td>
      <td>${o.next}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${o.id}">Editar</button>
        <button class="btn-outline" data-del="${o.id}">Eliminar</button>
      </td>`;
    tb.appendChild(tr);
  });
  $('#ordSumCount')&&($('#ordSumCount').textContent=state.ordinary.length.toString());
  const next=state.ordinary.map(o=>o.next).filter(Boolean).sort()[0]||'—';
  $('#ordSumNext')&&($('#ordSumNext').textContent=next);
  $$('#ordinaryTable [data-del]').forEach(b=> b.onclick=()=>{ state.ordinary=state.ordinary.filter(x=>x.id!==b.dataset.del); save(); toast('Recurrente eliminado'); });
  $$('#ordinaryTable [data-edit]').forEach(b=> b.onclick=()=> editOrdinary(b.dataset.edit));
}
function editOrdinary(id){
  const i=state.ordinary.findIndex(x=>x.id===id); if(i<0) return;
  const o=state.ordinary[i];
  let r=ask(o.name,'Nombre'); if(r.cancelled) return; o.name=r.value||o.name;
  r=askNumber(o.amount,'Monto'); if(r.cancelled) return; o.amount=r.value;
  r=ask(o.freq,'Frecuencia'); if(r.cancelled) return; o.freq=r.value||o.freq;
  r=ask(o.next,'Próxima fecha'); if(r.cancelled) return; o.next=r.value||o.next;
  save(); toast('Recurrente actualizado');
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

/* ===================== Presupuestos ===================== */
function spendByCategory(cat){
  return state.expensesDaily.filter(e=>e.category===cat).reduce((a,b)=>a+Number(b.amount||0),0);
}
function renderBudgets(){
  const wrap=$('#budgetBars'); if(!wrap) return; wrap.innerHTML='';
  state.budgets.forEach(b=>{
    const used=spendByCategory(b.category);
    const pct=b.limit>0?Math.min(100,Math.round(100*used/b.limit)):0;
    const div=document.createElement('div');
    div.className='budget'+(used>b.limit?' over':'');
    div.innerHTML=`
      <div class="row"><strong>${b.category}</strong> · Límite ${fmt(b.limit)} · Usado ${fmt(used)} (${pct}%)</div>
      <div class="meter"><span style="width:${pct}%"></span></div>
      <div class="row-actions">
        <button class="btn-outline" data-edit="${b.id}">Editar</button>
        <button class="btn-outline" data-del="${b.id}">Eliminar</button>
      </div>`;
    wrap.appendChild(div);
  });
  $$('#budgetBars [data-del]').forEach(b=> b.onclick=()=>{ state.budgets=state.budgets.filter(x=>x.id!==b.dataset.del); save(); toast('Presupuesto eliminado'); });
  $$('#budgetBars [data-edit]').forEach(b=> b.onclick=()=> editBudget(b.dataset.edit));
}
function editBudget(id){
  const i=state.budgets.findIndex(x=>x.id===id); if(i<0) return;
  const b=state.budgets[i];
  let r=ask(b.category,'Categoría'); if(r.cancelled) return; b.category=r.value||b.category;
  r=askNumber(b.limit,'Límite'); if(r.cancelled) return; b.limit=r.value;
  save(); toast('Presupuesto actualizado');
}
function wireBudgets(){
  $('#budgetForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec={ id:uid(), category:$('#budCategory')?.value, limit:Number($('#budLimit')?.value||0) };
    state.budgets.push(rec); save(); toast('Presupuesto guardado'); ev.target.reset();
  });
  $('#addBudget')?.addEventListener('click', ()=>{ $('#budCategory')?.focus(); });
}

/* ===================== Gastos Personales ===================== */
function renderPersonal(){
  const tb=$('#personalTable tbody'); if(!tb) return; tb.innerHTML='';
  let total=0;
  state.personal.slice().sort(byDateDesc).forEach(p=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${p.date||''}</td>
      <td>${p.category||''}</td>
      <td>${p.desc||''}</td>
      <td>${fmt(p.amount)}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${p.id}">Editar</button>
        <button class="btn-outline" data-del="${p.id}">Eliminar</button>
      </td>`;
    tb.appendChild(tr);
    total+=Number(p.amount||0);
  });
  $('#perSumTotal')&&($('#perSumTotal').textContent=fmt(total));
  $$('#personalTable [data-del]').forEach(b=> b.onclick=()=>{ state.personal=state.personal.filter(x=>x.id!==b.dataset.del); save(); toast('Gasto personal eliminado'); });
  $$('#personalTable [data-edit]').forEach(b=> b.onclick=()=> editPersonal(b.dataset.edit));
}
function editPersonal(id){
  const i=state.personal.findIndex(x=>x.id===id); if(i<0) return;
  const p=state.personal[i];
  let r=ask(p.date,'Fecha'); if(r.cancelled) return; p.date=r.value||p.date;
  r=ask(p.category,'Categoría'); if(r.cancelled) return; p.category=r.value||p.category;
  r=ask(p.desc,'Descripción'); if(r.cancelled) return; p.desc=r.value||p.desc;
  r=askNumber(p.amount,'Monto'); if(r.cancelled) return; p.amount=r.value;
  save(); toast('Gasto personal actualizado');
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
   Nexus Finance — app.js (Parte 3 de 3)
   Sección: Configuración, Conciliación Bancaria, PDF, Init
   ========================================================= */

/* ===================== Configuración ===================== */
function wireSettings(){
  const f=$('#settingsForm'); if(!f) return;

  f.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    state.settings.businessName = $('#setName')?.value;
    state.settings.currency      = $('#setCurr')?.value;
    save(); toast('Configuración guardada');
  });

  $('#setReset')?.addEventListener('click',()=>{
    if(confirm('¿Seguro que deseas restablecer todo?')){
      if(confirm('Confirmar eliminación de todos los datos locales.')){
        localStorage.clear(); location.reload();
      }
    }
  });

  $('#setExport')?.addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='finanzas-backup.json';
    a.click();
  });

  $('#setImport')?.addEventListener('change',ev=>{
    const f=ev.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const data=JSON.parse(r.result);
        if(confirm('¿Reemplazar datos actuales con los importados?')){
          state=data; save(); toast('Datos importados correctamente'); location.reload();
        }
      }catch{ toast('Archivo JSON inválido'); }
    };
    r.readAsText(f);
  });

  // Logo
  $('#setLogo')?.addEventListener('change',ev=>{
    const f=ev.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{ state.settings.logoBase64=r.result; save(); toast('Logo actualizado'); applyTheme(); };
    r.readAsDataURL(f);
  });
  $('#setLogoDel')?.addEventListener('click',()=>{
    state.settings.logoBase64=''; save(); toast('Logo eliminado'); applyTheme();
  });
}

/* ===================== Conciliación Bancaria ===================== */
function wireReconciliation(){
  const f=$('#bankFile'); if(!f) return;
  f.addEventListener('change',ev=>{
    const file=ev.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const lines=reader.result.split(/\r?\n/).filter(l=>l.trim().length>5);
        const entries=lines.map(l=>{
          const parts=l.split(',').map(p=>p.trim());
          return { date:parts[0], desc:parts[1], amount:parseFloat(parts[2].replace('$',''))||0 };
        });
        const totalBank = entries.reduce((a,b)=>a+b.amount,0);
        const totalApp = [...state.incomesDaily, ...state.expensesDaily.map(e=>({amount:-e.amount}))].reduce((a,b)=>a+(Number(b.amount)||0),0);
        const diff = totalBank - totalApp;

        $('#recBankTotal').textContent = fmt(totalBank);
        $('#recAppTotal').textContent  = fmt(totalApp);
        $('#recDiff').textContent      = fmt(diff);

        const tb=$('#recTable tbody'); tb.innerHTML='';
        entries.forEach(e=>{
          const tr=document.createElement('tr');
          tr.innerHTML=`
            <td>${e.date}</td>
            <td>${e.desc}</td>
            <td>${fmt(e.amount)}</td>`;
          tb.appendChild(tr);
        });

        toast('Archivo bancario cargado y conciliado');
      }catch{ toast('Error procesando el archivo'); }
    };
    reader.readAsText(file);
  });
}

/* ===================== Exportar PDF ===================== */
function generatePDF(section,id){
  const css = `
    <style>
      body{font-family:Arial,sans-serif;color:#000;background:#fff;}
      h1{font-size:18pt;margin-bottom:10px;}
      table{width:100%;border-collapse:collapse;font-size:10pt;}
      th,td{border:1px solid #333;padding:6px;text-align:left;}
      th{background:#eee;}
      .total{font-weight:bold;}
      footer{text-align:center;font-size:9pt;margin-top:20px;color:#666;}
    </style>`;

  let html = '';
  const biz = state.settings.businessName;
  const logo = state.settings.logoBase64 ? `<img src="${state.settings.logoBase64}" style="max-height:80px;">` : '';
  
  if(section==='invoices'){
    const inv = state.invoices.find(x=>x.id===id);
    if(!inv) return toast('Factura no encontrada');
    html = `
      <h1>Factura #${inv.number}</h1>
      <div>${logo}</div>
      <p><strong>${biz}</strong></p>
      <p>Cliente: ${inv.client?.name||''}</p>
      <p>Fecha: ${inv.date||''} &nbsp;&nbsp; Vence: ${inv.dueDate||''}</p>
      <table>
        <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Impuesto %</th><th>Total</th></tr></thead>
        <tbody>${inv.items.map(i=>`<tr><td>${i.desc}</td><td>${i.qty}</td><td>${fmt(i.price)}</td><td>${i.tax}</td><td>${fmt(i.qty*i.price*(1+i.tax/100))}</td></tr>`).join('')}</tbody>
      </table>
      <p class="total">Subtotal: ${fmt(inv.subtotal)}<br>Impuestos: ${fmt(inv.taxTotal)}<br>Total: ${fmt(inv.total)}</p>
      <footer>Factura generada automáticamente desde Nexus Finance</footer>`;
  }
  else if(section==='quotes'){
    const q = state.quotes.find(x=>x.id===id);
    if(!q) return toast('Cotización no encontrada');
    html = `
      <h1>Cotización #${q.number}</h1>
      <div>${logo}</div>
      <p><strong>${biz}</strong></p>
      <p>Cliente: ${q.client?.name||''}</p>
      <p>Fecha: ${q.date||''} &nbsp;&nbsp; Vigencia: ${q.validUntil||''}</p>
      <table>
        <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Impuesto %</th><th>Total</th></tr></thead>
        <tbody>${q.items.map(i=>`<tr><td>${i.desc}</td><td>${i.qty}</td><td>${fmt(i.price)}</td><td>${i.tax}</td><td>${fmt(i.qty*i.price*(1+i.tax/100))}</td></tr>`).join('')}</tbody>
      </table>
      <p class="total">Subtotal: ${fmt(q.subtotal)}<br>Impuestos: ${fmt(q.taxTotal)}<br>Total: ${fmt(q.total)}</p>
      <footer>Cotización generada automáticamente desde Nexus Finance</footer>`;
  }
  else{
    html = `<h1>Reporte: ${section}</h1><p>Generado el ${new Date().toLocaleString()}</p>`;
  }

  const w = window.open('', '_blank');
  w.document.write(css + html);
  w.document.close();
  w.print();
}

/* ===================== Inicialización ===================== */
function refreshAll(){
  renderExpenses(); renderIncomes(); renderPayments();
  renderOrdinary(); renderBudgets(); renderPersonal();
  renderInvoicesKPI(); renderQuotesKPI();
}

function wireAll(){
  updateLoginUI();
  wireExpenses(); wireIncomes(); wirePayments();
  wireOrdinary(); wireBudgets(); wirePersonal();
  wireInvoicesCreate(); wireQuotesCreate();
  wireSettings(); wireReconciliation();
  initCatalogs(); applyTheme();
}

document.addEventListener('DOMContentLoaded',()=>{
  wireAll();
  refreshAll();
  if(!state.settings.pinHash){ showView('login'); }
  else { showView('login'); } // Bloquea siempre hasta PIN
});
