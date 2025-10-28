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
