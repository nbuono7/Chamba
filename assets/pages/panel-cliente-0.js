
const BACKEND = 'https://chamba-backend-vurx.onrender.com';
let usuario = null;
let misUbicaciones = [];
let misDisputas = [];
let misRelacionesSocio = [];
let misPedidos = [];
let todasOfertas = {};
let iaSugerencia = null;
let estrellasPorPedido = {};
let tagsPorPedido = {};
const TAGS_CALIFICACION = ['Rápido', 'Buen trabajo', 'Prolijo', 'Puntual', 'Buena comunicación', 'Lento', 'Deficiente', 'Mala comunicación'];
let foroPosts = [];

// ── MODAL PROPIO (reemplaza alert/confirm) ──
function showModal(icon, title, msg, btns) {
  document.getElementById('modal-icon').textContent = icon;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent = msg;
  document.getElementById('modal-btns').innerHTML = Chamba.html('');
  btns.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.class || 'btn-teal');
    el.textContent = b.label;
    el.onclick = () => { closeModal(); b.action && b.action(); };
    document.getElementById('modal-btns').appendChild(el);
  });
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
function showInfo(icon, title, msg) { showModal(icon, title, msg, [{ label: 'OK' }]); }
function showConfirm(icon, title, msg, onOk, labelOk='Confirmar', labelCancel='Cancelar') {
  showModal(icon, title, msg, [
    { label: labelOk, action: onOk },
    { label: labelCancel, class: 'btn-ghost' }
  ]);
}

window.onload = async () => {
  const u = localStorage.getItem('chamba_user');
  if (!u) return window.location.href = '/login';
  usuario = JSON.parse(u);
  if (usuario.tipo !== 'cliente') {
    return window.location.href = usuario.tipo === 'admin' ? '/admin' : usuario.tipo === 'socio' ? '/panel-socio' : '/login';
  }
  try {
    const todos = await api('/api/usuarios');
    const fresco = Array.isArray(todos) ? todos.find(x => x.email === usuario.email) : null;
    if (fresco) { delete fresco.password_hash; usuario = fresco; localStorage.setItem('chamba_user', JSON.stringify(fresco)); }
  } catch(e) {}
  if (usuario.tipo !== 'cliente') {
    return window.location.href = usuario.tipo === 'admin' ? '/admin' : usuario.tipo === 'socio' ? '/panel-socio' : '/login';
  }
  document.getElementById('sidebar-user').textContent = usuario.nombre;
  document.getElementById('user-avatar').textContent = iniciales(usuario.nombre);
  document.getElementById('bienvenida').textContent = 'Hola, ' + usuario.nombre.split(' ')[0] + ' 👋';
  renderPerfil();
  cargarUbicaciones();
  cargarEspecialidades();
  await cargarTodo();
  setInterval(()=>{if(!document.hidden)cargarTodo();}, 30000);
  if (window.location.hash === '#mi-perfil') {
    goTo('mi-perfil', document.querySelector('[data-profile-nav]'));
  }
};

function iniciales(nombre) {
  return (nombre || '').trim().split(/\s+/).slice(0,2).map(p => p[0]).join('').toUpperCase();
}

async function cargarEspecialidades() {
  try {
    const especialidades = await api('/api/especialidades');
    const select = document.getElementById('p-servicio');
    if (select && Array.isArray(especialidades)) {
      const actual = select.value;
      select.innerHTML = Chamba.html('<option value="">Elegí el servicio</option>' +
        especialidades.filter(e => e.activa).map(e => `<option>${Chamba.escape(e.nombre)}</option>`).join(''));
      if (actual) select.value = actual;
      recuperarBorrador();
    }
  } catch(e) {}
}

window.addEventListener('storage', (e) => {
  if (e.key === 'chamba_user' && e.newValue) {
    const nuevo = JSON.parse(e.newValue);
    if (nuevo.id !== usuario?.id) window.location.reload();
  }
});

function doLogout() { Chamba.clearDraft(); localStorage.removeItem('chamba_user'); localStorage.removeItem('chamba_token'); window.location.href = '/'; }

function renderPerfil() {
  document.getElementById('perfil-grid').innerHTML = Chamba.html(`
    <div class="form-group"><label>Nombre</label><input type="text" id="perfil-nombre" value="${Chamba.escape(usuario.nombre||'')}"/></div>
    <div><div class="perfil-label">Email</div><div class="perfil-val">${Chamba.escape(usuario.email)}</div></div>
    <div class="form-group"><label for="perfil-telefono">Teléfono</label><input type="text" id="perfil-telefono" value="${Chamba.escape(usuario.telefono||'')}"/></div>`);
  const usuarioActualEl = document.getElementById('usuario-actual');
  if (usuarioActualEl) usuarioActualEl.textContent = '@' + (usuario.nombre_usuario || '—');
}

let timerChequeoUsuarioPerfil = null;
let usuarioPerfilDisponible = false;

