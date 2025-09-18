// /public/apps/usuarios_admin.app.js
// Gestión básica de usuarios: crear, editar, activar/desactivar, eliminar y seed inicial
import { auth, db } from '../firebase-init.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { registry as APP_REGISTRY } from '../framework/registry.js';

// Datos iniciales (los que compartiste)
const INITIAL_USERS = [
  { UsuarioID:'U001', Rol:'Administrador', Sucursal:'Central', Activo:true,  PIN:'1111', Puntos:0, Insignias:'' },
  { UsuarioID:'U002', Rol:'Todo en uno',  Sucursal:'Bodegon', Activo:true,  PIN:'2222', Puntos:0, Insignias:'' },
  { UsuarioID:'U003', Rol:'Bodeguero',    Sucursal:'Central', Activo:true,  PIN:'3333', Puntos:0, Insignias:'' },
  { UsuarioID:'U004', Rol:'Bodeguero',    Sucursal:'Cotran',  Activo:true,  PIN:'4444', Puntos:0, Insignias:'' },
  { UsuarioID:'U005', Rol:'Todo en uno',  Sucursal:'Coperna', Activo:true,  PIN:'5555', Puntos:0, Insignias:'' },
  { UsuarioID:'U006', Rol:'Todo en uno',  Sucursal:'SucursalPrueba', Activo:true, PIN:'6666', Puntos:0, Insignias:'' },
  { UsuarioID:'U007', Rol:'Vendedor',    Sucursal:'Cotran',  Activo:true,  PIN:'7777', Puntos:0, Insignias:'' },
  { UsuarioID:'U008', Rol:'Supervisor',   Sucursal:'Central', Activo:true,  PIN:'8888', Puntos:0, Insignias:'' },
  { UsuarioID:'U009', Rol:'Todo en uno',  Sucursal:'Cotran',  Activo:true,  PIN:'9999', Puntos:0, Insignias:'' },
  { UsuarioID:'U010', Rol:'Vendedor',    Sucursal:'Central', Activo:true,  PIN:'1010', Puntos:0, Insignias:'' },
];

const BANK_ACCOUNTS = [
  { id:1,  name:'Caja central' },
  { id:6,  name:'Caja Principal' },
  { id:8,  name:'Caja Sucursal' },
  { id:10, name:'Caja Coperna' },
  { id:11, name:'Banpro Comercial' },
  { id:12, name:'Banpro ahorro' },
  { id:15, name:'BAC córdobas' },
];

function humanizeAppId(id){
  return id.replace(/_/g,' ').replace(/\b\w/g, m => m.toUpperCase());
}
const APP_CHOICES = Object.keys(APP_REGISTRY)
  .filter(id => APP_REGISTRY.has(id))
  // opcional: filtra internas si tienes alguna convención
  .filter(k => !k.startsWith('_'))
  .map(id => ({ id, label: humanizeAppId(id) }));

