/* ===================== Firebase ===================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut
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
const STORAGE_KEY = 'finanzas-state-v5'; // bump
const LOCK_KEY = 'finanzas-lock-v2';

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
  invoices: [], // {id, number, date, dueDate, method, client{name,email,phone,address}, items[{desc,qty,price,tax}], subtotal, taxTotal, total, note, terms, incomeId}
  quotes: [],   // {id, number, date, validUntil, method, client{...}, items, subtotal, taxTotal, total, note, terms}
  _cloud: { updatedAt: 0 }
};

const $  = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));
const clone = o => JSON.parse(JSON.stringify(o));
const todayStr = ()=> new Date().toISOString().slice(0,10);
const nowMs = ()=> Date.now();
function safely(fn){ try{ return fn(); }catch(e){ console.warn('[SAFE]', e); } }

function load(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){ localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE)); return clone(DEFAULT_STATE); }
  try{
    const st = JSON.parse(raw);
    if(!st._cloud) st._cloud = { updatedAt: 0 };
    if(!st.invoices) st.invoices = [];
    if(!st.quotes) st.quotes = [];
    return st;
  }catch{ return clone(DEFAULT_STATE); }
}
let state = load();

function save({skipCloud=false} = {}){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  safely(applyTheme); safely(refreshAll);
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
function uid(){ return Math.random().toString(36).slice(2,9)+Date.now().toString(36); }

const toDate = s=> new Date(s);
function inRange(d, from, to){ const t=+toDate(d); if(from && t<+toDate(from)) return false; if(to && t>(+toDate(to)+86400000-1)) return false; return true; }
const byDateDesc = (a,b)=> (+toDate(b.date||'1970-01-01')) - (+toDate(a.date||'1970-01-01'));

function ask(curr, label){ const v=prompt(label, curr??''); if(v===null) return {cancelled:true,value:curr}; return {cancelled:false,value:v}; }
function askNumber(curr, label){ const a=ask(String(curr??''),label); if(a.cancelled) return a; const n=parseFloat(String(a.value).replace(',','.')); if(Number.isNaN(n)) return {cancelled:true,value:curr}; return {cancelled:false,value:n}; }

/* ===================== Catálogos ===================== */
const EXPENSE_CATEGORIES = [
  "Gasolina","Comida","Transporte","Mantenimiento","Renta/Alquiler",
  "Servicios (Luz/Agua/Internet)","Insumos","Nómina","Impuestos","Herramientas",
  "Publicidad/Marketing","Viajes","Papelería","Licencias y Software","Seguros",
  "Equipos","Materiales","Otros"
];
const PAYMENT_METHODS = ["Efectivo","Tarjeta","Transferencia","ATH Móvil","Cheque"];

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
  safely(()=> upsertOptions($('#expCategory'), EXPENSE_CATEGORIES));
  safely(()=> upsertOptions($('#expMethod'), PAYMENT_METHODS));
  safely(()=> upsertOptions($('#incMethod'), PAYMENT_METHODS));
  safely(()=> upsertOptions($('#invMethod'), PAYMENT_METHODS));
  safely(()=> upsertOptions($('#quoMethod'), PAYMENT_METHODS));
}