function chequearUsuarioPerfil() {
  const input = document.getElementById('nuevo-usuario');
  const estado = document.getElementById('usuario-perfil-estado');
  const sugerenciasBox = document.getElementById('usuario-perfil-sugerencias');
  input.value = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const valor = input.value;
  usuarioPerfilDisponible = false;
  sugerenciasBox.innerHTML = Chamba.html('');
  clearTimeout(timerChequeoUsuarioPerfil);

  if (!valor) {
    estado.textContent = '3 a 20 caracteres: minúsculas, números y guion bajo (_).';
    estado.style.color = 'var(--text-soft)';
    return;
  }
  if (valor.length < 3) {
    estado.textContent = 'Muy corto — necesita al menos 3 caracteres.';
    estado.style.color = '#a32d2d';
    return;
  }
  if (valor === usuario.nombre_usuario) {
    estado.textContent = 'Ese ya es tu nombre de usuario actual.';
    estado.style.color = '#a32d2d';
    return;
  }
  estado.textContent = 'Chequeando disponibilidad...';
  estado.style.color = 'var(--text-soft)';
  timerChequeoUsuarioPerfil = setTimeout(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/usuarios/chequear-usuario?nombre_usuario=${encodeURIComponent(valor)}`);
      const data = await r.json();
      if (data.disponible) {
        usuarioPerfilDisponible = true;
        estado.textContent = '✓ Disponible';
        estado.style.color = '#1a8f5e';
      } else {
        usuarioPerfilDisponible = false;
        estado.textContent = data.error || 'Ese usuario ya existe.';
        estado.style.color = '#a32d2d';
        if (Array.isArray(data.sugerencias) && data.sugerencias.length) {
          sugerenciasBox.innerHTML =
            Chamba.html('<span style="font-size:12px;color:var(--text-soft);width:100%">¿Probás con alguna de estas?</span>' +
            data.sugerencias.map(s => `<button type="button" class="chip-sugerencia" ${Chamba.bind("click",function(event){elegirSugerenciaUsuarioPerfil(`${s}`)})}>${Chamba.escape(s)}</button>`).join(''));
        }
      }
    } catch (e) {
      estado.textContent = 'No pudimos chequear la disponibilidad. Probá de nuevo.';
      estado.style.color = '#a32d2d';
    }
  }, 500);
}

function elegirSugerenciaUsuarioPerfil(valor) {
  document.getElementById('nuevo-usuario').value = valor;
  chequearUsuarioPerfil();
}

async function cambiarNombreUsuario() {
  const valor = document.getElementById('nuevo-usuario').value.trim();
  if (!valor) return showInfo('⚠️', 'Falta el nombre de usuario', 'Escribí el nuevo nombre de usuario que querés usar.');
  if (!usuarioPerfilDisponible) return showInfo('⚠️', 'Todavía no', 'Elegí un nombre de usuario disponible antes de continuar (mirá el chequeo debajo del campo).');
  const r = await api('/api/usuarios/cambiar-usuario', 'POST', { nombre_usuario: valor });
  if (r.error) return showInfo('❌', 'No se pudo cambiar', r.error);
  usuario = { ...usuario, nombre_usuario: r.nombre_usuario };
  localStorage.setItem('chamba_user', JSON.stringify(usuario));
  document.getElementById('nuevo-usuario').value = '';
  document.getElementById('usuario-perfil-estado').textContent = '3 a 20 caracteres: minúsculas, números y guion bajo (_).';
  document.getElementById('usuario-perfil-estado').style.color = 'var(--text-soft)';
  renderPerfil();
  showInfo('✅', 'Listo', 'Tu nombre de usuario se actualizó. Vas a poder volver a cambiarlo recién en 3 meses.');
}

function direccionCorta(direccionCompleta) {
  const partes = (direccionCompleta || '').split(',').map(p => p.trim()).filter(Boolean);
  if (!partes.length) return direccionCompleta || '';
  // Nominatim suele devolver "1793, Arévalo, ..." (número primero) — lo mostramos como "Arévalo 1793"
  if (partes.length >= 2 && /^\d+[a-zA-Z]?$/.test(partes[0])) return `${partes[1]} ${partes[0]}`;
  return partes.slice(0, 2).join(', ');
}

async function cargarUbicaciones() {
  try {
    const ubs = await api('/api/ubicaciones');
    misUbicaciones = Array.isArray(ubs) ? ubs : [];
    const box = document.getElementById('lista-ubicaciones');
    if (box) {
      box.innerHTML = Chamba.html(misUbicaciones.length ? misUbicaciones.map(u => `
        <div class="ubicacion-item">
          <div class="ubicacion-info">
            <div class="etiqueta">${Chamba.escape(u.etiqueta)} ${u.predeterminada ? '<span class="badge badge-green" style="margin-left:6px">Predeterminada</span>' : ''}</div>
            <div class="direccion">${Chamba.escape(direccionCorta(u.direccion))}${Chamba.escape(u.piso_depto ? ' — ' + u.piso_depto : '')}</div>
          </div>
          <div class="ubicacion-acciones">
            ${!u.predeterminada ? `<button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){marcarPredeterminada(`${u.id}`)})}>Usar como predeterminada</button>` : ''}
            <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){editarUbicacion(`${u.id}`)})}>✏️</button>
            <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){eliminarUbicacion(`${u.id}`)})}>🗑️</button>
          </div>
        </div>`).join('') : '<div style="font-size:13px;color:var(--text-soft)">Todavía no agregaste ninguna ubicación.</div>');
    }
    const select = document.getElementById('p-ubicacion');
    if (select) {
      const actual = select.value;
      select.innerHTML = Chamba.html('<option value="">Elegí una ubicación...</option>' + misUbicaciones.map(u => `<option value="${Chamba.escape(u.id)}">${Chamba.escape(u.etiqueta)} — ${Chamba.escape(u.direccion)}</option>`).join(''));
      if (actual) select.value = actual;
      else { const pred = misUbicaciones.find(u => u.predeterminada); if (pred) select.value = pred.id; }
    }
  } catch(e) {}
}

// ── UBICACIONES: buscar → confirmar en mapa → detalles (estilo PedidosYa) ──
let mapaPicker = null, marcadorPicker = null;
let ubSugerenciasCache = [];
let ubBusquedaTimer = null;
let ubSeleccionActual = null; // { direccion, lat, lng }
let ubEditandoId = null; // si no es null, "Guardar" hace PATCH en vez de POST

function onBuscarDireccion(texto) {
  clearTimeout(ubBusquedaTimer);
  const box = document.getElementById('ub-sugerencias');
  if (!texto || texto.trim().length < 3) { box.classList.remove('open'); return; }
  ubBusquedaTimer = setTimeout(async () => {
    const r = await api('/api/geocodificar-buscar?q=' + encodeURIComponent(texto));
    ubSugerenciasCache = Array.isArray(r) ? r : [];
    if (!ubSugerenciasCache.length) { box.innerHTML = Chamba.html('<div class="ub-sugerencia-item" style="color:var(--text-soft)">No encontramos direcciones. Probá con calle, número y ciudad.</div>'); box.classList.add('open'); return; }
    box.innerHTML = Chamba.html(ubSugerenciasCache.map((s,i) => `<div class="ub-sugerencia-item" ${Chamba.bind("click",function(event){seleccionarSugerencia((i))})}><span class="icono">📍</span><span>${Chamba.escape(s.display_name)}</span></div>`).join(''));
    box.classList.add('open');
  }, 400);
}

function seleccionarSugerencia(i) {
  const s = ubSugerenciasCache[i];
  document.getElementById('ub-sugerencias').classList.remove('open');
  document.getElementById('ub-busqueda').value = s.display_name;
  document.getElementById('ub-paso-buscar').style.display = 'none';
  document.getElementById('ub-paso-mapa').style.display = 'block';
  ubSeleccionActual = { direccion: s.display_name, lat: s.lat, lng: s.lng };
  mostrarMapaPicker(s.lat, s.lng);
}

function mostrarMapaPicker(lat, lng) {
  if (!mapaPicker) {
    mapaPicker = L.map('mapa-picker').setView([lat, lng], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(mapaPicker);
    marcadorPicker = L.marker([lat, lng], { draggable: true }).addTo(mapaPicker);
    marcadorPicker.on('dragend', () => { const pos = marcadorPicker.getLatLng(); actualizarDireccionDetectada(pos.lat, pos.lng); });
  } else {
    mapaPicker.setView([lat, lng], 17);
    marcadorPicker.setLatLng([lat, lng]);
  }
  setTimeout(() => mapaPicker.invalidateSize(), 150);
  actualizarDireccionDetectada(lat, lng);
}

async function actualizarDireccionDetectada(lat, lng) {
  document.getElementById('mapa-direccion-detectada').textContent = 'Identificando la dirección...';
  const r = await api(`/api/geocodificar-inverso?lat=${lat}&lng=${lng}`);
  if (r.error) { document.getElementById('mapa-direccion-detectada').textContent = '⚠️ No pudimos identificar este punto exacto.'; return; }
  ubSeleccionActual = { direccion: r.direccion, lat, lng };
  document.getElementById('mapa-direccion-detectada').textContent = r.direccion;
}

function volverABuscar() {
  document.getElementById('ub-paso-mapa').style.display = 'none';
  document.getElementById('ub-paso-buscar').style.display = 'block';
}

function irADetalles() {
  if (!ubSeleccionActual) return showInfo('⚠️', 'Esperá un momento', 'Todavía estamos identificando la ubicación del pin.');
  document.getElementById('ub-paso-mapa').style.display = 'none';
  document.getElementById('ub-paso-detalles').style.display = 'block';
  document.getElementById('ub-detalle-direccion').textContent = ubSeleccionActual.direccion;
}

function volverAMapa() {
  document.getElementById('ub-paso-detalles').style.display = 'none';
  document.getElementById('ub-paso-mapa').style.display = 'block';
  setTimeout(() => mapaPicker && mapaPicker.invalidateSize(), 150);
}

function elegirTipoUbicacion(tipo, btn) {
  document.querySelectorAll('.chip-btn[data-tipo]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('ub-etiqueta-custom').style.display = tipo === 'otra' ? 'block' : 'none';
}

function resetFormularioUbicacion() {
  document.getElementById('ub-busqueda').value = '';
  document.getElementById('ub-piso').value = '';
  document.getElementById('ub-referencias').value = '';
  document.getElementById('ub-etiqueta-custom').value = '';
  document.getElementById('ub-etiqueta-custom').style.display = 'none';
  document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.chip-btn[data-tipo="residencia"]').classList.add('active');
  document.getElementById('ub-paso-detalles').style.display = 'none';
  document.getElementById('ub-paso-mapa').style.display = 'none';
  document.getElementById('ub-paso-buscar').style.display = 'block';
  ubSeleccionActual = null;
  ubEditandoId = null;
  document.getElementById('ub-btn-guardar').textContent = 'Guardar dirección';
}

async function guardarUbicacionFinal() {
  if (!ubSeleccionActual && !ubEditandoId) return showInfo('⚠️', 'Faltan datos', 'Elegí una dirección primero.');
  const tipoBtn = document.querySelector('.chip-btn[data-tipo].active');
  const tipo = tipoBtn ? tipoBtn.dataset.tipo : 'residencia';
  const nombres = { residencia: 'Casa', trabajo: 'Trabajo' };
  const etiqueta = tipo === 'otra' ? document.getElementById('ub-etiqueta-custom').value.trim() : nombres[tipo];
  if (tipo === 'otra' && !etiqueta) return showInfo('⚠️', 'Faltan datos', 'Contanos qué ubicación es (ej: Casa de mi mamá).');
  const piso_depto = document.getElementById('ub-piso').value.trim();
  const referencias = document.getElementById('ub-referencias').value.trim();

  const body = { etiqueta, tipo, piso_depto, referencias };
  let r;
  if (ubEditandoId) {
    r = await api(`/api/ubicaciones/${ubEditandoId}`, 'PATCH', body);
  } else {
    r = await api('/api/ubicaciones', 'POST', { ...body, direccion: ubSeleccionActual.direccion, lat: ubSeleccionActual.lat, lng: ubSeleccionActual.lng });
  }
  if (r.error) return showInfo('❌', 'Error', r.error);
  resetFormularioUbicacion();
  showInfo('✅', ubEditandoId ? 'Ubicación actualizada' : 'Ubicación agregada', 'Ya la podés usar al publicar un trabajo.');
  cargarUbicaciones();
}

function editarUbicacion(id) {
  const u = misUbicaciones.find(x => x.id === id);
  if (!u) return;
  ubEditandoId = id;
  ubSeleccionActual = { direccion: u.direccion, lat: u.lat, lng: u.lng };
  document.getElementById('ub-paso-buscar').style.display = 'none';
  document.getElementById('ub-paso-mapa').style.display = 'none';
  document.getElementById('ub-paso-detalles').style.display = 'block';
  document.getElementById('ub-detalle-direccion').textContent = u.direccion;
  document.getElementById('ub-piso').value = u.piso_depto || '';
  document.getElementById('ub-referencias').value = u.referencias || '';
  document.querySelectorAll('.chip-btn[data-tipo]').forEach(b => b.classList.remove('active'));
  const tipoValido = ['residencia','trabajo','otra'].includes(u.tipo) ? u.tipo : 'otra';
  document.querySelector(`.chip-btn[data-tipo="${tipoValido}"]`).classList.add('active');
  document.getElementById('ub-etiqueta-custom').style.display = tipoValido === 'otra' ? 'block' : 'none';
  document.getElementById('ub-etiqueta-custom').value = tipoValido === 'otra' ? u.etiqueta : '';
  document.getElementById('ub-btn-guardar').textContent = 'Guardar cambios';
  document.getElementById('page-mi-perfil').scrollIntoView({ behavior: 'smooth' });
}

async function marcarPredeterminada(id) {
  const r = await api(`/api/ubicaciones/${id}/predeterminada`, 'PATCH');
  if (r.error) return showInfo('❌', 'Error', r.error);
  cargarUbicaciones();
}

async function eliminarUbicacion(id) {
  showConfirm('🗑️', '¿Eliminar ubicación?', 'No vas a poder usarla más al publicar trabajos.', async () => {
    const r = await api(`/api/ubicaciones/${id}`, 'DELETE');
    if (r.error) return showInfo('❌', 'Error', r.error);
    cargarUbicaciones();
  }, 'Sí, eliminar');
}

async function guardarPerfil() {
  const body = {
    nombre: document.getElementById('perfil-nombre').value.trim(),
    telefono: document.getElementById('perfil-telefono').value.trim()
  };
  if (!body.nombre) return showInfo('⚠️', 'Falta el nombre', 'El nombre no puede quedar vacío.');
  const r = await api('/api/usuarios/' + usuario.id, 'PATCH', body);
  if (r.error) return showInfo('❌', 'Error', r.error);
  usuario = { ...usuario, ...body };
  localStorage.setItem('chamba_user', JSON.stringify(usuario));
  document.getElementById('sidebar-user').textContent = usuario.nombre;
  document.getElementById('user-avatar').textContent = iniciales(usuario.nombre);
  document.getElementById('bienvenida').textContent = 'Hola, ' + usuario.nombre.split(' ')[0] + ' 👋';
  showInfo('✅', 'Guardado', 'Tu perfil fue actualizado.');
}

function goTo(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (btn) btn.classList.add('active');
  if (page === 'nuevo-pedido') document.getElementById('nav-mis-trabajos').classList.add('active');
  document.querySelectorAll('.nav-dropdown-menu').forEach(m => m.classList.remove('open'));
  if (page === 'foro') cargarForo();
}

function goSubTab(tab) {
  document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.subpage').forEach(p => p.classList.remove('active'));
  document.querySelector(`.subtab[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('sub-' + tab).classList.add('active');
  const badgeMap = { esperando: 'badge-esperando', negociacion: 'badge-negociacion', proceso: 'badge-proceso' };
  if (badgeMap[tab]) document.getElementById(badgeMap[tab]).style.display = 'none';
}