export default {
  async mount(container) {
    container.innerHTML = `
      <div class="p-4 md:p-6 max-w-5xl mx-auto">
        <header class="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
          <div>
            <h1 class="text-2xl font-bold text-slate-900">Usuarios</h1>
            <p class="text-slate-500 text-sm">Crea, edita y administra los usuarios internos.</p>
          </div>
          <div class="flex gap-2 w-full md:w-auto">
            <button id="seedBtn" class="flex-1 md:flex-none px-4 h-11 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold">Importar USUARIOS</button>
            <button id="newBtn"  class="flex-1 md:flex-none px-4 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold">Nuevo</button>
          </div>
        </header>

        <section class="bg-white rounded-2xl shadow p-4 mb-3">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label class="block text-xs text-slate-600">Buscar</label>
              <input id="qText" type="text" placeholder="ID, Rol, Sucursal"
                class="mt-1 w-full h-10 rounded-lg border border-slate-300 p-2">
            </div>
            <div>
              <label class="block text-xs text-slate-600">Rol</label>
              <select id="qRol" class="mt-1 w-full h-10 rounded-lg border border-slate-300 p-2">
                <option value="">Todos</option>
                <option>Administrador</option>
                <option>Supervisor</option>
                <option>Bodeguero</option>
                <option>Vendedor</option>
                <option>Todo en uno</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600">Sucursal</label>
              <input id="qSucursal" type="text" placeholder="Central, Cotran..."
                class="mt-1 w-full h-10 rounded-lg border border-slate-300 p-2">
            </div>
            <div class="flex items-end">
              <button id="clearFilters" class="w-full h-10 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800">Limpiar</button>
            </div>
          </div>
        </section>

        <section id="list" class="space-y-2">
          <div id="loader" class="flex items-center justify-center py-10">
            <div class="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <p class="ml-3 text-slate-500">Cargando...</p>
          </div>
        </section>
      </div>

      <div id="user-modal" class="fixed inset-0 hidden bg-black/60 z-50 items-center justify-center p-4">
        <div class="bg-white rounded-2xl w-full max-w-xl p-5">
          <h3 id="modal-title" class="text-lg font-bold text-slate-900">Nuevo usuario</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <label class="block text-xs text-slate-600">UsuarioID</label>
              <input id="f-id" type="text" class="mt-1 w-full h-11 rounded-lg border border-slate-300 p-2" placeholder="U011">
              <p class="text-[11px] text-slate-400 mt-1">Se usará como ID del documento.</p>
            </div>
            <div>
              <label class="block text-xs text-slate-600">Rol</label>
              <select id="f-rol" class="mt-1 w-full h-11 rounded-lg border border-slate-300 p-2">
                <option>Administrador</option>
                <option>Supervisor</option>
                <option>Bodeguero</option>
                <option>Vendedor</option>
                <option>Todo en uno</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600">Sucursal</label>
              <input id="f-sucursal" type="text" class="mt-1 w-full h-11 rounded-lg border border-slate-300 p-2" placeholder="Central">
            </div>
            <div class="flex items-center gap-2">
              <input id="f-activo" type="checkbox" class="h-5 w-5" checked>
              <label class="text-sm">Activo</label>
            </div>
            <div>
              <label class="block text-xs text-slate-600">PIN</label>
              <input id="f-pin" type="text" class="mt-1 w-full h-11 rounded-lg border border-slate-300 p-2" placeholder="****">
            </div>
            <div>
              <label class="block text-xs text-slate-600">Puntos</label>
              <input id="f-puntos" type="number" class="mt-1 w-full h-11 rounded-lg border border-slate-300 p-2" value="0">
            </div>
            <div class="md:col-span-2">
              <label class="block text-xs text-slate-600">Insignias</label>
              <input id="f-insignias" type="text" class="mt-1 w-full h-11 rounded-lg border border-slate-300 p-2" placeholder="separa por coma">
            </div>

            <div class="md:col-span-2 mt-2">
              <details class="rounded-lg border border-slate-200 p-3">
                <summary class="cursor-pointer text-sm font-semibold">Opcional: Cajas permitidas & Caja por defecto</summary>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label class="block text-xs text-slate-600">Cajas permitidas</label>
                    <div id="f-cajas" class="mt-2 grid grid-cols-2 gap-2"></div>
                  </div>
                  <div>
                    <label class="block text-xs text-slate-600">Caja por defecto</label>
                    <select id="f-caja-def" class="mt-1 w-full h-11 rounded-lg border border-slate-300 p-2">
                      <option value="">—</option>
                      ${BANK_ACCOUNTS.map(b=>`<option value="${b.id}">${b.name} (#${b.id})</option>`).join('')}
                    </select>
                  </div>
                </div>
              </details>
            </div>
            <div class="md:col-span-2 mt-2">
              <details class="rounded-lg border border-slate-200 p-3">
                <summary class="cursor-pointer text-sm font-semibold">Módulos visibles</summary>
                <div id="f-modulos" class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2"></div>
                <p class="text-[11px] text-slate-500 mt-2">
                  Marca los módulos que este usuario podrá ver en el menú.
                </p>
              </details>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 mt-5">
            <button id="modal-cancel" class="h-11 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800">Cancelar</button>
            <button id="modal-save" class="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold">Guardar</button>
          </div>
        </div>
      </div>

      <div id="toast-container" class="fixed bottom-4 right-4 z-50"></div>
    `;

    // ================== Refs
    const $ = s => container.querySelector(s);
    const listEl   = $('#list');
    const loaderEl = $('#loader');
    const seedBtn  = $('#seedBtn');
    const newBtn   = $('#newBtn');
    const qText    = $('#qText');
    const qRol     = $('#qRol');
    const qSucursal= $('#qSucursal');
    const clearBtn = $('#clearFilters');

    // Modal refs
    const modalEl  = $('#user-modal');
    const modalTitle = $('#modal-title');
    const fId = $('#f-id');
    const fRol = $('#f-rol');
    const fSuc = $('#f-sucursal');
    const fActivo = $('#f-activo');
    const fPin = $('#f-pin');
    const fPuntos = $('#f-puntos');
    const fInsig = $('#f-insignias');
    const fCajasWrap = $('#f-cajas');
    const fCajaDef = $('#f-caja-def');
    const modalCancel = $('#modal-cancel');
    const modalSave = $('#modal-save');
    const fModulos = $('#f-modulos');

    // ================== Estado
    const usersCol = collection(db, 'usuarios');
    let unsub = null;
    let allUsers = [];
    let editingId = null; // UsuarioID en edición

    // ================== Helpers
    function toast(msg, type='info'){
      const colors = { info:'bg-sky-600', success:'bg-emerald-600', error:'bg-red-600' };
      const div = document.createElement('div');
      div.className = `mb-2 ${colors[type]} text-white font-bold py-3 px-5 rounded-xl shadow-xl`;
      div.textContent = msg;
      $('#toast-container').appendChild(div);
      setTimeout(()=>div.remove(), 2400);
    }
    function openModal(title, data=null){
      modalTitle.textContent = title;
      // build checkboxes for cajas permitidas
      fCajasWrap.innerHTML = BANK_ACCOUNTS.map(b=>{
        const id = `caja_${b.id}`;
        return `<label class="flex items-center gap-2 text-sm">
          <input type="checkbox" id="${id}" data-boxid="${b.id}" class="h-4 w-4">
          <span>${b.name} (#${b.id})</span>
        </label>`;
      }).join('');
      // build checkboxes para módulos visibles
      fModulos.innerHTML = APP_CHOICES.map(a => `
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" data-appid="${a.id}" class="h-4 w-4">
          <span>${a.label} <span class="text-[11px] text-slate-400">(${a.id})</span></span>
        </label>
      `).join('');
      if (data){
        fId.value = data.UsuarioID || '';
        fId.disabled = true;
        fRol.value = data.Rol || 'Vendedor';
        fSuc.value = data.Sucursal || '';
        fActivo.checked = !!data.Activo;
        fPin.value = data.PIN || '';
        fPuntos.value = Number.isFinite(data.Puntos) ? data.Puntos : 0;
        fInsig.value = data.Insignias || '';

        const boxes = Array.isArray(data.allowedBoxes) ? data.allowedBoxes : [];
        BANK_ACCOUNTS.forEach(b=>{
          const cb = fCajasWrap.querySelector(`[data-boxid="${b.id}"]`);
          if (cb) cb.checked = boxes.includes(b.id);
        });
        fCajaDef.value = data.defaultBankAccountId ? String(data.defaultBankAccountId) : '';
        const mods = Array.isArray(data.allowedApps) ? data.allowedApps : [];
        APP_CHOICES.forEach(a => {
          const cb = fModulos.querySelector(`[data-appid="${a.id}"]`);
          if (cb) cb.checked = mods.includes(a.id);
        });
      } else {
        fId.value=''; fId.disabled=false;
        fRol.value='Vendedor';
        fSuc.value='';
        fActivo.checked=true;
        fPin.value='';
        fPuntos.value=0;
        fInsig.value='';
        BANK_ACCOUNTS.forEach(b=>{
          const cb = fCajasWrap.querySelector(`[data-boxid="${b.id}"]`);
          if (cb) cb.checked = false;
        });
        fCajaDef.value='';
        // módulos sin selección por defecto
      }
      modalEl.classList.remove('hidden');
      modalEl.classList.add('flex');
    }
    function closeModal(){
      modalEl.classList.add('hidden');
      modalEl.classList.remove('flex');
      editingId = null;
    }

    function filtered(){
      const term = (qText.value||'').toLowerCase().trim();
      const role = qRol.value || '';
      const suc  = (qSucursal.value||'').toLowerCase().trim();
      return allUsers.filter(u=>{
        if (role && (u.Rol||'') !== role) return false;
        if (suc && !(u.Sucursal||'').toLowerCase().includes(suc)) return false;
        if (term){
          const h = [u.UsuarioID, u.Rol, u.Sucursal].join(' ').toLowerCase();
          if (!h.includes(term)) return false;
        }
        return true;
      });
    }

    function render(){
      const data = filtered();
      if (!data.length){
        listEl.innerHTML = `
          <div class="bg-white rounded-2xl p-6 text-center text-slate-500 border border-slate-200">
            No hay usuarios que coincidan con los filtros.
          </div>`;
        return;
      }
      listEl.innerHTML = data.map(renderCard).join('');
    }

    function renderCard(u){
      const badge = u.Activo
        ? `<span class="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Activo</span>`
        : `<span class="text-xs px-2 py-1 rounded-full bg-slate-200 text-slate-600 font-semibold">Inactivo</span>`;
      const boxes = Array.isArray(u.allowedBoxes) ? u.allowedBoxes.join(', ') : '—';
      const defBox = u.defaultBankAccountId ? `#${u.defaultBankAccountId}` : '—';
      const mods = Array.isArray(u.allowedApps) && u.allowedApps.length
        ? u.allowedApps.join(', ') : '—';

      return `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-start justify-between gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-bold text-slate-900">${u.UsuarioID || '—'}</h3>
              ${badge}
            </div>
            <p class="text-sm text-slate-600 mt-0.5"><span class="font-medium">Rol:</span> ${u.Rol || '—'} · <span class="font-medium">Sucursal:</span> ${u.Sucursal || '—'}</p>
            <p class="text-xs text-slate-500 mt-1">Puntos: ${Number(u.Puntos||0)} · Insignias: ${u.Insignias || '—'}</p>
            <p class="text-xs text-slate-500 mt-1">Cajas permitidas: ${boxes} · Caja por defecto: ${defBox}</p>
            <p class="text-xs text-slate-500 mt-1">Módulos: ${mods}</p>
          </div>
          <div class="flex flex-col gap-2 w-40">
            <button class="edit-btn h-10 rounded-xl bg-sky-100 hover:bg-sky-200 text-sky-800 font-semibold" data-id="${u.UsuarioID}">Editar</button>
            <button class="toggle-btn h-10 rounded-xl ${u.Activo ? 'bg-amber-100 text-amber-900 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'} font-semibold" data-id="${u.UsuarioID}">
              ${u.Activo ? 'Desactivar' : 'Activar'}
            </button>
            <button class="delete-btn h-10 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 font-semibold" data-id="${u.UsuarioID}">Eliminar</button>
          </div>
        </div>
      `;
    }

    // ================== Eventos
    newBtn.addEventListener('click', ()=> openModal('Nuevo usuario', null));
    clearBtn.addEventListener('click', ()=>{
      qText.value=''; qRol.value=''; qSucursal.value='';
      render();
    });
    ;[qText, qRol, qSucursal].forEach(el=>{
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });

    listEl.addEventListener('click', async (e)=>{
      const edit = e.target.closest('.edit-btn');
      const toggle = e.target.closest('.toggle-btn');
      const del = e.target.closest('.delete-btn');
      if (edit){
        const id = edit.dataset.id;
        const snap = await getDoc(doc(db, 'usuarios', id));
        if (!snap.exists()){
          toast('No se encontró el usuario.', 'error'); return;
        }
        editingId = id;
        openModal('Editar usuario', snap.data());
      } else if (toggle){
        const id = toggle.dataset.id;
        const ref = doc(db, 'usuarios', id);
        const snap = await getDoc(ref);
        if (!snap.exists()){ toast('No se encontró el usuario.', 'error'); return; }
        const cur = !!snap.data().Activo;
        await updateDoc(ref, { Activo: !cur, updatedAt: serverTimestamp() });
        toast(!cur ? 'Usuario activado' : 'Usuario desactivado', 'success');
      } else if (del){
        const id = del.dataset.id;
        if (!confirm(`¿Eliminar usuario ${id}?`)) return;
        await deleteDoc(doc(db, 'usuarios', id));
        toast('Usuario eliminado', 'success');
      }
    });

    modalCancel.addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e)=>{ if (e.target === modalEl) closeModal(); });

    modalSave.addEventListener('click', async ()=>{
      const UsuarioID = fId.value.trim();
      const Rol = fRol.value.trim();
      const Sucursal = fSuc.value.trim();
      const Activo = !!fActivo.checked;
      const PIN = fPin.value.trim();
      const Puntos = Number(fPuntos.value || 0);
      const Insignias = fInsig.value.trim();

      if (!UsuarioID){ toast('UsuarioID es requerido.', 'error'); return; }
      if (!Rol){ toast('Rol es requerido.', 'error'); return; }
      if (!Sucursal){ toast('Sucursal es requerida.', 'error'); return; }
      if (!PIN){ toast('PIN es requerido.', 'error'); return; }

      const allowedBoxes = Array.from(fCajasWrap.querySelectorAll('input[type="checkbox"][data-boxid]'))
        .filter(cb => cb.checked).map(cb => Number(cb.dataset.boxid));
      const defaultBankAccountId = fCajaDef.value ? Number(fCajaDef.value) : null;
      let allowedApps = Array.from(fModulos.querySelectorAll('input[type="checkbox"][data-appid]'))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.appid);
      // sanity check: solo apps válidas del registry
      allowedApps = allowedApps.filter(id => APP_REGISTRY.has(id));

      const payload = {
        UsuarioID, Rol, Sucursal, Activo, PIN, Puntos, Insignias,
        allowedBoxes: allowedBoxes.length ? allowedBoxes : [],
        allowedApps: allowedApps.length ? allowedApps : [],
        defaultBankAccountId,
        updatedAt: serverTimestamp()
      };

      try{
        if (editingId){
          await setDoc(doc(db, 'usuarios', editingId), payload, { merge:true });
          toast('Usuario actualizado', 'success');
        } else {
          payload.createdAt = serverTimestamp();
          // Usa UsuarioID como ID del doc (evita duplicados)
          await setDoc(doc(db, 'usuarios', UsuarioID), payload, { merge:false });
          toast('Usuario creado', 'success');
        }
        closeModal();
      } catch(err){
        console.error(err);
        toast('Error al guardar.', 'error');
      }
    });

    // Importación inicial (seed/update por UsuarioID)
    seedBtn.addEventListener('click', async ()=>{
      if (!confirm('Esto importará/actualizará la lista inicial de USUARIOS. ¿Continuar?')) return;
      try{
        for (const u of INITIAL_USERS){
          const ref = doc(db, 'usuarios', u.UsuarioID);
          await setDoc(ref, {
            ...u,
            allowedBoxes: Array.isArray(u.allowedBoxes) ? u.allowedBoxes : [],
            allowedApps: Array.isArray(u.allowedApps) ? u.allowedApps : [],
            defaultBankAccountId: u.defaultBankAccountId || null,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp()
          }, { merge:true });
        }
        toast('Importación completada.', 'success');
      } catch(err){
        console.error(err);
        toast('Error al importar.', 'error');
      }
    });

    // ================== Suscripción
    function attach(){
      if (unsub) { unsub(); unsub = null; }
      loaderEl?.classList.remove('hidden');
      const qy = query(usersCol, orderBy('UsuarioID')); // índice simple
      unsub = onSnapshot(qy, (snap)=>{
        loaderEl?.classList.add('hidden');
        allUsers = snap.docs.map(d => d.data());
        render();
      }, (err)=>{
        loaderEl?.classList.add('hidden');
        console.error(err);
        toast('Error de suscripción.', 'error');
      });
    }

    onAuthStateChanged(auth, (user)=>{
      // (opcional) podrías limitar solo a admin aquí
      attach();
    });
  },

  unmount(){ /* opcional: limpiar listeners */ }
};