/* ===================== Tema / Router ===================== */
function applyTheme(){
  const r = document.documentElement;
  r?.style?.setProperty('--primary', state.settings.theme.primary);
  r?.style?.setProperty('--accent',  state.settings.theme.accent);
  r?.style?.setProperty('--text',    state.settings.theme.text);

  $('#brandName') && ($('#brandName').textContent = state.settings.businessName || 'Mi Negocio');
  const FALLBACK_LOGO = 'assets/logo.png';
  ['brandLogo','logoPreview'].forEach(id=>{
    const img = $('#'+id); if(!img) return;
    img.src = state.settings.logoBase64 || FALLBACK_LOGO;
  });

  $('#setName') && ($('#setName').value = state.settings.businessName);
  $('#setCurrency') && ($('#setCurrency').value = state.settings.currency);
  $('#colorPrimary') && ($('#colorPrimary').value = state.settings.theme.primary);
  $('#colorAccent')  && ($('#colorAccent').value  = state.settings.theme.accent);
  $('#colorText')    && ($('#colorText').value    = state.settings.theme.text);
}
function showView(id){
  safely(()=> $$('.view').forEach(v=>v.classList.remove('visible')));
  const target = $('#'+id) || $('#home') || null;
  target && target.classList.add('visible');
  safely(()=> $$('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.target===id)));
  $('#viewTitle') && ($('#viewTitle').textContent = (target?.dataset?.title || id || ''));
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
  const pin = $('#loginPIN')?.value?.trim();
  if(!pin) return toast('Introduce un PIN');

  if(createMode){
    const pin2 = $('#loginPIN2')?.value?.trim();
    if(pin.length<4 || pin.length>8) return toast('El PIN debe tener 4–8 dígitos');
    if(pin!==pin2) return toast('Los PIN no coinciden');
    state.settings.pinHash = await sha256(pin); save();
    toast('PIN creado'); showView('home');
  }else{
    if(attempts()>=5) return toast('Bloqueado por demasiados intentos.');
    const ok = await sha256(pin) === state.settings.pinHash;
    if(ok){ setAttempts(0); toast('Bienvenido'); showView('home'); }
    else { setAttempts(attempts()+1); toast('PIN incorrecto'); updateLoginUI(); }
  }
}
function updateLoginUI(){
  const createMode = !state.settings.pinHash;
  $('#loginTitle')  && ($('#loginTitle').textContent = createMode ? 'Crear PIN' : 'Ingresar PIN');
  $('#loginHint')   && ($('#loginHint').textContent = createMode ? 'Crea un PIN de 4–8 dígitos.' : 'Introduce tu PIN para acceder.');
  $('#loginPIN2')   && ($('#loginPIN2').style.display = createMode ? 'block' : 'none');
  const left = attemptsLeft();
  $('#loginAttempts') && ($('#loginAttempts').textContent = createMode ? '' : (left===0 ? 'Bloqueado.' : `Intentos restantes: ${left}`));
  $('#loginBtn')?.addEventListener('click', handleLogin);
}

/* ===================== Gastos Diarios ===================== */
function renderExpenses(){
  const tbody = $('#expensesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from = $('#fExpFrom')?.value, to = $('#fExpTo')?.value;
  let total=0; const cats={};

  state.expensesDaily
    .filter(e=>inRange(e.date, from, to))
    .sort(byDateDesc)
    .forEach(e=>{
      const tr = document.createElement('tr');
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
  if(pills){ pills.innerHTML=''; Object.entries(cats).forEach(([k,v])=>{ const s=document.createElement('span'); s.className='pill'; s.textContent=`${k}: ${fmt(v)}`; pills.appendChild(s);}); }

  $$('#expensesTable [data-del]').forEach(b=> b.onclick=()=>{ state.expensesDaily = state.expensesDaily.filter(x=>x.id!==b.dataset.del); save(); toast('Gasto eliminado'); });
  $$('#expensesTable [data-edit]').forEach(b=> b.onclick=()=> editExpense(b.dataset.edit));
}
function editExpense(id){
  const i = state.expensesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const e = state.expensesDaily[i];
  let r = ask(e.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; e.date = r.value||e.date;
  r = ask(e.category,'Categoría'); if(r.cancelled) return; e.category = r.value||e.category;
  r = ask(e.desc,'Descripción'); if(r.cancelled) return; e.desc = r.value||e.desc;
  r = ask(e.method,'Método'); if(r.cancelled) return; e.method = r.value||e.method;
  r = askNumber(e.amount,'Monto'); if(r.cancelled) return; e.amount = r.value;
  r = ask(e.note,'Nota'); if(r.cancelled) return; e.note = r.value||e.note;
  save(); toast('Gasto actualizado');
}
function wireExpenses(){
  $('#expenseForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec = {
      id: uid(), date: $('#expDate')?.value, category: $('#expCategory')?.value,
      desc: $('#expDesc')?.value, amount: Number($('#expAmount')?.value||0),
      method: $('#expMethod')?.value || '', note: $('#expNote')?.value
    };
    if(!rec.date) return toast('Fecha requerida');
    state.expensesDaily.push(rec); save(); toast('Gasto guardado'); ev.target.reset();
  });
  $('#fExpApply')?.addEventListener('click', renderExpenses);
  $('#addExpense')?.addEventListener('click', ()=>{ if($('#expDate')) $('#expDate').value = todayStr(); $('#expAmount')?.focus(); });
}

/* ===================== Ingresos ===================== */
function renderIncomes(){
  const tbody = $('#incomesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const from = $('#fIncFrom')?.value, to = $('#fIncTo')?.value; let total=0;

  state.incomesDaily
    .filter(r=>inRange(r.date, from, to))
    .sort(byDateDesc)
    .forEach(r=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.date||''}</td><td>${r.client||''}</td><td>${r.method||''}</td>
        <td>${fmt(r.amount)}</td>
        <td class="row-actions">
          <button class="btn-outline" data-edit="${r.id}">Editar</button>
          <button class="btn-outline" data-del="${r.id}">Eliminar</button>
        </td>`;
      tbody.appendChild(tr); total+=Number(r.amount||0);
    });

  $('#incSumTotal') && ($('#incSumTotal').textContent = fmt(total));
  $$('#incomesTable [data-del]').forEach(b=> b.onclick=()=>{ state.incomesDaily = state.incomesDaily.filter(x=>x.id!==b.dataset.del); save(); toast('Ingreso eliminado'); });
  $$('#incomesTable [data-edit]').forEach(b=> b.onclick=()=> editIncome(b.dataset.edit));
}
function editIncome(id){
  const i = state.incomesDaily.findIndex(x=>x.id===id); if(i<0) return;
  const r0 = state.incomesDaily[i];
  let r = ask(r0.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; r0.date = r.value||r0.date;
  r = ask(r0.client,'Cliente/Origen'); if(r.cancelled) return; r0.client = r.value||r0.client;
  r = ask(r0.method,'Método'); if(r.cancelled) return; r0.method = r.value||r0.method;
  r = askNumber(r0.amount,'Monto'); if(r.cancelled) return; r0.amount = r.value;
  save(); toast('Ingreso actualizado');
}
function wireIncomes(){
  $('#incomeForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec = { id:uid(), date: $('#incDate')?.value, client: $('#incClient')?.value, method: $('#incMethod')?.value, amount: Number($('#incAmount')?.value||0) };
    if(!rec.date) return toast('Fecha requerida');
    state.incomesDaily.push(rec); save(); toast('Ingreso guardado'); ev.target.reset();
  });
  $('#fIncApply')?.addEventListener('click', renderIncomes);
  $('#addIncome')?.addEventListener('click', ()=>{ if($('#incDate')) $('#incDate').value = todayStr(); $('#incAmount')?.focus(); });
}

/* ===================== Nómina ===================== */
function renderPayments(){
  const tbody = $('#paymentsTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const totals = { Pendiente:0, Pagado:0 };
  state.payments.slice().sort(byDateDesc).forEach(p=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${p.date||''}</td><td>${p.to||''}</td><td>${p.category||''}</td>
      <td>${fmt(p.amount)}</td><td>${p.status}</td>
      <td class="row-actions">
        <button class="btn-outline" data-edit="${p.id}">Editar</button>
        <button class="btn-outline" data-del="${p.id}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
    totals[p.status] = (totals[p.status]||0) + Number(p.amount||0);
  });
  $('#paySumPend') && ($('#paySumPend').textContent = fmt(totals['Pendiente']||0));
  $('#paySumPaid') && ($('#paySumPaid').textContent = fmt(totals['Pagado']||0));
  $('#paySumAll')  && ($('#paySumAll').textContent  = fmt((totals['Pagado']||0)+(totals['Pendiente']||0)));

  $$('#paymentsTable [data-del]').forEach(b=> b.onclick=()=>{ state.payments = state.payments.filter(x=>x.id!==b.dataset.del); save(); toast('Pago eliminado'); });
  $$('#paymentsTable [data-edit]').forEach(b=> b.onclick=()=> editPayment(b.dataset.edit));
}
function editPayment(id){
  const i = state.payments.findIndex(x=>x.id===id); if(i<0) return;
  const p = state.payments[i];
  let r = ask(p.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; p.date = r.value||p.date;
  r = ask(p.to,'Empleado/Beneficiario'); if(r.cancelled) return; p.to = r.value||p.to;
  r = ask(p.category,'Categoría'); if(r.cancelled) return; p.category = r.value||p.category;
  r = askNumber(p.amount,'Monto'); if(r.cancelled) return; p.amount = r.value;
  r = ask(p.status,'Estado (Pendiente/Pagado)'); if(r.cancelled) return; p.status = r.value||p.status;
  save(); toast('Pago actualizado');
}
function wirePayments(){
  $('#paymentForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const rec = { id:uid(), date: $('#payDate')?.value, to: $('#payTo')?.value, category: $('#payCategory')?.value, amount: Number($('#payAmount')?.value||0), status: $('#payStatus')?.value || 'Pendiente' };
    if(!rec.date) return toast('Fecha requerida');
    state.payments.push(rec); save(); toast('Pago guardado'); ev.target.reset();
  });
  $('#addPayment')?.addEventListener('click', ()=>{ if($('#payDate')) $('#payDate').value = todayStr(); $('#payAmount')?.focus(); });
}

/* ===================== Ítems helpers (Fact/Quote) ===================== */
function uidItem(){ return Math.random().toString(36).slice(2,7); }
function addItemRow(tbody){
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" placeholder="Descripción"></td>
    <td><input type="number" step="0.01" value="1"></td>
    <td><input type="number" step="0.01" value="0"></td>
    <td><input type="number" step="0.01" value="0"></td>
    <td class="amount-cell">0.00</td>
    <td><button type="button" class="btn-outline btnDelRow">✕</button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.btnDelRow').onclick = ()=> tr.remove();
}
function readItemsFromTable(tbody){
  const items=[];
  tbody.querySelectorAll('tr').forEach(tr=>{
    const [desc, qty, price, tax] = Array.from(tr.querySelectorAll('input')).map(i=>i.value);
    const q = parseFloat(qty||'0')||0, p = parseFloat(price||'0')||0, t = parseFloat(tax||'0')||0;
    items.push({ id:uidItem(), desc: (desc||'').trim(), qty:q, price:p, tax:t });
  });
  return items;
}
function calcTotals(items){
  let subtotal=0, taxTotal=0;
  items.forEach(it=>{
    const base = (it.qty||0)*(it.price||0);
    const tax  = base * ((it.tax||0)/100);
    subtotal += base; taxTotal += tax;
  });
  const total = subtotal + taxTotal;
  return { subtotal, taxTotal, total };
}
function paintRowAmounts(tbody){
  tbody.querySelectorAll('tr').forEach(tr=>{
    const [desc, qty, price, tax] = Array.from(tr.querySelectorAll('input')).map(i=>i.value);
    const q=parseFloat(qty||'0')||0, p=parseFloat(price||'0')||0, t=parseFloat(tax||'0')||0;
    const base = q*p, taxAmt = base*(t/100), amt = base+taxAmt;
    tr.querySelector('.amount-cell').textContent = amt.toFixed(2);
  });
}

/* ===================== Facturación (crear) ===================== */
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
    const tbody = $('#invItemsTable tbody'); paintRowAmounts(tbody);
    const totals = calcTotals(readItemsFromTable(tbody));
    $('#invSubtotal').textContent = fmt(totals.subtotal);
    $('#invTaxTotal').textContent = fmt(totals.taxTotal);
    $('#invGrandTotal').textContent = fmt(totals.total);
  });
  $('#addInvoiceToday')?.addEventListener('click', ()=>{ if($('#invDate')) $('#invDate').value = todayStr(); });
  $('#invoiceForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const items = readItemsFromTable($('#invItemsTable tbody'));
    const totals = calcTotals(items);
    const inv = {
      id: uid(),
      date: $('#invDate')?.value,
      dueDate: $('#invDueDate')?.value,
      number: $('#invNumber')?.value,
      method: $('#invMethod')?.value,
      client: {
        name: $('#invClient')?.value,
        email: $('#invClientEmail')?.value,
        phone: $('#invClientPhone')?.value,
        address: $('#invClientAddress')?.value
      },
      items, subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
      note: $('#invNote')?.value, terms: $('#invTerms')?.value
    };
    if(!inv.date || !inv.number) return toast('Fecha y número requeridos');

    // Crear ingreso vinculado (usa TOTAL de factura)
    const income = { id:uid(), date: inv.date, client: inv.client.name, method: inv.method, amount: inv.total, invoiceNumber: inv.number };
    state.incomesDaily.push(income);
    inv.incomeId = income.id;

    state.invoices.push(inv); save(); toast('Factura creada y registrada en Ingresos');
    ev.target.reset();
    $('#invItemsTable tbody').innerHTML='';
    $('#invSubtotal').textContent='—'; $('#invTaxTotal').textContent='—'; $('#invGrandTotal').textContent='—';
  });
}

/* ===================== Historial de Facturación ===================== */
function renderInvoicesHistory(filterText=''){
  const tbody = $('#invoicesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const q = (filterText||'').toLowerCase().trim();

  state.invoices.slice().sort(byDateDesc).forEach(inv=>{
    const hay = `${inv.number||''} ${inv.client?.name||''}`.toLowerCase();
    if(q && !hay.includes(q)) return;

    const tr=document.createElement('tr');
    tr.innerHTML = `
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
    tbody.appendChild(tr);
  });

  $$('#invoicesTable [data-del]').forEach(b=> b.onclick=()=> deleteInvoice(b.dataset.del));
  $$('#invoicesTable [data-edit]').forEach(b=> b.onclick=()=> editInvoiceBasic(b.dataset.edit));
  $$('#invoicesTable [data-pdf]').forEach(b=> b.onclick=()=> generatePDF('invoices', b.dataset.pdf));
}
function deleteInvoice(id){
  const inv = state.invoices.find(x=>x.id===id); if(!inv){ toast('No encontrada'); return; }
  if(inv.incomeId){ state.incomesDaily = state.incomesDaily.filter(r=>r.id!==inv.incomeId); }
  state.invoices = state.invoices.filter(x=>x.id!==id);
  save(); toast('Factura eliminada (y su ingreso vinculado)');
}
function editInvoiceBasic(id){
  const i = state.invoices.findIndex(x=>x.id===id); if(i<0) return;
  const inv = state.invoices[i];
  let r = ask(inv.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; inv.date = r.value||inv.date;
  r = ask(inv.dueDate,'Vencimiento (YYYY-MM-DD)'); if(r.cancelled) return; inv.dueDate = r.value||inv.dueDate;
  r = ask(inv.number,'# Factura'); if(r.cancelled) return; inv.number = r.value||inv.number;
  r = ask(inv.method,'Método'); if(r.cancelled) return; inv.method = r.value||inv.method;
  r = ask(inv.client?.name,'Cliente'); if(r.cancelled) return; inv.client = inv.client||{}; inv.client.name = r.value||inv.client.name;
  save(); toast('Factura actualizada');
}

/* ===================== Cotizaciones (crear) ===================== */
function renderQuotesKPI(){
  const now=new Date();
  const mStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);
  const today=now.toISOString().slice(0,10);
  const countMonth = state.quotes.filter(q=>inRange(q.date,mStart,today)).length;
  $('#quoCountMonth') && ($('#quoCountMonth').textContent = String(countMonth));
}
function wireQuotesCreate(){
  $('#quoAddItem')?.addEventListener('click', ()=> addItemRow($('#quoItemsTable tbody')));
  $('#quoCalc')?.addEventListener('click', ()=>{
    const tbody = $('#quoItemsTable tbody'); paintRowAmounts(tbody);
    const totals = calcTotals(readItemsFromTable(tbody));
    $('#quoSubtotal').textContent = fmt(totals.subtotal);
    $('#quoTaxTotal').textContent = fmt(totals.taxTotal);
    $('#quoGrandTotal').textContent = fmt(totals.total);
  });
  $('#addQuoteToday')?.addEventListener('click', ()=>{ if($('#quoDate')) $('#quoDate').value = todayStr(); });
  $('#quoteForm')?.addEventListener('submit',(ev)=>{
    ev.preventDefault();
    const items = readItemsFromTable($('#quoItemsTable tbody'));
    const totals = calcTotals(items);
    const q = {
      id: uid(),
      date: $('#quoDate')?.value,
      validUntil: $('#quoValidUntil')?.value,
      number: $('#quoNumber')?.value,
      method: $('#quoMethod')?.value,
      client: {
        name: $('#quoClient')?.value,
        email: $('#quoClientEmail')?.value,
        phone: $('#quoClientPhone')?.value,
        address: $('#quoClientAddress')?.value
      },
      items, subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
      note: $('#quoNote')?.value, terms: $('#quoTerms')?.value
    };
    if(!q.date || !q.number) return toast('Fecha y número requeridos');

    state.quotes.push(q); save(); toast('Cotización creada (no afecta totales)');
    ev.target.reset();
    $('#quoItemsTable tbody').innerHTML='';
    $('#quoSubtotal').textContent='—'; $('#quoTaxTotal').textContent='—'; $('#quoGrandTotal').textContent='—';
  });
}

/* ===================== Historial de Cotizaciones ===================== */
function renderQuotesHistory(filterText=''){
  const tbody = $('#quotesTable tbody'); if(!tbody) return; tbody.innerHTML='';
  const q = (filterText||'').toLowerCase().trim();

  state.quotes.slice().sort(byDateDesc).forEach(qu=>{
    const hay = `${qu.number||''} ${qu.client?.name||''}`.toLowerCase();
    if(q && !hay.includes(q)) return;

    const tr=document.createElement('tr');
    tr.innerHTML = `
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
    tbody.appendChild(tr);
  });

  $$('#quotesTable [data-del]').forEach(b=> b.onclick=()=>{ state.quotes = state.quotes.filter(x=>x.id!==b.dataset.del); save(); toast('Cotización eliminada'); });
  $$('#quotesTable [data-edit]').forEach(b=> b.onclick=()=> editQuoteBasic(b.dataset.edit));
  $$('#quotesTable [data-pdf]').forEach(b=> b.onclick=()=> generatePDF('quotes', b.dataset.pdf));
}
function editQuoteBasic(id){
  const i = state.quotes.findIndex(x=>x.id===id); if(i<0) return;
  const q = state.quotes[i];
  let r = ask(q.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; q.date = r.value||q.date;
  r = ask(q.validUntil,'Válida hasta (YYYY-MM-DD)'); if(r.cancelled) return; q.validUntil = r.value||q.validUntil;
  r = ask(q.number,'# Cotización'); if(r.cancelled) return; q.number = r.value||q.number;
  r = ask(q.method,'Método'); if(r.cancelled) return; q.method = r.value||q.method;
  r = ask(q.client?.name,'Cliente'); if(r.cancelled) return; q.client = q.client||{}; q.client.name = r.value||q.client.name;
  save(); toast('Cotización actualizada');
}

/* ===================== Ordinarios / Presupuestos / Personales ===================== */
function renderOrdinary(){ const tbody=$('#ordinaryTable tbody'); if(!tbody) return; tbody.innerHTML=''; state.ordinary.forEach(o=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${o.name}</td><td>${fmt(o.amount)}</td><td>${o.freq}</td><td>${o.next}</td><td class="row-actions"><button class="btn-outline" data-edit="${o.id}">Editar</button><button class="btn-outline" data-del="${o.id}">Eliminar</button></td>`; tbody.appendChild(tr); }); $('#ordSumCount')&&($('#ordSumCount').textContent=state.ordinary.length.toString()); const next=state.ordinary.map(o=>o.next).filter(Boolean).sort()[0]||'—'; $('#ordSumNext')&&($('#ordSumNext').textContent=next); $$('#ordinaryTable [data-del]').forEach(b=> b.onclick=()=>{ state.ordinary=state.ordinary.filter(x=>x.id!==b.dataset.del); save(); toast('Recurrente eliminado'); }); $$('#ordinaryTable [data-edit]').forEach(b=> b.onclick=()=> editOrdinary(b.dataset.edit)); }
function editOrdinary(id){ const i=state.ordinary.findIndex(x=>x.id===id); if(i<0) return; const o=state.ordinary[i]; let r=ask(o.name,'Nombre'); if(r.cancelled) return; o.name=r.value||o.name; r=askNumber(o.amount,'Monto'); if(r.cancelled) return; o.amount=r.value; r=ask(o.freq,'Frecuencia (semanal/mensual/anual)'); if(r.cancelled) return; o.freq=r.value||o.freq; r=ask(o.next,'Próxima fecha (YYYY-MM-DD)'); if(r.cancelled) return; o.next=r.value||o.next; save(); toast('Recurrente actualizado'); }
function wireOrdinary(){ $('#ordinaryForm')?.addEventListener('submit',(ev)=>{ ev.preventDefault(); const rec={ id:uid(), name:$('#ordName')?.value, amount:Number($('#ordAmount')?.value||0), freq:$('#ordFreq')?.value, next:$('#ordNext')?.value }; if(!rec.next) return toast('Próxima fecha requerida'); state.ordinary.push(rec); save(); toast('Recurrente guardado'); ev.target.reset(); }); $('#addOrd')?.addEventListener('click', ()=>{ if($('#ordNext')) $('#ordNext').value=todayStr(); $('#ordAmount')?.focus(); }); }
function autoGenerateOrdinary(){ const today=todayStr(); let changed=false; state.ordinary.forEach(o=>{ if(o.next && o.next<=today){ state.expensesDaily.push({ id:uid(), date:o.next, category:o.name, desc:`Recurrente (${o.freq})`, method:'Automático', amount:o.amount, note:'' }); const d=new Date(o.next); if(o.freq==='semanal') d.setDate(d.getDate()+7); else if(o.freq==='mensual') d.setMonth(d.getMonth()+1); else if(o.freq==='anual') d.setFullYear(d.getFullYear()+1); o.next=d.toISOString().slice(0,10); changed=true; } }); if(changed) save(); }
function spendByCategory(cat){ return state.expensesDaily.filter(e=>e.category===cat).reduce((a,b)=>a+Number(b.amount||0),0); }
function renderBudgets(){ const wrap=$('#budgetBars'); if(!wrap) return; wrap.innerHTML=''; state.budgets.forEach(b=>{ const used=spendByCategory(b.category); const pct=b.limit>0?Math.min(100,Math.round(100*used/b.limit)):0; const div=document.createElement('div'); div.className='budget'+(used>b.limit?' over':''); div.innerHTML=`<div class="row"><strong>${b.category}</strong> · Límite ${fmt(b.limit)} · Usado ${fmt(used)} (${pct}%)</div><div class="meter"><span style="width:${pct}%"></span></div><div class="row-actions"><button class="btn-outline" data-edit="${b.id}">Editar</button><button class="btn-outline" data-del="${b.id}">Eliminar</button></div>`; wrap.appendChild(div); }); $$('#budgetBars [data-del]').forEach(b=> b.onclick=()=>{ state.budgets=state.budgets.filter(x=>x.id!==b.dataset.del); save(); toast('Presupuesto eliminado'); }); $$('#budgetBars [data-edit]').forEach(b=> b.onclick=()=> editBudget(b.dataset.edit)); }
function editBudget(id){ const i=state.budgets.findIndex(x=>x.id===id); if(i<0) return; const b=state.budgets[i]; let r=ask(b.category,'Categoría'); if(r.cancelled) return; b.category=r.value||b.category; r=askNumber(b.limit,'Límite'); if(r.cancelled) return; b.limit=r.value; save(); toast('Presupuesto actualizado'); }
function wireBudgets(){ $('#budgetForm')?.addEventListener('submit',(ev)=>{ ev.preventDefault(); const rec={ id:uid(), category:$('#budCategory')?.value, limit:Number($('#budLimit')?.value||0) }; state.budgets.push(rec); save(); toast('Presupuesto guardado'); ev.target.reset(); }); $('#addBudget')?.addEventListener('click', ()=>{ $('#budCategory')?.focus(); }); }
function renderPersonal(){ const tbody=$('#personalTable tbody'); if(!tbody) return; tbody.innerHTML=''; let total=0; state.personal.slice().sort(byDateDesc).forEach(p=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${p.date||''}</td><td>${p.category||''}</td><td>${p.desc||''}</td><td>${fmt(p.amount)}</td><td class="row-actions"><button class="btn-outline" data-edit="${p.id}">Editar</button><button class="btn-outline" data-del="${p.id}">Eliminar</button></td>`; tbody.appendChild(tr); total+=Number(p.amount||0); }); $('#perSumTotal')&&($('#perSumTotal').textContent=fmt(total)); $$('#personalTable [data-del]').forEach(b=> b.onclick=()=>{ state.personal=state.personal.filter(x=>x.id!==b.dataset.del); save(); toast('Gasto personal eliminado'); }); $$('#personalTable [data-edit]').forEach(b=> b.onclick=()=> editPersonal(b.dataset.edit)); }
function editPersonal(id){ const i=state.personal.findIndex(x=>x.id===id); if(i<0) return; const p=state.personal[i]; let r=ask(p.date,'Fecha (YYYY-MM-DD)'); if(r.cancelled) return; p.date=r.value||p.date; r=ask(p.category,'Categoría'); if(r.cancelled) return; p.category=r.value||p.category; r=ask(p.desc,'Descripción'); if(r.cancelled) return; p.desc=r.value||p.desc; r=askNumber(p.amount,'Monto'); if(r.cancelled) return; p.amount=r.value; save(); toast('Gasto personal actualizado'); }
function wirePersonal(){ $('#personalForm')?.addEventListener('submit',(ev)=>{ ev.preventDefault(); const rec={ id:uid(), date:$('#perDate')?.value, category:$('#perCategory')?.value, desc:$('#perDesc')?.value, amount:Number($('#perAmount')?.value||0) }; if(!rec.date) return toast('Fecha requerida'); state.personal.push(rec); save(); toast('Gasto personal guardado'); ev.target.reset(); }); $('#addPersonal')?.addEventListener('click', ()=>{ if($('#perDate')) $('#perDate').value=todayStr(); $('#perAmount')?.focus(); }); }

/* ===================== Reportes / Home ===================== */
function isRecurrent(e){ const d=(e.desc||'').toLowerCase(); return e?.method==='Automático' || d.startsWith('recurrente'); }
function sumExpensesDailySplit(from, to){ let recurrent=0, nonRec=0; state.expensesDaily.filter(e=>inRange(e.date, from, to)).forEach(e=>{ const amt=Number(e.amount||0); if(isRecurrent(e)) recurrent+=amt; else nonRec+=amt; }); return { total: recurrent + nonRec, recurrent, nonRecurrent: nonRec }; }
function sumPaymentsRange(from, to){ return state.payments.filter(p => inRange(p.date, from, to)).reduce((a,b)=> a + Number(b.amount||0), 0); }
function sumPersonalRange(from, to){ return state.personal.filter(p => inRange(p.date, from, to)).reduce((a,b)=> a + Number(b.amount||0), 0); }
function sumRange(list, from, to){ if(!Array.isArray(list)) return 0; return list.filter(r=>inRange(r.date, from, to)).reduce((a,b)=>a+Number(b.amount||0),0); }
function startOfWeek(d){ const x=new Date(d); const day=x.getDay()||7; x.setDate(x.getDate()-day+1); x.setHours(0,0,0,0); return x; }
function renderReports(){
  const now=new Date();
  const today=now.toISOString().slice(0,10);
  const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const yearStart=new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
  const weekStart=startOfWeek(now).toISOString().slice(0,10);

  const incToday=sumRange(state.incomesDaily, today, today);
  const incWeek=sumRange(state.incomesDaily, weekStart, today);
  const incMonth=sumRange(state.incomesDaily, monthStart, today);
  const incYear=sumRange(state.incomesDaily, yearStart, today);

  const expTodaySplit = sumExpensesDailySplit(today, today);
  const expWeekSplit  = sumExpensesDailySplit(weekStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const expYearSplit  = sumExpensesDailySplit(yearStart, today);

  const perToday = sumPersonalRange(today, today);
  const perWeek  = sumPersonalRange(weekStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const perYear  = sumPersonalRange(yearStart, today);

  const payToday = sumPaymentsRange(today, today);
  const payWeek  = sumPaymentsRange(weekStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);
  const payYear  = sumPaymentsRange(yearStart, today);

  const expToday = expTodaySplit.total + perToday + payToday;
  const expWeek  = expWeekSplit.total  + perWeek  + payWeek;
  const expMonth = expMonthSplit.total + perMonth + payMonth;
  const expYear  = expYearSplit.total  + perYear  + payYear;

  $('#rToday')  && ($('#rToday').textContent  = `${fmt(incToday)} / ${fmt(expToday)}`);
  $('#rWeek')   && ($('#rWeek').textContent   = `${fmt(incWeek)} / ${fmt(expWeek)}`);
  $('#rMonth')  && ($('#rMonth').textContent  = `${fmt(incMonth)} / ${fmt(expMonth)}`);
  $('#rYear')   && ($('#rYear').textContent   = `${fmt(incYear)} / ${fmt(expYear)}`);
}
function renderHome(){
  const now=new Date();
  const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  const today=now.toISOString().slice(0,10);

  const incMonth = sumRange(state.incomesDaily, monthStart, today);
  const expMonthSplit = sumExpensesDailySplit(monthStart, today);
  const perMonth = sumPersonalRange(monthStart, today);
  const payMonth = sumPaymentsRange(monthStart, today);

  const totalExpenses = expMonthSplit.total + perMonth + payMonth;
  const balance = incMonth - totalExpenses;

  $('#kpiIncomesMonth') && ($('#kpiIncomesMonth').textContent = fmt(incMonth));
  $('#kpiExpensesMonth') && ($('#kpiExpensesMonth').textContent = fmt(totalExpenses));
  $('#kpiBalanceMonth') && ($('#kpiBalanceMonth').textContent  = fmt(balance));
  const c = $('#chart12'); if(!c) return; const ctx = c.getContext('2d');
  c.width = c.clientWidth; c.height = 180; ctx.clearRect(0,0,c.width,c.height);
  const months=[], inc=[], exp=[];
  for(let i=11;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10);
    const to = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
    months.push(d.toLocaleDateString('es-ES',{month:'short'}));
    const incM = sumRange(state.incomesDaily, from, to);
    const expSplit = sumExpensesDailySplit(from, to);
    const perM = sumPersonalRange(from, to);
    const payM = sumPaymentsRange(from, to);
    const expMTotal = expSplit.total + perM + payM;
    inc.push(incM); exp.push(expMTotal);
  }
  const max = Math.max(...inc, ...exp, 1);
  const barW = Math.floor((c.width-40) / (months.length*2));
  months.forEach((m,idx)=>{
    const x = idx*(barW*2)+20;
    const hI = Math.round((inc[idx]/max)*(c.height-30));
    const hE = Math.round((exp[idx]/max)*(c.height-30));
    ctx.fillStyle = '#C7A24B'; ctx.fillRect(x, c.height-10-hI, barW, hI);
    ctx.fillStyle = '#555'; ctx.fillRect(x+barW+4, c.height-10-hE, barW, hE);
    ctx.fillStyle = '#aaa'; ctx.font = '12px system-ui'; ctx.fillText(m, x, c.height-2);
  });
}

/* ===================== Exportar / Importar ===================== */
function exportJSON(){
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'finanzas-backup.json'; a.click();
  URL.revokeObjectURL(a.href); toast('JSON exportado');
}
function importJSON(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const incoming = JSON.parse(reader.result);
      if(confirm('¿Reemplazar TODO con el archivo? (Cancelar = fusionar)')){
        state = incoming; save(); toast('Datos reemplazados');
      } else {
        state.settings = Object.assign({}, state.settings, incoming.settings||{});
        ['expensesDaily','incomesDaily','payments','ordinary','budgets','personal','invoices','quotes'].forEach(k=>{
          if(Array.isArray(incoming[k])) state[k] = state[k].concat(incoming[k]);
        });
        save(); toast('Datos fusionados');
      }
    }catch{ toast('Archivo inválido'); }
  };
  reader.readAsText(file);
}

/* ===================== PDF (jsPDF) — Blanco y negro con LOGO, Ítems y Totales ===================== */
let jsPDFReady = false;
async function ensureJsPDF() {
  if (jsPDFReady) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
  jsPDFReady = true;
}

/* view: "invoices" o "quotes"; optionalId: si se pasa, genera una sola */
async function generatePDF(view = "expenses", optionalId=null) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const business = state.settings.businessName || "Mi Negocio";
  const logo = state.settings.logoBase64 || 'assets/logo.png';

  function headerCommon(title){
    try{
      if(logo.startsWith('data:')) doc.addImage(logo, 'PNG', 14, 10, 24, 24);
    }catch(e){}
    doc.setFont("helvetica","bold"); doc.setTextColor(0); doc.setFontSize(16);
    doc.text(business, 42, 18);
    doc.setFontSize(12); doc.text(title, 42, 26);
    doc.line(14, 36, 200, 36);
  }

  function tableSimple(headers, rows, startY=42){
    let y = startY;
    const colW = 180 / headers.length;
    doc.setFont("helvetica","bold"); doc.setFontSize(10);
    headers.forEach((h,i)=> doc.text(String(h), 14 + i*colW, y));
    y += 6; doc.line(14,y,200,y); y += 6;
    doc.setFont("helvetica","normal");
    rows.forEach(r=>{
      r.forEach((cell,i)=> doc.text(String(cell??'').substring(0,32), 14 + i*colW, y));
      y += 6;
      if(y > 280){ doc.addPage(); y = 20; }
    });
    return y;
  }

  function invoiceQuotePDF(kind, record){
    doc.setFont("helvetica","normal"); doc.setTextColor(0);
    headerCommon(kind==='invoice'?'FACTURA':'COTIZACIÓN');

    doc.setFontSize(10);
    const rightX = 200;
    const leftX  = 14;
    let y = 42;

    doc.setFont("helvetica","bold"); doc.text("Para:", leftX, y);
    doc.setFont("helvetica","normal");
    doc.text(String(record.client?.name||''), leftX, y+6);
    if(record.client?.email)  doc.text(String(record.client.email), leftX, y+12);
    if(record.client?.phone)  doc.text(String(record.client.phone), leftX, y+18);
    if(record.client?.address)doc.text(String(record.client.address), leftX, y+24);

    let ry = 42;
    doc.setFont("helvetica","bold"); doc.text(kind==='invoice'?'Factura #':'Cotización #', rightX-70, ry, {align:'left'});
    doc.setFont("helvetica","normal"); doc.text(String(record.number||''), rightX-20, ry, {align:'right'}); ry+=6;
    doc.setFont("helvetica","bold"); doc.text("Fecha", rightX-70, ry); doc.setFont("helvetica","normal"); doc.text(String(record.date||''), rightX-20, ry, {align:'right'}); ry+=6;
    if(kind==='invoice'){ doc.setFont("helvetica","bold"); doc.text("Vence", rightX-70, ry); doc.setFont("helvetica","normal"); doc.text(String(record.dueDate||''), rightX-20, ry, {align:'right'}); ry+=6; }
    if(kind==='quote'){ doc.setFont("helvetica","bold"); doc.text("Válida hasta", rightX-70, ry); doc.setFont("helvetica","normal"); doc.text(String(record.validUntil||''), rightX-20, ry, {align:'right'}); ry+=6; }

    y = 74; doc.line(14, y, 200, y); y+=6;

    const headers = ["Descripción","Cant.","Precio","Imp %","Importe"];
    const colW = [90,20,30,20,20];
    doc.setFont("helvetica","bold");
    let x = 14; headers.forEach((h,i)=>{ doc.text(h, x, y); x += colW[i]; });
    y+=6; doc.line(14,y,200,y); y+=6; doc.setFont("helvetica","normal");
    record.items.forEach(it=>{
      x=14;
      const base = (it.qty||0)*(it.price||0);
      const tax  = base*((it.tax||0)/100);
      const amt  = base+tax;
      const row = [it.desc||'', String(it.qty||0), Number(it.price||0).toFixed(2), String(it.tax||0), amt.toFixed(2)];
      row.forEach((cell,i)=>{ doc.text(String(cell).substring(0,60), x, y); x+=colW[i]; });
      y+=6; if(y>260){ doc.addPage(); y=20; }
    });

    if(y+30>290){ doc.addPage(); y=20; }
    y+=4; doc.line(120,y,200,y); y+=6;
    doc.setFont("helvetica","bold"); doc.text("Subtotal", 150, y); doc.setFont("helvetica","normal"); doc.text(fmt(record.subtotal||0), 198, y, {align:'right'}); y+=6;
    doc.setFont("helvetica","bold"); doc.text("Impuestos",150, y); doc.setFont("helvetica","normal"); doc.text(fmt(record.taxTotal||0), 198, y, {align:'right'}); y+=6;
    doc.setFont("helvetica","bold"); doc.text("TOTAL",    150, y); doc.setFont("helvetica","bold");   doc.text(fmt(record.total||0),    198, y, {align:'right'}); y+=10;

    if(record.note){ doc.setFont("helvetica","bold"); doc.text("Nota:", 14, y); doc.setFont("helvetica","normal"); doc.text(String(record.note).substring(0,240), 14, y+6); y+=12; }
    if(record.terms){ doc.setFont("helvetica","bold"); doc.text("Términos:", 14, y); doc.setFont("helvetica","normal"); doc.text(String(record.terms).substring(0,240), 14, y+6); y+=12; }
  }

  if(view==='invoices' && optionalId){
    const inv = state.invoices.find(x=>x.id===optionalId); if(!inv){ toast('Factura no encontrada'); return; }
    invoiceQuotePDF('invoice', inv);
    const fileName = `${business.replace(/\s+/g,'_')}_Factura_${inv.number||''}.pdf`;
    doc.save(fileName); toast(`PDF generado: ${fileName}`); return;
  }
  if(view==='quotes' && optionalId){
    const q = state.quotes.find(x=>x.id===optionalId); if(!q){ toast('Cotización no encontrada'); return; }
    invoiceQuotePDF('quote', q);
    const fileName = `${business.replace(/\s+/g,'_')}_Cotizacion_${q.number||''}.pdf`;
    doc.save(fileName); toast(`PDF generado: ${fileName}`); return;
  }

  let headers=[], rows=[], total=null;
  const titleMap = { payments:"PAGO DE NÓMINA", invoices:"FACTURAS", quotes:"COTIZACIONES" };
  const title = titleMap[view] || view.toUpperCase();
  headerCommon(title);

  if (view === "expenses") {
    headers = ["Fecha","Categoría","Descripción","Método","Monto"];
    rows = state.expensesDaily.map(e => [e.date, e.category, e.desc, e.method, Number(e.amount||0).toFixed(2)]);
    total = state.expensesDaily.reduce((a,e)=>a + Number(e.amount||0), 0);
  } else if (view === "incomes") {
    headers = ["Fecha","Cliente","Método","Monto"];
    rows = state.incomesDaily.map(i => [i.date, i.client, i.method, Number(i.amount||0).toFixed(2)]);
    total = state.incomesDaily.reduce((a,i)=>a + Number(i.amount||0), 0);
  } else if (view === "payments") {
    headers = ["Fecha","Empleado/Benef.","Categoría","Monto","Estado"];
    rows = state.payments.map(p => [p.date, p.to, p.category, Number(p.amount||0).toFixed(2), p.status]);
    total = state.payments.reduce((a,p)=>a + Number(p.amount||0), 0);
  } else if (view === "ordinary") {
    headers = ["Nombre","Monto","Frecuencia","Próxima"];
    rows = state.ordinary.map(o => [o.name, Number(o.amount||0).toFixed(2), o.freq, o.next]);
    total = state.ordinary.reduce((a,o)=>a + Number(o.amount||0), 0);
  } else if (view === "personal") {
    headers = ["Fecha","Categoría","Descripción","Monto"];
    rows = state.personal.map(p => [p.date, p.category, p.desc, Number(p.amount||0).toFixed(2)]);
    total = state.personal.reduce((a,p)=>a + Number(p.amount||0), 0);
  } else if (view === "invoices") {
    headers = ["Fecha","# Factura","Cliente","Total","Método"];
    rows = state.invoices.map(f => [f.date, f.number, f.client?.name||"", Number(f.total||0).toFixed(2), f.method||""]);
    total = state.invoices.reduce((a,f)=>a + Number(f.total||0), 0);
  } else if (view === "quotes") {
    headers = ["Fecha","# Cotización","Cliente","Total","Método"];
    rows = state.quotes.map(q => [q.date, q.number, q.client?.name||"", Number(q.total||0).toFixed(2), q.method||""]);
    total = state.quotes.reduce((a,q)=>a + Number(q.total||0), 0);
  } else if (view === "reports") {
    headers = ["Periodo","Ingresos","Gastos"];
    const now=new Date();
    const today=now.toISOString().slice(0,10);
    const monthStart=new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    const weekStart=new Date(now - 7*86400000).toISOString().slice(0,10);
    const incWeek = sumRange(state.incomesDaily, weekStart, today);
    const expWeek = sumRange(state.expensesDaily, weekStart, today)
      + sumRange(state.personal, weekStart, today)
      + sumRange(state.payments, weekStart, today);
    const incMonth = sumRange(state.incomesDaily, monthStart, today);
    const expMonth = sumRange(state.expensesDaily, monthStart, today)
      + sumRange(state.personal, monthStart, today)
      + sumRange(state.payments, monthStart, today);
    rows = [
      ["Semana", incWeek.toFixed(2),  expWeek.toFixed(2)],
      ["Mes",    incMonth.toFixed(2), expMonth.toFixed(2)]
    ];
    total = null;
  }

  let y = tableSimple(headers, rows, 42);
  if (total !== null) {
    if (y + 10 > 290) { doc.addPage(); y = 20; }
    doc.line(14, y, 200, y); y += 7;
    doc.setFont("helvetica","bold");
    doc.text("TOTAL", 14 + (180 - 40), y);
    doc.text(fmt(total), 200, y, {align:'right'});
  }

  const fileName = `${business.replace(/\s+/g,'_')}_${(title||view)}.pdf`;
  doc.save(fileName);
  toast(`PDF generado: ${fileName}`);
}
function wireExports(){
  $$('[data-print-view]').forEach(b=> b.addEventListener('click', ()=> generatePDF(b.dataset.printView)));
  $('#printBtn')?.addEventListener('click', ()=>{
    const current = document.querySelector('.view.visible')?.id || 'home';
    generatePDF(current);
  });
}

/* ===================== Settings / Datos / PIN / Cloud ===================== */
function wireSettings(){
  $('#saveSettings')?.addEventListener('click', ()=>{
    state.settings.businessName = $('#setName')?.value || 'Mi Negocio';
    state.settings.currency     = $('#setCurrency')?.value || 'USD';
    state.settings.theme.primary= $('#colorPrimary')?.value || state.settings.theme.primary;
    state.settings.theme.accent = $('#colorAccent')?.value  || state.settings.theme.accent;
    state.settings.theme.text   = $('#colorText')?.value    || state.settings.theme.text;
    save(); toast('Configuración guardada');
  });
  $('#setLogo')?.addEventListener('change', async (ev)=>{
    const f = ev.target.files[0]; if(!f) return;
    const base64 = await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f); });
    state.settings.logoBase64 = base64; save(); toast('Logo actualizado');
  });
  $('#delLogo')?.addEventListener('click', ()=>{ state.settings.logoBase64=''; save(); toast('Logo eliminado'); });

  $('#exportJSON')?.addEventListener('click', exportJSON);
  $('#importJSON')?.addEventListener('change', (ev)=>{ const f=ev.target.files[0]; if(f) importJSON(f); });

  $('#changePIN')?.addEventListener('click', async ()=>{
    const old = $('#pinOld')?.value; const n1 = $('#pinNew')?.value; const n2 = $('#pinNew2')?.value;
    if(!state.settings.pinHash) return toast('Primero crea un PIN en Login');
    const hashOld = await sha256(old||'');
    if(hashOld !== state.settings.pinHash) return toast('PIN actual incorrecto');
    if(n1!==n2 || (n1||'').length<4 || (n1||'').length>8) return toast('Nuevo PIN inválido');
    state.settings.pinHash = await sha256(n1); save(); toast('PIN actualizado');
    ['pinOld','pinNew','pinNew2'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
  });
}

const cloud = { user:null, autosync: JSON.parse(localStorage.getItem('autosync')||'false'), unsub:null };
function uiCloud(){
  $('#cloudStatus') && ($('#cloudStatus').textContent = cloud.user ? `Conectado como ${cloud.user.displayName||cloud.user.email||cloud.user.uid}` : 'No conectado');
  $('#btnSignIn') && ($('#btnSignIn').style.display  = cloud.user ? 'none' : 'inline-block');
  $('#btnSignOut') && ($('#btnSignOut').style.display = cloud.user ? 'inline-block' : 'none');
  $('#cloudAuto') && ($('#cloudAuto').checked = !!cloud.autosync);
}
function setAutosync(v){ cloud.autosync=!!v; localStorage.setItem('autosync', JSON.stringify(cloud.autosync)); uiCloud(); }
function cloudDocRef(){ if(!cloud.user) return null; return doc(db,'users',cloud.user.uid,'state','app'); }
async function cloudPull(replace=true){
  const ref = cloudDocRef(); if(!ref) return toast('Inicia sesión primero');
  const snap = await getDoc(ref); if(!snap.exists()){ toast('No hay datos en la nube aún'); return; }
  const remote = snap.data(), remoteUpdated = remote?._cloud?.updatedAt||0, localUpdated = state?._cloud?.updatedAt||0;
  if(replace || remoteUpdated >= localUpdated){ state = remote; }
  else{
    state.settings = Object.assign({}, state.settings, remote.settings||{});
    ['expensesDaily','incomesDaily','payments','ordinary','budgets','personal','invoices','quotes'].forEach(k=>{
      if(Array.isArray(remote[k])) state[k] = state[k].concat(remote[k]);
    });
    state._cloud.updatedAt = Math.max(localUpdated, remoteUpdated);
  }
  save({skipCloud:true}); toast('Datos cargados desde la nube');
}
async function cloudPush(){
  const ref = cloudDocRef(); if(!ref) return toast('Inicia sesión primero');
  state._cloud.updatedAt = nowMs();
  await setDoc(ref, { ...state, _serverUpdatedAt: serverTimestamp() }, { merge: true });
  save({skipCloud:true}); toast('Datos guardados en la nube');
}
let pushTimer; function cloudPushDebounced(){ clearTimeout(pushTimer); pushTimer=setTimeout(cloudPush,600); }
function cloudSubscribe(){
  if(!cloud.user) return; const ref=cloudDocRef(); cloud.unsub?.();
  cloud.unsub = onSnapshot(ref,(snap)=>{
    if(!snap.exists()) return;
    const remote=snap.data();
    if((remote?._cloud?.updatedAt||0) > (state?._cloud?.updatedAt||0)){
      state=remote; save({skipCloud:true}); toast('Actualizado desde la nube (tiempo real)');
    }
  });
}
function wireCloudUI(){
  const provider = new GoogleAuthProvider();
  $('#btnSignIn')?.addEventListener('click', async ()=>{
    try{ await signInWithPopup(auth, provider); }
    catch(e){ await signInWithRedirect(auth, provider); }
  });
  $('#btnSignOut')?.addEventListener('click', async ()=>{ await signOut(auth); });
  $('#cloudPull')?.addEventListener('click', ()=> cloudPull(true));
  $('#cloudPush')?.addEventListener('click', ()=> cloudPush());
  $('#cloudAuto')?.addEventListener('change', (e)=> setAutosync(e.target.checked));
  uiCloud();
  getRedirectResult(auth).catch(()=>{});
  onAuthStateChanged(auth, (user)=>{ 
    cloud.user=user||null; uiCloud(); 
    if(user){ cloudSubscribe(); } 
    else { cloud.unsub?.(); cloud.unsub=null; }
  });
}

/* ===================== Buscadores de historiales ===================== */
function wireHistorySearch(){
  $('#invSearch')?.addEventListener('input', (e)=> renderInvoicesHistory(e.target.value));
  $('#quoSearch')?.addEventListener('input', (e)=> renderQuotesHistory(e.target.value));
}

/* ===================== Refresh / Init ===================== */
function refreshAll(){
  safely(renderExpenses);
  safely(renderIncomes);
  safely(renderPayments);
  safely(renderOrdinary);
  safely(renderBudgets);
  safely(renderPersonal);
  safely(renderReports);
  safely(renderHome);

  safely(renderInvoicesKPI);
  safely(renderQuotesKPI);
  safely(()=>renderInvoicesHistory($('#invSearch')?.value||''));
  safely(()=>renderQuotesHistory($('#quoSearch')?.value||''));
}
function wireAll(){
  // Nav
  (function(){
    const sidebar = $('#sidebar');
    sidebar?.addEventListener('click', (ev)=>{
      const btn = ev.target.closest?.('.nav-btn');
      if(btn && btn.dataset.target){ showView(btn.dataset.target); sidebar.classList.remove('open'); }
    });
    $('#menuToggle')?.addEventListener('click', ()=> sidebar?.classList.toggle('open'));
  })();

  wireExports(); wireSettings();
  wireExpenses(); wireIncomes(); wirePayments(); wireOrdinary(); wireBudgets(); wirePersonal();
  wireInvoicesCreate(); wireQuotesCreate();
  wireCloudUI(); updateLoginUI(); wireHistorySearch();
  initCatalogs(); autoGenerateOrdinary();
  applyTheme(); refreshAll(); showView('login');
}

/* ===================== API consola ===================== */
self.app = { generatePDF, state, cloudPull, cloudPush };

/* ===================== Arranque ===================== */
document.addEventListener('DOMContentLoaded', wireAll);