function irATrabajos(tab) {
  goTo('mis-trabajos', document.getElementById('nav-mis-trabajos'));
  goSubTab(tab);
}

function toggleDropdown(id) {
  document.querySelectorAll('.nav-dropdown-menu').forEach(m => { if (m.id !== id) m.classList.remove('open'); });
  document.getElementById(id).classList.toggle('open');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-dropdown')) document.querySelectorAll('.nav-dropdown-menu').forEach(m => m.classList.remove('open'));
  if (!e.target.closest('#ub-paso-buscar')) { const s = document.getElementById('ub-sugerencias'); if (s) s.classList.remove('open'); }
});

async function api(path, method='GET', body=null) { return Chamba.api(BACKEND,path,method,body); }

function fmt(n) { return '$' + Number(n||0).toLocaleString('es-AR'); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-AR') : '—'; }
function starsHtml(n) { return n ? '⭐'.repeat(Math.min(5, Math.round(n))) + ' ' + n : 'Sin calificaciones'; }

async function cargarTodo() {
 try {
  await cargarDisputas();await cargarRelacionesSocio();
  const [todos,ofertas]=await Promise.all([api('/api/pedidos'),api('/api/ofertas')]);
  const nextPedidos=Array.isArray(todos)?todos.filter(p=>p.usuario_id===usuario.id):[];
  const nextOfertas={};for(const o of ofertas)(nextOfertas[o.pedido_id]??=[]).push(o);
  misPedidos=nextPedidos;todasOfertas=nextOfertas;
 }catch(e){Chamba.notice(e.message);return;}
 renderTodo();
}

function renderTodo() {
  const esperando = misPedidos.filter(p => p.estado === 'nuevo' && (!todasOfertas[p.id] || !todasOfertas[p.id].filter(o => o.estado !== 'rechazada').length));
  const negociacion = misPedidos.filter(p => p.estado === 'nuevo' && todasOfertas[p.id] && todasOfertas[p.id].filter(o => o.estado !== 'rechazada').length > 0);
  const proceso = misPedidos.filter(p => p.estado === 'en_proceso');
  const completados = misPedidos.filter(p => p.estado === 'completado');
  const cancelados = misPedidos.filter(p => p.estado === 'cancelado');

  document.getElementById('stat-esperando').textContent = esperando.length;
  document.getElementById('stat-negociacion').textContent = negociacion.length;
  document.getElementById('stat-proceso').textContent = proceso.length;
  document.getElementById('stat-completados').textContent = completados.length;

  // Badges solo si hay novedades y el usuario NO está en esa sección
  badgeSubtab('badge-esperando', esperando.length, 'sub-esperando');
  badgeSubtab('badge-negociacion', negociacion.length, 'sub-negociacion');
  badgeSubtab('badge-proceso', proceso.length, 'sub-proceso');
  const totalTrabajos = negociacion.length; // solo lo que realmente requiere tu atención (nuevas ofertas)
  const badgeTotal = document.getElementById('badge-trabajos-total');
  badgeTotal.textContent = totalTrabajos;
  badgeTotal.style.display = totalTrabajos > 0 ? 'inline-flex' : 'none';

  document.getElementById('lista-esperando').innerHTML = Chamba.html([...esperando, ...cancelados].map(p => renderCardEsperando(p)).join('') || '<div class="empty">No tenés trabajos esperando ofertas.</div>');
  document.getElementById('lista-negociacion').innerHTML = Chamba.html(negociacion.map(p => renderCardNegociacion(p)).join('') || '<div class="empty">No tenés trabajos en negociación.</div>');
  // Preservar mensajes de chat sin enviar antes de redibujar (el auto-refresh no debe borrarlos)
  const chatsEnCurso = {};
  document.querySelectorAll('[id^="chat-in-"]').forEach(inp => { if (inp.value) chatsEnCurso[inp.id] = inp.value; });
  document.getElementById('lista-proceso').innerHTML = Chamba.html(proceso.map(p => renderCardProceso(p)).join('') || '<div class="empty">No tenés trabajos en proceso.</div>');
  Object.entries(chatsEnCurso).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });
  document.getElementById('lista-completados').innerHTML = Chamba.html(completados.map(p => renderCardCompletado(p)).join('') || '<div class="empty">No tenés trabajos completados aún.</div>');

  proceso.forEach(p => cargarMensajes(p.id));
  renderActividadReciente();
}

function renderActividadReciente() {
  const box = document.getElementById('actividad-reciente');
  if (!misPedidos.length) {
    box.innerHTML = Chamba.html(`<div style="text-align:center;padding:20px 10px"><div style="font-size:14px;color:var(--text-mid);margin-bottom:12px">Todavía no publicaste ningún trabajo.</div><button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){goTo('nuevo-pedido')})}>➕ Publicar mi primer trabajo</button></div>`);
    return;
  }
  const eventos = misPedidos.map(p => {
    const ofertasPedido = (todasOfertas[p.id] || []).filter(o => o.estado !== 'rechazada');
    if (p.estado === 'cancelado') return { icon: '🗑️', texto: `Cancelaste la solicitud de <strong>${Chamba.escape(p.servicio)}</strong>`, fecha: p.created_at };
    if (p.estado === 'completado') return { icon: '✅', texto: `Completaste el trabajo de <strong>${Chamba.escape(p.servicio)}</strong>${Chamba.escape(p.calificado ? '' : ' — todavía no lo calificaste')}`, fecha: p.created_at };
    if (p.estado === 'en_proceso') return { icon: '⚙️', texto: `<strong>${Chamba.escape(p.servicio)}</strong> está en proceso — pagaste ${Chamba.escape(fmt(p.precio_cliente))}`, fecha: p.created_at };
    if (ofertasPedido.length) return { icon: '💬', texto: `Recibiste ${Chamba.escape(ofertasPedido.length)} oferta${Chamba.escape(ofertasPedido.length!==1?'s':'')} para <strong>${Chamba.escape(p.servicio)}</strong>`, fecha: p.created_at };
    return { icon: '🔍', texto: `Publicaste un trabajo de <strong>${Chamba.escape(p.servicio)}</strong>`, fecha: p.created_at };
  }).sort((a,b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 6);

  box.innerHTML = Chamba.html(eventos.map(e => `<div class="actividad-item">
    <div class="actividad-icon">${Chamba.escape(e.icon)}</div>
    <div><div class="actividad-texto">${e.texto}</div><div class="actividad-fecha">${Chamba.escape(fmtDate(e.fecha))}</div></div>
  </div>`).join(''));
}

function setBadge(id, count, pageId) {
  const el = document.getElementById(id);
  const pageActiva = document.getElementById(pageId)?.classList.contains('active');
  el.textContent = count;
  el.style.display = (count > 0 && !pageActiva) ? 'inline' : 'none';
}

function badgeSubtab(id, count, subId) {
  const el = document.getElementById(id);
  const viendola = document.getElementById('page-mis-trabajos')?.classList.contains('active')
    && document.getElementById(subId)?.classList.contains('active');
  el.textContent = count;
  el.style.display = (count > 0 && !viendola) ? 'inline' : 'none';
}

function renderCardEsperando(p) {
  const cancelado = p.estado === 'cancelado';
  return `<div class="trabajo-card" style="position:relative">
    ${cancelado ? `<div class="wasted-overlay"><div class="wasted-text">CANCELADO</div><button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){eliminarPedido(`${p.id}`)})}>Eliminar</button></div>` : ''}
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(p.servicio)}</div><span class="badge badge-gray">Esperando ofertas</span></div>
    <div class="trabajo-desc">${Chamba.escape(p.descripcion||'')}</div>
    ${p.precio_sugerido_ia ? `<div class="trabajo-ia">🤖 Precio sugerido: <strong>${Chamba.escape(fmt(p.precio_sugerido_ia))}</strong></div>` : ''}
    <div class="trabajo-footer">
      <span style="font-size:12px;color:var(--text-soft)">📅 ${Chamba.escape(fmtDate(p.created_at))}</span>
      ${!cancelado ? `<button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){cancelarPedido(`${p.id}`)})}>Eliminar solicitud</button>` : ''}
    </div>
  </div>`;
}

function renderCardNegociacion(p) {
  const ofertas = (todasOfertas[p.id] || []).filter(o => o.estado !== 'rechazada');
  const sorted = [...ofertas].sort((a,b) => (b.rep_promedio||0) - (a.rep_promedio||0) || a.precio_ofertado - b.precio_ofertado);
  return `<div class="trabajo-card con-ofertas">
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(p.servicio)}</div><span class="badge badge-amber">${Chamba.escape(ofertas.length)} oferta${Chamba.escape(ofertas.length!==1?'s':'')}</span></div>
    ${p.socio_preferido_id ? '<div style="font-size:12px;color:var(--teal-dark);font-weight:500;margin-bottom:4px">⭐ Trabajo dirigido a tu favorito</div>' : ''}
    <div class="trabajo-desc">${Chamba.escape(p.descripcion||'')}</div>
    ${p.precio_sugerido_ia ? `<div class="trabajo-ia">🤖 Precio sugerido: <strong>${Chamba.escape(fmt(p.precio_sugerido_ia))}</strong></div>` : ''}
    <div style="font-size:12px;color:var(--text-soft);margin-top:6px">💡 Tené en cuenta que el precio incluye mano de obra, insumos y traslados si correspondiera.</div>
    <div style="margin-top:12px">
      ${sorted.map((o,i) => `
        <div class="oferta-card ${Chamba.escape(i===0?'mejor':'')}">
          ${i===0 ? '<div style="font-size:11px;font-weight:600;color:var(--teal);margin-bottom:6px">⭐ MEJOR OFERTA</div>' : ''}
          <div class="oferta-header">
            <div><div class="oferta-socio">${Chamba.escape(o.socio_nombre)}</div><div class="oferta-rep">${starsHtml(o.rep_promedio)} · ${Chamba.escape(o.trabajos_completados||0)} trabajos</div></div>
            <div class="oferta-precio">${Chamba.escape(fmt(o.precio_ofertado))}</div>
          </div>
          ${o.ultima_oferta_de==='cliente' ? `<div style="font-size:12px;color:var(--amber);font-weight:500;margin-top:4px">⏳ Esperando respuesta del socio a tu contraoferta</div>` : ''}
          ${o.ultima_oferta_de!=='cliente' ? `<div class="oferta-btns">
            <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){aceptarOferta(`${o.id}`,`${p.id}`,(o.precio_ofertado))})}>✅ Aceptar ${Chamba.escape(fmt(o.precio_ofertado))}</button>
            <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){toggleNeg(`neg-${o.id}`)})}>💬 Contraofertrar</button>
            <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){buscarOtroSocio(`${p.id}`)})}>🔄 Buscar otro socio</button>
          </div>
          <div id="neg-${Chamba.escape(o.id)}" style="display:none" class="neg-box">
            <div style="font-size:13px;font-weight:600;color:var(--amber);margin-bottom:8px">Tu contraoferta (solo precio)</div>
            <div class="neg-precio-input">
              <input type="number" id="neg-val-${Chamba.escape(o.id)}" placeholder="Tu precio máximo..."/>
              <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){enviarContraoferta(`${o.id}`)})}>Enviar</button>
            </div>
          </div>` : ''}
        </div>`).join('')}
    </div>
    <div class="trabajo-footer">
      <span style="font-size:12px;color:var(--text-soft)">📅 ${Chamba.escape(fmtDate(p.created_at))}</span>
      <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){cancelarPedido(`${p.id}`)})}>Eliminar solicitud</button>
    </div>
  </div>`;
}

function renderCardProceso(p) {
  return `<div class="trabajo-card en-proceso">
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(p.servicio)}</div><span class="badge badge-amber">⚙️ En proceso</span></div>
    <div class="trabajo-desc">${Chamba.escape(p.descripcion||'')}</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
      <div><div style="font-size:12px;color:var(--teal-dark)">Precio acordado</div><div style="font-size:20px;font-weight:700;color:var(--teal-dark)">${Chamba.escape(fmt(p.precio_cliente))}</div></div>
      <div><div style="font-size:12px;color:var(--teal-dark)">Comisión ChamBA</div><div style="font-size:14px;font-weight:600;color:var(--teal-dark)">${Chamba.escape(fmt(p.comision))}</div></div>
    </div>
    ${p.codigo_verificacion && !p.codigo_usado ? `
      <div class="codigo-box">
        <div style="font-size:13px;font-weight:600;color:var(--teal-dark);margin-bottom:6px">🔐 Tu código de verificación</div>
        <div class="codigo-num">${Chamba.escape(p.codigo_verificacion)}</div>
      </div>
      <div class="codigo-advertencia">⚠️ <strong>Importante:</strong> Entregá este código al socio únicamente cuando haya <strong>terminado el trabajo</strong>. El código desbloquea su pago.</div>` : ''}
    ${p.codigo_usado ? '<div style="background:var(--teal);color:#fff;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:500;margin:10px 0">✅ Código verificado — el socio cobró su pago</div>' : ''}
    <div style="margin-top:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">💬 Chat con el socio</div>
      <div class="chat-box">
        <div class="chat-messages" id="chat-${Chamba.escape(p.id)}"><div style="text-align:center;color:var(--text-soft);font-size:13px;padding:14px">Cargando...</div></div>
        <div class="chat-input-row">
          <input class="chat-input" id="chat-in-${Chamba.escape(p.id)}" placeholder="Coordiná día, hora y lugar..." ${Chamba.bind("keydown",function(event){if(event.key==='Enter')enviarMsg(`${p.id}`)})}/>
          <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){enviarMsg(`${p.id}`)})}>Enviar</button>
        </div>
      </div>
    </div>
    ${renderBloqueDisputa(p.id)}
  </div>`;
}

function renderCardCompletado(p) {
  return `<div class="trabajo-card">
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(p.servicio)}</div><span class="badge badge-green">✅ Completado</span></div>
    <div class="trabajo-desc">${Chamba.escape(p.descripcion||'')}</div>
    <div style="font-size:14px;color:var(--teal-dark);font-weight:500;margin-bottom:10px">Precio final: ${Chamba.escape(fmt(p.precio_cliente))} · ${Chamba.escape(fmtDate(p.created_at))}</div>
    ${p.calificado ? `<div style="background:#fafafa;border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--text-soft);font-size:14px">✅ Ya calificaste a este socio. ¡Gracias!${renderRelacionSocio(p.profesional_id)}</div>` : p.profesional_id ? `<div style="background:#fafafa;border:1px solid var(--border);border-radius:10px;padding:14px">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">⭐ Calificá al socio</div>
      <div class="stars-input" id="stars-${Chamba.escape(p.id)}">${[1,2,3,4,5].map(n=>`<button class="star-btn" ${Chamba.bind("click",function(event){selStar(`${p.id}`,(n))})}>⭐</button>`).join('')}</div>
      <div style="margin-top:10px" id="tags-${Chamba.escape(p.id)}">${TAGS_CALIFICACION.map(tag=>`<button class="tag-chip" ${Chamba.bind("click",function(event){toggleTag(`${p.id}`,`${tag}`)})}>${Chamba.escape(tag)}</button>`).join('')}</div>
      <button class="btn btn-teal btn-sm" style="margin-top:10px" ${Chamba.bind("click",function(event){calificar(`${p.id}`,`${p.profesional_id}`)})}>Enviar calificación</button>
    </div>` : ''}
    ${renderBloqueDisputa(p.id)}
  </div>`;
}

function toggleNeg(id) { const el=document.getElementById(id); el.style.display=el.style.display==='none'?'block':'none'; }

// ── FAVORITOS / BLOQUEO DE SOCIOS ──
async function cargarRelacionesSocio() {
  try { misRelacionesSocio = await api('/api/relaciones-socio'); if (!Array.isArray(misRelacionesSocio)) misRelacionesSocio = []; } catch(e) { misRelacionesSocio = []; }
  renderListaRelacionesSocio();
}

function renderListaRelacionesSocio() {
  const box = document.getElementById('lista-relaciones-socio');
  if (!box) return;
  if (!misRelacionesSocio.length) { box.innerHTML = Chamba.html('<div style="font-size:13px;color:var(--text-soft)">Todavía no marcaste ningún socio como favorito o bloqueado.</div>'); return; }
  box.innerHTML = Chamba.html(misRelacionesSocio.map(r => `
    <div class="ubicacion-item">
      <div class="ubicacion-info">
        <div class="etiqueta">${Chamba.escape(r.socio ? r.socio.nombre : 'Socio')} ${r.tipo === 'favorito' ? '<span class="badge badge-green" style="margin-left:6px">Favorito</span>' : '<span class="badge badge-red" style="margin-left:6px">Bloqueado</span>'}</div>
        <div class="direccion">${Chamba.escape(r.socio?.especialidad || '')}</div>
      </div>
      <div class="ubicacion-acciones">
        <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){quitarRelacionSocio(`${r.socio_id}`)})}>Quitar</button>
      </div>
    </div>`).join(''));
}

function renderRelacionSocio(socioId) {
  const rel = misRelacionesSocio.find(r => r.socio_id === socioId);
  if (rel && rel.tipo === 'favorito') {
    return `<div style="margin-top:8px">⭐ Es uno de tus favoritos — <a href="#" ${Chamba.bind("click",function(event){quitarRelacionSocio(`${socioId}`);return false})} style="color:var(--text-soft)">quitar</a></div>`;
  }
  if (rel && rel.tipo === 'bloqueado') {
    return `<div style="margin-top:8px">🚫 Bloqueaste a este socio — <a href="#" ${Chamba.bind("click",function(event){quitarRelacionSocio(`${socioId}`);return false})} style="color:var(--text-soft)">desbloquear</a></div>`;
  }
  return `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){marcarRelacionSocio(`${socioId}`,'favorito')})}>☆ Agregar a favoritos</button>
    <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){marcarRelacionSocio(`${socioId}`,'bloqueado')})}>🚫 Bloquear socio</button>
  </div>`;
}

async function marcarRelacionSocio(socioId, tipo) {
  const r = await api('/api/relaciones-socio', 'POST', { socio_id: socioId, tipo });
  if (r.error) return showInfo('❌', 'Error', r.error);
  await cargarRelacionesSocio();
  await cargarTodo();
  showInfo(tipo === 'favorito' ? '⭐' : '🚫', tipo === 'favorito' ? 'Agregado a favoritos' : 'Socio bloqueado',
    tipo === 'favorito' ? 'Vas a poder elegirlo directamente la próxima vez que pidas un servicio.' : 'Este socio no va a poder ver tus próximos trabajos. No se le va a avisar.');
}

async function quitarRelacionSocio(socioId) {
  const r = await api(`/api/relaciones-socio/${socioId}`, 'DELETE');
  if (r.error) return showInfo('❌', 'Error', r.error);
  await cargarRelacionesSocio();
  await cargarTodo();
}

function onCambioDestinatario() {
  const tipo = document.getElementById('p-destinatario').value;
  const sel = document.getElementById('p-favorito');
  sel.style.display = tipo === 'favorito' ? 'block' : 'none';
  if (tipo === 'favorito') poblarFavoritosParaServicio();
}

function onCambioServicioPublicar() {
  if (document.getElementById('p-destinatario').value === 'favorito') poblarFavoritosParaServicio();
}

function poblarFavoritosParaServicio() {
  const servicio = document.getElementById('p-servicio').value;
  const sel = document.getElementById('p-favorito');
  const favoritos = misRelacionesSocio.filter(r => r.tipo === 'favorito' && r.socio && (!servicio || (r.socio.especialidad || '').split(',').map(s => s.trim()).includes(servicio)));
  sel.innerHTML = Chamba.html(favoritos.length
    ? '<option value="">Elegí un favorito...</option>' + favoritos.map(f => `<option value="${Chamba.escape(f.socio_id)}">${Chamba.escape(f.socio.nombre)}${Chamba.escape(f.socio.promedio_estrellas ? ' — ⭐' + f.socio.promedio_estrellas : '')}</option>`).join('')
    : '<option value="">No tenés favoritos para este servicio</option>');
}

// ── DISPUTAS (reportar un problema) ──
async function cargarDisputas() {
  try { misDisputas = await api('/api/disputas'); if (!Array.isArray(misDisputas)) misDisputas = []; } catch(e) { misDisputas = []; }
}

function renderBloqueDisputa(pedidoId) {
  const existente = misDisputas.find(d => d.pedido_id === pedidoId);
  const badge = { abierta: 'badge-amber|⏳ Reportado, en espera', en_revision: 'badge-amber|🔎 En revisión', resuelta: 'badge-green|✅ Resuelto' };
  if (existente) {
    const [cls, label] = (badge[existente.estado] || 'badge-gray|' + existente.estado).split('|');
    return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
      <span class="badge ${Chamba.escape(cls)}">${Chamba.escape(label)}</span>
      <div style="font-size:12px;color:var(--text-soft);margin-top:4px">Reportaste: ${Chamba.escape(existente.motivo)}${existente.resolucion ? '<br>Respuesta de ChamBA: ' + existente.resolucion : ''}</div>
    </div>`;
  }
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
    <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){toggleDisputaForm(`${pedidoId}`)})}>⚠️ Reportar un problema</button>
    <div id="disputa-form-${Chamba.escape(pedidoId)}" style="display:none;margin-top:10px">
      <div class="form-group"><label>¿Qué pasó?</label>
        <select id="disputa-motivo-${Chamba.escape(pedidoId)}">
          <option value="">Elegí un motivo</option>
          <option>El socio no se presentó</option>
          <option>El trabajo quedó mal hecho</option>
          <option>No coincide con lo acordado</option>
          <option>Problema con el pago</option>
          <option>Otro</option>
        </select>
      </div>
      <div class="form-group"><label>Contanos más</label><textarea id="disputa-desc-${Chamba.escape(pedidoId)}" rows="3" placeholder="Describí qué pasó con el mayor detalle posible..."></textarea></div>
      <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){enviarDisputa(`${pedidoId}`)})}>Enviar reporte</button>
    </div>
  </div>`;
}

function toggleDisputaForm(pedidoId) {
  const el = document.getElementById('disputa-form-' + pedidoId);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function enviarDisputa(pedidoId) {
  const motivo = document.getElementById('disputa-motivo-' + pedidoId).value;
  const descripcion = document.getElementById('disputa-desc-' + pedidoId).value.trim();
  if (!motivo || !descripcion) return showInfo('⚠️', 'Faltan datos', 'Elegí un motivo y contanos qué pasó.');
  const r = await api('/api/disputas', 'POST', { pedido_id: pedidoId, motivo, descripcion });
  if (r.error) return showInfo('❌', 'Error', r.error);
  showInfo('✅', 'Reporte enviado', 'Nuestro equipo lo va a revisar y te va a contactar.');
  await cargarDisputas();
  await cargarTodo();
}

async function aceptarOferta(ofertaId, pedidoId, precio) {
  showConfirm('💰', '¿Confirmás el pago?',
    `Vas a pagar ${fmt(precio)}. El dinero queda retenido en ChamBA hasta que el socio complete el trabajo y vos le entregues el código de verificación.\n\n(Los pagos reales se habilitarán próximamente)`,
    async () => {
      console.log('[DEBUG] Aceptando oferta:', ofertaId, 'pedido:', pedidoId);
      const r = await api('/api/ofertas/' + ofertaId + '/aceptar', 'POST', { cliente_id: usuario.id });
      console.log('[DEBUG] Respuesta de aceptar:', r);
      if (r.error) return showInfo('❌', 'Error', r.error);
      await cargarTodo();
      console.log('[DEBUG] misPedidos despues de recargar:', misPedidos);
      irATrabajos('proceso');
    }, '✅ Confirmar pago');
}

async function enviarContraoferta(ofertaId) {
  const precio = parseFloat(document.getElementById('neg-val-' + ofertaId).value);
  if (!Number.isFinite(precio) || precio <= 1000) return showInfo('⚠️', 'Precio inválido', 'Ingresá un precio válido.');
  await api('/api/ofertas/' + ofertaId + '/contraoferta', 'POST', { nuevo_precio: precio, rol: 'cliente' });
  document.getElementById('neg-' + ofertaId).style.display = 'none';
  showInfo('✅', 'Contraoferta enviada', 'El socio verá tu propuesta y podrá aceptarla o responder con otro precio.');
  await cargarTodo();
}

async function buscarOtroSocio(pedidoId) {
  showConfirm('🔄', '¿Buscar otro socio?', 'Se cancelarán todas las ofertas actuales y el trabajo volverá a estar disponible para otros socios.',
    async () => { await api('/api/pedidos/' + pedidoId + '/buscar-otro-socio', 'POST'); await cargarTodo(); });
}

async function cancelarPedido(pedidoId) {
  showConfirm('🗑️', '¿Eliminar solicitud?', 'Los socios que ofertaron verán que el trabajo fue cancelado.',
    async () => { await api('/api/pedidos/' + pedidoId, 'PATCH', { estado: 'cancelado' }); await cargarTodo(); }, 'Sí, eliminar');
}

async function eliminarPedido(pedidoId) {
  showConfirm('🗑️', '¿Eliminar de tu vista?', 'El trabajo cancelado desaparecerá de tu lista.',
    async () => { await api('/api/pedidos/' + pedidoId, 'DELETE'); await cargarTodo(); }, 'Sí, eliminar');
}

async function cargarMensajes(pedidoId) {
  try { await Chamba.chat(pedidoId,api,usuario,'cliente'); }
  catch(e) { Chamba.notice('No se pudo actualizar el chat. Tus mensajes se conservan.'); }
}

async function enviarMsg(pedidoId) {
  const input = document.getElementById('chat-in-' + pedidoId);
  const contenido = input.value.trim(); if (!contenido) return;
  const r = await api('/api/mensajes', 'POST', { pedido_id: pedidoId, autor: usuario.nombre, rol: 'cliente', contenido,client_message_id:Chamba.messageId(pedidoId,contenido) });
  if (r.error) { showInfo('❌', 'Error', r.error); return; }
  if(input.value.trim()===contenido){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}
  Chamba.messageDone(pedidoId);
  await cargarMensajes(pedidoId);
}

function selStar(pedidoId, n) {
  estrellasPorPedido[pedidoId] = n;
  document.querySelectorAll(`#stars-${pedidoId} .star-btn`).forEach((btn,i) => btn.classList.toggle('activa', i<n));
}

function toggleTag(pedidoId, tag) {
  if (!tagsPorPedido[pedidoId]) tagsPorPedido[pedidoId] = [];
  const arr = tagsPorPedido[pedidoId];
  const i = arr.indexOf(tag);
  if (i === -1) arr.push(tag); else arr.splice(i, 1);
  document.querySelectorAll(`#tags-${pedidoId} .tag-chip`).forEach(btn => btn.classList.toggle('activa', arr.includes(btn.textContent)));
}

async function calificar(pedidoId, socioId) {
  const estrellas = estrellasPorPedido[pedidoId];
  if (!estrellas) return showInfo('⚠️', 'Falta calificación', 'Elegí entre 1 y 5 estrellas.');
  const comentario = (tagsPorPedido[pedidoId] || []).join(', ');
  const r = await api('/api/calificaciones', 'POST', { pedido_id: pedidoId, socio_id: socioId, cliente_id: usuario.id, estrellas, comentario });
  if (r.error) return showInfo('❌', 'Error', r.error);
  delete estrellasPorPedido[pedidoId];
  delete tagsPorPedido[pedidoId];
  showInfo('⭐', '¡Gracias!', 'Tu calificación fue enviada.');
  await cargarTodo();
}

async function consultarIA() {
  const servicio = document.getElementById('p-servicio').value;
  const desc = document.getElementById('p-desc').value.trim();
  if (!servicio || !desc) return showInfo('⚠️', 'Falta información', 'Completá el servicio y la descripción primero.');
  const box = document.getElementById('ia-sugerencia');
  box.style.display = 'block'; box.innerHTML = Chamba.html('🤖 Consultando a la IA...');
  try {
    const r = await api('/api/analizar', 'POST', { servicio, descripcion: desc, fotos:(await Chamba.draftPhotos()).map(url=>url.split(',')[1]) });
    if (r.error || r.precio_cliente == null) { box.innerHTML = Chamba.html('⚠️ No pudimos consultar la IA en este momento. Probá de nuevo en un momento.'); return; }
    iaSugerencia = r;
    box.innerHTML = Chamba.html(renderTarjetaIA(r));
    if (r.urgencia) {
      const chip = document.querySelector(`.chip-btn[data-urgencia="${r.urgencia}"]`);
      if (chip) elegirUrgencia(r.urgencia, chip);
    }
  } catch(e) { box.innerHTML = Chamba.html('⚠️ No pudimos consultar la IA en este momento. Probá de nuevo en un momento.'); }
}

function elegirUrgencia(valor, btn) {
  document.querySelectorAll('.chip-btn[data-urgencia]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function renderTarjetaIA(r) {
  const urgenciaColor = { Alta: 'var(--red)', Media: 'var(--amber)', Baja: 'var(--teal-dark)' };
  const urgenciaBg = { Alta: 'var(--red-light)', Media: 'var(--amber-light)', Baja: 'var(--teal-light)' };
  const color = urgenciaColor[r.urgencia] || 'var(--teal-dark)';
  const bg = urgenciaBg[r.urgencia] || 'var(--teal-light)';
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:12px">
      <div style="background:${Chamba.escape(bg)};border-radius:8px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:${Chamba.escape(color)}">Urgencia</div>
        <div style="font-size:14px;font-weight:600;margin-top:2px">${Chamba.escape(r.urgencia||'—')}</div>
      </div>
      <div style="background:var(--teal-light);border-radius:8px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--teal-dark)">Costo estimado</div>
        <div style="font-size:14px;font-weight:600;margin-top:2px">${Chamba.escape(fmt(r.precio_min))} – ${Chamba.escape(fmt(r.precio_max))}</div>
      </div>
    </div>
    ${r.diagnostico ? `<div style="font-size:13px;margin-bottom:8px"><strong>Diagnóstico:</strong> ${Chamba.escape(r.diagnostico)}</div>` : ''}
    ${r.recomendacion ? `<div style="font-size:13px;margin-bottom:10px"><strong>💡 Consejo:</strong> ${Chamba.escape(r.recomendacion)}</div>` : ''}
    <div style="font-size:12px;color:var(--text-soft);border-top:1px solid var(--border);padding-top:8px">
      Precio sugerido para publicar: <strong style="color:var(--teal-dark)">${Chamba.escape(fmt(r.precio_cliente))}</strong> · El socio recibiría ${Chamba.escape(fmt(r.precio_socio))} · ChamBA cobra ${Chamba.escape(fmt(r.comision_chamba))} (13%, mínimo $1.000)
    </div>`;
}

async function publicarTrabajo() {
  const servicio = document.getElementById('p-servicio').value;
  const descripcion = document.getElementById('p-desc').value.trim();
  const ubicacion_id = document.getElementById('p-ubicacion').value;
  document.getElementById('pedido-ok').style.display = 'none';
  document.getElementById('pedido-err').style.display = 'none';
  if (!servicio || !descripcion) { const e=document.getElementById('pedido-err'); e.textContent='Completá todos los campos.'; e.style.display='block'; return; }
  if (!ubicacion_id) { const e=document.getElementById('pedido-err'); e.textContent='Elegí dónde es el trabajo.'; e.style.display='block'; return; }
  const destinatario = document.getElementById('p-destinatario').value;
  const socio_preferido_id = destinatario === 'favorito' ? document.getElementById('p-favorito').value : '';
  if (destinatario === 'favorito' && !socio_preferido_id) { const e=document.getElementById('pedido-err'); e.textContent='Elegí a qué favorito se lo ofrecés (o cambiá a "Cualquier socio disponible").'; e.style.display='block'; return; }
  const ubicacion = misUbicaciones.find(u => u.id === ubicacion_id);
  const mensajeConfirmacion = socio_preferido_id
    ? `Estás por solicitar un trabajo de ${servicio} en la zona "${ubicacion?.etiqueta}" (${ubicacion?.direccion}), dirigido únicamente a tu favorito elegido. Nadie más lo va a ver. ¿Confirmás?`
    : `Estás por solicitar un trabajo de ${servicio} en la zona "${ubicacion?.etiqueta}" (${ubicacion?.direccion}). Los socios cercanos a esa zona van a ver tu pedido primero. ¿Confirmás?`;
  showConfirm('📍', 'Confirmá la zona del trabajo', mensajeConfirmacion,
    () => confirmarPublicarTrabajo(servicio, descripcion, ubicacion_id, socio_preferido_id), '✅ Sí, publicar');
}

async function confirmarPublicarTrabajo(servicio, descripcion, ubicacion_id, socio_preferido_id) {
  const chipUrgencia = document.querySelector('.chip-btn[data-urgencia].active');
  const urgencia = chipUrgencia ? chipUrgencia.dataset.urgencia : 'Media';
  const body = { servicio, descripcion, ubicacion_id, estado: 'nuevo', urgencia };
  if (socio_preferido_id) body.socio_preferido_id = socio_preferido_id;
  if (iaSugerencia) body.precio_sugerido_ia = iaSugerencia.precio_cliente;
  try {
    const r = await api('/api/pedidos', 'POST', body);
    if (r.error) throw new Error(r.error);
    document.getElementById('pedido-ok').style.display = 'block';
    setTimeout(() => { document.getElementById('pedido-ok').style.display = 'none'; }, 8000);
    document.getElementById('p-servicio').value = '';
    document.getElementById('p-desc').value = '';
    Chamba.clearDraft();document.getElementById('draft-photos')?.remove();
    document.getElementById('p-destinatario').value = 'cualquiera';
    onCambioDestinatario();
    document.getElementById('ia-sugerencia').style.display = 'none';
    document.querySelectorAll('.chip-btn[data-urgencia]').forEach(b => b.classList.remove('active'));
    document.querySelector('.chip-btn[data-urgencia="Media"]').classList.add('active');
    iaSugerencia = null;
    await cargarTodo();
  } catch(e) { const el=document.getElementById('pedido-err'); el.textContent=e.message||'Error al publicar.'; el.style.display='block'; }
}

// ── FORO CON RESPUESTAS ──
async function cargarForo() {
  try {
    const posts = await api('/api/foro');
    foroPosts = Array.isArray(posts) ? posts : [];
    renderForo();
  } catch(e) {}
}

function renderForo() {
  // Agrupar: posts principales (sin parent) y respuestas (con parent_id)
  const principales = foroPosts.filter(p => !p.parent_id);
  const respuestas = foroPosts.filter(p => p.parent_id);

  document.getElementById('foro-posts').innerHTML = Chamba.html(principales.length
    ? principales.map(p => {
        const resps = respuestas.filter(r => r.parent_id === p.id);
        return `<div class="foro-post">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div><span style="font-size:13px;font-weight:600">${Chamba.escape(p.autor_nombre)}</span><span class="tipo-chip tipo-${Chamba.escape(p.autor_tipo)}">${Chamba.escape(p.autor_tipo)}</span></div>
            <div style="font-size:12px;color:var(--text-soft)">${Chamba.escape(fmtDate(p.created_at))}</div>
          </div>
          <div style="font-size:15px;font-weight:600;margin-bottom:4px">${Chamba.escape(p.titulo)}</div>
          <div style="font-size:14px;color:var(--text-mid);line-height:1.6;margin-bottom:10px">${Chamba.escape(p.contenido)}</div>
          ${resps.map(r => `<div class="foro-respuesta"><div class="foro-resp-autor">${Chamba.escape(r.autor_nombre)} <span class="tipo-chip tipo-${Chamba.escape(r.autor_tipo)}">${Chamba.escape(r.autor_tipo)}</span> · ${Chamba.escape(fmtDate(r.created_at))}</div>${Chamba.escape(r.contenido)}</div>`).join('')}
          <button class="btn btn-ghost btn-sm" style="margin-top:8px" ${Chamba.bind("click",function(event){toggleRespForm(`resp-form-${p.id}`)})}>💬 Responder</button>
          <div class="foro-resp-form" id="resp-form-${Chamba.escape(p.id)}">
            <div style="display:flex;gap:8px;margin-top:6px">
              <input type="text" id="resp-input-${Chamba.escape(p.id)}" placeholder="Escribí tu respuesta..." ${Chamba.bind("keydown",function(event){if(event.key==='Enter')responder(`${p.id}`)})}/>
              <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){responder(`${p.id}`)})}>Enviar</button>
            </div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">No hay publicaciones aún. ¡Sé el primero!</div>');
}

function toggleRespForm(id) { const el=document.getElementById(id); el.style.display=el.style.display==='none'||el.style.display===''?'block':'none'; }

async function responder(parentId) {
  const input = document.getElementById('resp-input-' + parentId);
  const contenido = input.value.trim(); if (!contenido) return;
  const parent = foroPosts.find(p => p.id === parentId);
  const r = await api('/api/foro', 'POST', { autor_id: usuario.id, autor_nombre: usuario.nombre, autor_tipo: 'cliente', titulo: 'Re: ' + (parent?.titulo||''), contenido, parent_id: parentId });
  if (r.error) return showInfo('❌', 'Error', r.error);
  input.value = '';
  toggleRespForm('resp-form-' + parentId);
  await cargarForo();
}

async function publicarForo() {
  const titulo = document.getElementById('foro-titulo').value.trim();
  const contenido = document.getElementById('foro-body').value.trim();
  if (!titulo || !contenido) return;
  await api('/api/foro', 'POST', { autor_id: usuario.id, autor_nombre: usuario.nombre, autor_tipo: 'cliente', titulo, contenido });
  document.getElementById('foro-titulo').value = '';
  document.getElementById('foro-body').value = '';
  await cargarForo();
}

function recuperarBorrador(){
 try {
  const draft=JSON.parse(sessionStorage.getItem('chamba_request_draft')||'null');if(!draft)return;
  const service=document.getElementById('p-servicio'),description=document.getElementById('p-desc');
  if(!service||!description)return;
  if(draft.servicio && [...service.options].some(o=>o.value===draft.servicio))service.value=draft.servicio;
  if(typeof draft.descripcion==='string'&&!description.value)description.value=draft.descripcion;
  Chamba.showDraftPhotos(description);
  if(draft.diagnostico)iaSugerencia=draft.diagnostico;
  goTo('nuevo-pedido');
 }catch{}
}
document.addEventListener('input',e=>{
 if(!['p-desc','p-servicio'].includes(e.target.id))return;
 sessionStorage.setItem('chamba_request_draft',JSON.stringify({servicio:document.getElementById('p-servicio').value,descripcion:document.getElementById('p-desc').value}));
});
