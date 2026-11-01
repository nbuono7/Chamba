
const BACKEND = 'https://chamba-backend-vurx.onrender.com';
let usuario = null;
let pedidos = [], usuarios = [], foroPosts = [], solicitudesMatricula = [], especialidades = [], verificacionesIdentidad = [], disputas = [], ofertas = [];
let filtroDisputas = 'todos';
let filtroPedidos = 'todos', filtroSocios = 'todos', filtroSolicitudes = 'todos', filtroIdentificacion = 'todos';

window.onload = async () => {
  const u = localStorage.getItem('chamba_user');
  if (!u) return window.location.href = '/login';
  usuario = JSON.parse(u);
  if (usuario.tipo !== 'admin') return window.location.href = '/login';
  document.getElementById('sidebar-user').textContent = usuario.nombre;
  document.getElementById('user-avatar').textContent = iniciales(usuario.nombre);
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  cargarTodo();
};
function doLogout() { localStorage.removeItem('chamba_user'); localStorage.removeItem('chamba_token'); window.location.href = '/'; }

window.addEventListener('storage', (e) => {
  if (e.key === 'chamba_user' && e.newValue) {
    const nuevo = JSON.parse(e.newValue);
    if (nuevo.id !== usuario?.id) window.location.reload();
  }
});
function iniciales(nombre) { return (nombre || '').trim().split(/\s+/).slice(0,2).map(p => p[0]).join('').toUpperCase(); }

async function api(path, method='GET', body=null) { return Chamba.api(BACKEND,path,method,body); }

async function cargarTodo() {
  [pedidos, usuarios, solicitudesMatricula, especialidades, verificacionesIdentidad, disputas, ofertas] = await Promise.all([
    api('/api/pedidos'), api('/api/usuarios'), api('/api/solicitudes-matricula'), api('/api/especialidades'), api('/api/verificaciones-identidad'), api('/api/disputas'), api('/api/ofertas')
  ]);
  if (!Array.isArray(pedidos)) pedidos = [];
  if (!Array.isArray(usuarios)) usuarios = [];
  if (!Array.isArray(solicitudesMatricula)) solicitudesMatricula = [];
  if (!Array.isArray(especialidades)) especialidades = [];
  if (!Array.isArray(verificacionesIdentidad)) verificacionesIdentidad = [];
  if (!Array.isArray(disputas)) disputas = [];
  if (!Array.isArray(ofertas)) ofertas = [];
  renderDashboard(); renderPedidos(); renderClientesReg(); renderSociosReg(); renderPagos(); renderSolicitudes(); renderEspecialidades(); renderIdentificacion(); renderDisputas(); updateBadges();
}

function goTo(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.nav-dropdown-menu').forEach(m => m.classList.remove('open'));
  if (page === 'foro') cargarForo();
}

function goSubTab(group, tab) {
  document.querySelectorAll(`.subtab[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.subpage[data-group="${group}"]`).forEach(p => p.classList.remove('active'));
  document.querySelector(`.subtab[data-group="${group}"][data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`sub-${group}-${tab}`).classList.add('active');
}

function irAUsuarios(tab) { goTo('usuarios', document.getElementById('nav-usuarios')); goSubTab('users', tab); }

function toggleDropdown(id) {
  document.querySelectorAll('.nav-dropdown-menu').forEach(m => { if (m.id !== id) m.classList.remove('open'); });
  document.getElementById(id).classList.toggle('open');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.nav-dropdown')) document.querySelectorAll('.nav-dropdown-menu').forEach(m => m.classList.remove('open'));
});

function updateBadges() {
  const np = pedidos.filter(p => p.estado === 'nuevo').length;
  const nc = usuarios.filter(u => u.tipo === 'cliente').length;
  const ns = usuarios.filter(u => u.tipo === 'socio' && u.estado === 'pendiente').length;
  const nm = solicitudesMatricula.filter(s => s.estado === 'pendiente').length;
  const ni = verificacionesIdentidad.filter(v => v.estado === 'pendiente').length;
  const nd = disputas.filter(d => d.estado === 'abierta').length;
  set('badge-pedidos', np); set('badge-clientes', nc); set('badge-socios', ns); set('badge-solicitudes', nm); set('badge-identificacion', ni); set('badge-disputas', nd);
  set('badge-usuarios-total', ns + nm + ni);
}
function set(id, val) { const el=document.getElementById(id); el.textContent=val; el.style.display=val?'inline':'none'; }

function badge(e) {
  const map = { nuevo:'badge-red|Nuevo', en_proceso:'badge-amber|En proceso', completado:'badge-green|Completado', cancelado:'badge-gray|Cancelado', pendiente:'badge-amber|Pendiente', aprobado:'badge-green|Aprobado', rechazado:'badge-red|Rechazado', suspendido:'badge-gray|Suspendido', aprobada:'badge-green|Aprobada', rechazada:'badge-red|Rechazada', abierta:'badge-red|Abierta', en_revision:'badge-amber|En revisión', resuelta:'badge-green|Resuelta' };
  const [cls, label] = (map[e] || 'badge-gray|' + e).split('|');
  return `<span class="badge ${Chamba.escape(cls)}">${Chamba.escape(label)}</span>`;
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-AR') : '—'; }

function renderDashboard() {
  const clientes = usuarios.filter(u => u.tipo === 'cliente');
  const socios = usuarios.filter(u => u.tipo === 'socio');
  document.getElementById('m-pedidos').textContent = pedidos.length;
  document.getElementById('m-clientes').textContent = clientes.length;
  document.getElementById('m-socios').textContent = socios.filter(s => s.estado === 'aprobado').length;
  document.getElementById('m-pendientes').textContent = socios.filter(s => s.estado === 'pendiente').length;
  document.getElementById('dash-pedidos').innerHTML = Chamba.html(pedidos.slice(0,5).map(p => `<tr><td class="td-primary">${Chamba.escape(p.servicio||'—')}</td><td>${Chamba.escape((p.descripcion||'').slice(0,40))}...</td><td>${badge(p.estado)}</td><td>${Chamba.escape(fmtDate(p.created_at))}</td><td><button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){verPedido(`${p.id}`)})}>Ver</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No hay pedidos aún</td></tr>');
  const pending = socios.filter(s => s.estado === 'pendiente');
  document.getElementById('dash-socios-pending').innerHTML = Chamba.html(pending.length ? pending.map(s => `<tr><td class="td-primary">${Chamba.escape(s.nombre)}</td><td>${Chamba.escape(s.especialidad||'—')}</td><td>${Chamba.escape(fmtDate(s.created_at))}</td><td><button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){verUsuario(`${s.id}`)})}>Revisar</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No hay pendientes ✅</td></tr>');
}

function renderPedidos(lista) {
  const data = (lista || pedidos).filter(p => filtroPedidos === 'todos' || p.estado === filtroPedidos);
  document.getElementById('pedidos-tbody').innerHTML = Chamba.html(data.length ? data.map(p => `<tr><td style="font-size:11px;color:var(--text-soft)">${Chamba.escape(p.id.slice(0,8))}</td><td class="td-primary">${Chamba.escape(p.servicio||'—')}</td><td>${Chamba.escape((p.descripcion||'').slice(0,45))}${Chamba.escape(p.descripcion?.length>45?'...':'')}</td><td>${badge(p.estado)}</td><td>${Chamba.escape(fmtDate(p.created_at))}</td><td><button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){verPedido(`${p.id}`)})}>Ver</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No hay pedidos</td></tr>');
}
function filtrarPedidos(f, btn) { filtroPedidos=f; document.querySelectorAll('#page-pedidos .filter-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderPedidos(); }
function buscarPedidos(q) { renderPedidos(q ? pedidos.filter(p => (p.servicio||'').toLowerCase().includes(q.toLowerCase())) : null); }

function renderClientesReg(lista) {
  const data = lista || usuarios.filter(u => u.tipo === 'cliente');
  document.getElementById('clientes-reg-count').textContent = `${data.length} clientes registrados`;
  document.getElementById('clientes-reg-tbody').innerHTML = Chamba.html(data.length ? data.map(u => `<tr><td class="td-primary">${Chamba.escape(u.nombre)}</td><td>${Chamba.escape(u.email)}</td><td>${Chamba.escape(u.telefono||'—')}</td><td>${badge(u.estado)}</td><td>${Chamba.escape(fmtDate(u.created_at))}</td><td><button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){verUsuario(`${u.id}`)})}>Ver</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No hay clientes registrados aún</td></tr>');
}

function contarSociosPorRubro() {
  const aprobados = usuarios.filter(u => u.tipo === 'socio' && u.estado === 'aprobado');
  const conteo = {};
  aprobados.forEach(s => {
    (s.especialidad || '').split(',').map(r => r.trim()).filter(Boolean).forEach(rubro => {
      conteo[rubro] = (conteo[rubro] || 0) + 1;
    });
  });
  return { totalSocios: usuarios.filter(u => u.tipo === 'socio').length, totalAprobados: aprobados.length, conteo };
}

function renderResumenSocios() {
  const { totalSocios, totalAprobados, conteo } = contarSociosPorRubro();
  const rubros = Object.entries(conteo).sort((a,b) => b[1]-a[1]);
  const box = document.getElementById('socios-resumen');
  if (!box) return;
  box.innerHTML = Chamba.html(`
    <div class="metrics">
      <div class="metric teal"><div class="metric-label">Socios totales</div><div class="metric-val">${Chamba.escape(totalSocios)}</div></div>
      <div class="metric teal"><div class="metric-label">Aprobados (activos)</div><div class="metric-val">${Chamba.escape(totalAprobados)}</div></div>
    </div>
    <div class="card" style="margin-bottom:20px"><div class="card-body">
      <div style="font-size:14px;font-weight:600;margin-bottom:10px">Desglose por rubro (solo aprobados — un socio con más de una especialidad cuenta en cada una)</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
        ${rubros.length ? rubros.map(([rubro, n]) => `
          <div style="background:var(--bg);border-radius:8px;padding:10px 12px">
            <div style="font-size:12px;color:var(--text-soft)">${Chamba.escape(rubro)}</div>
            <div style="font-size:20px;font-weight:700;color:var(--teal-dark)">${Chamba.escape(n)}</div>
          </div>`).join('') : '<div style="font-size:13px;color:var(--text-soft)">Todavía no hay socios aprobados.</div>'}
      </div>
    </div></div>`);
}

function renderSociosReg(lista) {
  renderResumenSocios();
  const socios = usuarios.filter(u => u.tipo === 'socio');
  const data = (lista || socios).filter(s => filtroSocios === 'todos' || s.estado === filtroSocios);
  document.getElementById('socios-reg-tbody').innerHTML = Chamba.html(data.length ? data.map(s => `<tr><td class="td-primary">${Chamba.escape(s.nombre)}</td><td>${Chamba.escape(s.nombre_usuario ? '@'+s.nombre_usuario : '—')}</td><td>${Chamba.escape(s.especialidad||'—')}</td><td>${Chamba.escape(s.dni||'—')}</td><td>${Chamba.escape(s.promedio_estrellas ? s.promedio_estrellas+' ⭐' : '—')}</td><td>${badge(s.estado)}</td><td><button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){verUsuario(`${s.id}`)})}>Ver</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No hay socios</td></tr>');
}
function filtrarSocios(f, btn) { filtroSocios=f; document.querySelectorAll('#sub-users-socios .filter-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderSociosReg(); }

function renderSolicitudes(lista) {
  const data = (lista || solicitudesMatricula).filter(s => filtroSolicitudes === 'todos' || s.estado === filtroSolicitudes);
  document.getElementById('solicitudes-tbody').innerHTML = Chamba.html(data.length ? data.map(s => {
    const socio = usuarios.find(u => u.id === s.socio_id);
    return `<tr>
      <td class="td-primary">${Chamba.escape(socio ? socio.nombre : '—')}</td>
      <td>${Chamba.escape(s.matricula_nueva)}</td>
      <td>${Chamba.escape(s.especialidad || '—')}</td>
      <td>${Chamba.escape(fmtDate(s.created_at))}</td>
      <td>${badge(s.estado)}</td>
      <td>${s.estado === 'pendiente' ? `<button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){resolverSolicitud(`${s.id}`,'aprobada')})}>✅ Aprobar</button> <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){resolverSolicitud(`${s.id}`,'rechazada')})}>❌ Rechazar</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No hay solicitudes</td></tr>');
}
function filtrarSolicitudes(f, btn) { filtroSolicitudes=f; document.querySelectorAll('#sub-users-solicitudes .filter-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderSolicitudes(); }
async function resolverSolicitud(id, estado) {
  const r = await api(`/api/solicitudes-matricula/${id}`, 'PATCH', { estado });
  if (r && r.error) return toast(r.error);
  await cargarTodo();
  toast(estado === 'aprobada' ? 'Matrícula aprobada ✅' : 'Solicitud rechazada');
}

function renderDisputas(lista) {
  const data = (lista || disputas).filter(d => filtroDisputas === 'todos' || d.estado === filtroDisputas);
  document.getElementById('disputas-tbody').innerHTML = Chamba.html(data.length ? data.map(d => {
    const pedido = pedidos.find(p => p.id === d.pedido_id);
    const reportante = usuarios.find(u => u.id === d.creado_por);
    return `<tr>
      <td class="td-primary">${Chamba.escape(pedido ? pedido.servicio : '—')}</td>
      <td>${Chamba.escape(reportante ? reportante.nombre : '—')}</td>
      <td>${Chamba.escape(d.motivo)}</td>
      <td style="max-width:220px;white-space:normal">${Chamba.escape(d.descripcion)}</td>
      <td>${Chamba.escape(fmtDate(d.created_at))}</td>
      <td>${badge(d.estado)}</td>
      <td>${d.estado !== 'resuelta' ? `<button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){resolverDisputa(`${d.id}`)})}>Gestionar</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No hay disputas</td></tr>');
}
function filtrarDisputas(f, btn) { filtroDisputas=f; document.querySelectorAll('#page-disputas .filter-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderDisputas(); }
async function resolverDisputa(id) {
  const d = disputas.find(x => x.id === id);
  const nota = prompt('Nota de resolución (se le va a mostrar al cliente y al socio):', d?.resolucion || '');
  if (nota === null) return; // canceló
  const estado = confirm('¿Marcar como RESUELTA? Aceptar = Resuelta, Cancelar = En revisión (todavía no resuelta)') ? 'resuelta' : 'en_revision';
  const r = await api(`/api/disputas/${id}`, 'PATCH', { estado, resolucion: nota });
  if (r && r.error) return toast(r.error);
  await cargarTodo();
  toast('Disputa actualizada ✅');
}

function renderIdentificacion(lista) {
  const data = (lista || verificacionesIdentidad).filter(v => filtroIdentificacion === 'todos' || v.estado === filtroIdentificacion);
  document.getElementById('identificacion-tbody').innerHTML = Chamba.html(data.length ? data.map(v => {
    const socio = usuarios.find(u => u.id === v.socio_id);
    const links = (v.archivos || []).map(a => `<a href="${Chamba.escape(a.url)}" target="_blank" rel="noopener noreferrer" rel="noopener">${Chamba.escape(a.label)}</a>`).join(' · ');
    return `<tr>
      <td class="td-primary">${Chamba.escape(socio ? socio.nombre : '—')}</td>
      <td>${Chamba.escape(fmtDate(v.created_at))}</td>
      <td>${links || '—'}</td>
      <td>${badge(v.estado)}</td>
      <td>${v.estado === 'pendiente' ? `<button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){resolverIdentificacion(`${v.id}`,'aprobada')})}>✅ Aprobar</button> <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){resolverIdentificacion(`${v.id}`,'rechazada')})}>❌ Rechazar</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">No hay envíos</td></tr>');
}
function filtrarIdentificacion(f, btn) { filtroIdentificacion=f; document.querySelectorAll('#sub-users-identificacion .filter-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderIdentificacion(); }
async function resolverIdentificacion(id, estado) {
  const r = await api(`/api/verificaciones-identidad/${id}`, 'PATCH', { estado });
  if (r && r.error) return toast(r.error);
  await cargarTodo();
  toast(estado === 'aprobada' ? 'Identificación aprobada ✅' : 'Identificación rechazada');
}

function renderEspecialidades() {
  const { conteo } = contarSociosPorRubro();
  document.getElementById('especialidades-tbody').innerHTML = Chamba.html(especialidades.length ? especialidades.map(e => {
    const n = conteo[e.nombre] || 0;
    return `<tr>
      <td class="td-primary">${Chamba.escape(e.nombre)}</td>
      <td>${n === 0 ? `<span style="color:var(--red)">${Chamba.escape(n)} socios</span>` : `${n} socio${n!==1?'s':''}`}</td>
      <td>${e.activa ? '<span class="badge badge-green">✅ Activa</span>' : '<span class="badge badge-gray">🚫 Bloqueada</span>'}</td>
      <td>${e.activa
        ? `<button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){toggleEspecialidad(`${e.id}`, false)})}>Bloquear</button>`
        : `<button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){toggleEspecialidad(`${e.id}`, true)})}>Desbloquear</button>`}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">No hay especialidades cargadas</td></tr>');
}
async function toggleEspecialidad(id, activa) {
  const r = await api(`/api/especialidades/${id}`, 'PATCH', { activa });
  if (r && r.error) return toast(r.error);
  await cargarTodo();
  toast(activa ? 'Especialidad desbloqueada ✅' : 'Especialidad bloqueada 🚫');
}
function buscarUsuarios(tipo, q) {
  const data = usuarios.filter(u => u.tipo === tipo && (u.nombre.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()) || (u.nombre_usuario||'').toLowerCase().includes(q.toLowerCase())));
  tipo === 'cliente' ? renderClientesReg(data) : renderSociosReg(data);
}

function renderPagos() {
  const conMonto = pedidos.filter(p => p.precio_cliente > 0);
  const completados = pedidos.filter(p => p.estado === 'completado');
  document.getElementById('p-cobrado').textContent = '$' + Math.round(pedidos.filter(p=>p.estado==='completado').reduce((s,p)=>s+(p.comision||0),0)).toLocaleString('es-AR');
  document.getElementById('p-pendiente').textContent = '$' + Math.round(pedidos.filter(p=>p.estado==='en_proceso').reduce((s,p)=>s+(p.comision||0),0)).toLocaleString('es-AR');

  const ticketProm = completados.length ? completados.reduce((s,p) => s + (p.precio_cliente||0), 0) / completados.length : 0;
  document.getElementById('p-ticket').textContent = '$' + Math.round(ticketProm).toLocaleString('es-AR');

  const ofertasAceptadas = ofertas.filter(o => o.estado === 'aceptada').length;
  const conversion = ofertas.length ? Math.round((ofertasAceptadas / ofertas.length) * 100) : 0;
  document.getElementById('p-conversion').textContent = conversion + '%';

  // Gráfico: comisión ganada por día, últimos 14 días
  const dias = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dias.push(d.toISOString().slice(0,10)); }
  const porDia = {}; dias.forEach(d => porDia[d] = 0);
  completados.forEach(p => { const dia = (p.created_at||'').slice(0,10); if (porDia[dia] !== undefined) porDia[dia] += (p.comision||0); });
  const max = Math.max(...Object.values(porDia), 1);
  document.getElementById('grafico-ingresos').innerHTML = Chamba.html(dias.map(d => {
    const val = porDia[d];
    const alto = Math.max(Math.round((val / max) * 100), val > 0 ? 4 : 0);
    const label = new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;height:100%;justify-content:flex-end">
      <div style="width:100%;max-width:28px;background:var(--teal);border-radius:4px 4px 0 0;height:${Chamba.escape(alto)}%" title="$${Chamba.escape(Math.round(val).toLocaleString('es-AR'))}"></div>
      <div style="font-size:10px;color:var(--text-soft);white-space:nowrap">${Chamba.escape(label)}</div>
    </div>`;
  }).join(''));

  document.getElementById('pagos-tbody').innerHTML = Chamba.html(conMonto.length ? conMonto.map(p => `<tr><td class="td-primary">${Chamba.escape(p.servicio||'—')}</td><td>$${Chamba.escape(Number(p.precio_cliente).toLocaleString('es-AR'))}</td><td style="color:var(--teal);font-weight:500">$${Chamba.escape(Number(p.comision||0).toLocaleString('es-AR'))}</td><td>${badge(p.estado)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No hay pagos</td></tr>');
}

// MODAL PEDIDO — SOLO VISUALIZACIÓN + ELIMINAR (sin asignar/estado/monto)
function verPedido(id) {
  const p = pedidos.find(x => x.id === id);
  if (!p) return;
  const socioAsignado = p.profesional_id ? usuarios.find(u => u.id === p.profesional_id) : null;
  document.getElementById('modal-pedido-content').innerHTML = Chamba.html(`
    <div class="modal-field"><label>Servicio</label><div class="val">${Chamba.escape(p.servicio||'—')}</div></div>
    <div class="modal-field"><label>Descripción</label><div class="val">${Chamba.escape(p.descripcion||'—')}</div></div>
    <div class="modal-field"><label>Estado</label><div class="val">${badge(p.estado)}</div></div>
    ${socioAsignado ? `<div class="modal-field"><label>Socio asignado</label><div class="val">${Chamba.escape(socioAsignado.nombre)}</div></div>` : ''}
    ${p.precio_cliente ? `<div class="modal-field"><label>Precio acordado</label><div class="val">$${Chamba.escape(Number(p.precio_cliente).toLocaleString('es-AR'))} (comisión: $${Chamba.escape(Number(p.comision||0).toLocaleString('es-AR'))})</div></div>` : ''}
    <div class="modal-field"><label>Fecha</label><div class="val">${Chamba.escape(fmtDate(p.created_at))}</div></div>
    <hr class="modal-divider">
    <div style="font-size:13px;color:var(--text-soft);margin-bottom:14px">ℹ️ El flujo de este pedido (asignación, negociación, pago) lo gestionan automáticamente el cliente y el socio. Como admin solo podés visualizarlo o eliminarlo si es necesario.</div>
    <div class="modal-actions">
      <button class="btn btn-red" ${Chamba.bind("click",function(event){eliminarPedidoAdmin(`${id}`)})}>🗑️ Eliminar trabajo</button>
      <button class="btn btn-ghost" ${Chamba.bind("click",function(event){closeModal('modal-pedido')})}>Cerrar</button>
    </div>`);
  openModal('modal-pedido');
}

async function eliminarPedidoAdmin(id) {
  if (!confirm('¿Eliminar este trabajo? Esta acción no afecta la reputación de ningún socio.')) return;
  await api(`/api/pedidos/${id}/eliminar-admin`, 'POST');
  await cargarTodo();
  closeModal('modal-pedido');
  toast('Trabajo eliminado ✅ (sin afectar reputación)');
}

async function verUsuario(id) {
  const u = usuarios.find(x => x.id === id);
  if (!u) return;
  document.getElementById('modal-usuario-title').textContent = u.tipo === 'cliente' ? 'Cliente' : 'Socio';

  let fotosHtml = '';
  if (u.tipo === 'socio') {
    fotosHtml = '<div class="modal-field"><label>Verificación de identidad</label><div class="val">Cargando fotos...</div></div>';
  }
  document.getElementById('modal-usuario-content').innerHTML = Chamba.html(`
    <div class="modal-field"><label>Nombre</label><div class="val">${Chamba.escape(u.nombre)}</div></div>
    <div class="modal-field"><label>Usuario</label><div class="val">${Chamba.escape(u.nombre_usuario ? '@'+u.nombre_usuario : '—')}</div></div>
    <div class="modal-field"><label>Email</label><div class="val">${Chamba.escape(u.email)}</div></div>
    <div class="modal-field"><label>Teléfono</label><div class="val">${Chamba.escape(u.telefono||'—')}</div></div>
    ${u.tipo === 'socio' ? `
    <hr class="modal-divider">
    <div class="modal-field"><label>Especialidad</label><div class="val">${Chamba.escape(u.especialidad||'—')}</div></div>
    <div class="modal-field"><label>DNI</label><div class="val">${Chamba.escape(u.dni||'—')}</div></div>
    <div class="modal-field"><label>Experiencia</label><div class="val">${Chamba.escape(u.experiencia||'—')}</div></div>
    <div class="modal-field"><label>Matrícula</label><div class="val">${Chamba.escape(u.matricula||'—')}${Chamba.escape(u.matricula_organismo ? ' · '+u.matricula_organismo : '')}</div></div>
    <div class="modal-field"><label>Reputación</label><div class="val">${Chamba.escape(u.promedio_estrellas ? u.promedio_estrellas+' ⭐ ('+(u.total_calificaciones||0)+' reviews)' : 'Sin calificaciones aún')}</div></div>
    <div class="modal-field"><label>Trabajos completados</label><div class="val">${Chamba.escape(u.trabajos_completados||0)}</div></div>
    ` : ''}
    <div class="modal-field"><label>Ubicación</label><div class="val" id="modal-usuario-ubicacion">Cargando...</div></div>
    ${fotosHtml}
    <div class="modal-field"><label>Estado</label><div class="val">${badge(u.estado)}</div></div>
    <div class="modal-field"><label>Registrado</label><div class="val">${Chamba.escape(fmtDate(u.created_at))}</div></div>
    <hr class="modal-divider">
    <div class="modal-actions">
      ${u.estado==='pendiente'?`<button class="btn btn-teal" ${Chamba.bind("click",function(event){cambiarEstadoUsuario(`${u.id}`,'aprobado')})}>✅ Aprobar</button><button class="btn btn-red" ${Chamba.bind("click",function(event){cambiarEstadoUsuario(`${u.id}`,'rechazado')})}>❌ Rechazar</button>`:''}
      ${u.estado==='aprobado'?`<button class="btn btn-red" ${Chamba.bind("click",function(event){cambiarEstadoUsuario(`${u.id}`,'suspendido')})}>⏸️ Suspender</button>`:''}
      ${(u.estado==='rechazado'||u.estado==='suspendido')?`<button class="btn btn-teal" ${Chamba.bind("click",function(event){cambiarEstadoUsuario(`${u.id}`,'aprobado')})}>Reactivar</button>`:''}
      <button class="btn btn-red" ${Chamba.bind("click",function(event){eliminarUsuario(`${u.id}`)})}>Eliminar</button>
      <button class="btn btn-ghost" ${Chamba.bind("click",function(event){closeModal('modal-usuario')})}>Cerrar</button>
    </div>`);
  openModal('modal-usuario');

  try {
    const ubs = await api(`/api/ubicaciones?usuario_id=${u.id}`);
    const el = document.getElementById('modal-usuario-ubicacion');
    if (el) {
      if (Array.isArray(ubs) && ubs.length) {
        el.innerHTML = Chamba.html(ubs.map(x => `${x.direccion}${x.predeterminada ? ' <span class="badge badge-green" style="margin-left:4px">Predeterminada</span>' : ''}`).join('<br/>'));
      } else {
        el.textContent = 'Sin ubicaciones cargadas';
      }
    }
  } catch (e) {
    const el = document.getElementById('modal-usuario-ubicacion');
    if (el) el.textContent = 'No se pudo cargar';
  }

  if (u.tipo === 'socio') {
    try {
      const fotos = await api(`/api/usuarios/${u.id}/fotos-verificacion`);
      const bloque = [...document.querySelectorAll('#modal-usuario-content .modal-field')].find(el => el.querySelector('label')?.textContent === 'Verificación de identidad');
      if (bloque) {
        bloque.innerHTML = Chamba.html(`
          <label>Verificación de identidad</label>
          <div class="val" style="display:flex;gap:12px;flex-wrap:wrap">
            ${fotos.dni_foto_url ? `<a href="${Chamba.escape(fotos.dni_foto_url)}" target="_blank" rel="noopener noreferrer"><img src="${Chamba.escape(fotos.dni_foto_url)}" alt="DNI" style="width:120px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"/><div style="font-size:11px;text-align:center;color:var(--text-soft)">DNI</div></a>` : '<span style="font-size:12px;color:var(--text-soft)">Sin foto de DNI</span>'}
            ${fotos.foto_perfil_url ? `<a href="${Chamba.escape(fotos.foto_perfil_url)}" target="_blank" rel="noopener noreferrer"><img src="${Chamba.escape(fotos.foto_perfil_url)}" alt="Perfil" style="width:80px;height:80px;object-fit:cover;border-radius:50%;border:1px solid var(--border)"/><div style="font-size:11px;text-align:center;color:var(--text-soft)">Perfil</div></a>` : '<span style="font-size:12px;color:var(--text-soft)">Sin foto de perfil</span>'}
          </div>`);
      }
    } catch (e) {
      console.error('Error cargando fotos de verificación:', e.message);
    }
  }
}
async function cambiarEstadoUsuario(id, estado) {
  await api(`/api/usuarios/${id}`,'PATCH',{estado});
  await cargarTodo();
  closeModal('modal-usuario');
  const mensajes = { aprobado: 'Usuario aprobado ✅', rechazado: 'Usuario rechazado', suspendido: 'Usuario suspendido ⏸️' };
  toast(mensajes[estado] || 'Estado actualizado');
}
async function eliminarUsuario(id) { if(!confirm('¿Eliminar este usuario?'))return; await api(`/api/usuarios/${id}`,'DELETE'); await cargarTodo(); closeModal('modal-usuario'); toast('Usuario eliminado'); }

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target===m) m.classList.remove('open'); }));
function toast(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); }

// FORO CON RESPUESTAS
async function cargarForo() {
  try {
    foroPosts = await api('/api/foro');
    if (!Array.isArray(foroPosts)) foroPosts = [];
    renderForoAdmin();
  } catch(e) {}
}

function renderForoAdmin() {
  const principales = foroPosts.filter(p => !p.parent_id);
  const respuestas = foroPosts.filter(p => p.parent_id);
  const container = document.getElementById('foro-admin-posts');
  container.innerHTML = Chamba.html(principales.length ? principales.map(p => {
    const resps = respuestas.filter(r => r.parent_id === p.id);
    return `<div class="foro-post">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div><span style="font-size:13px;font-weight:600">${Chamba.escape(p.autor_nombre)}</span><span class="tipo-chip tipo-${Chamba.escape(p.autor_tipo)}">${Chamba.escape(p.autor_tipo)}</span></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--text-soft)">${Chamba.escape(fmtDate(p.created_at))}</span>
          <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){eliminarPost(`${p.id}`)})}>Eliminar</button>
        </div>
      </div>
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">${Chamba.escape(p.titulo)}</div>
      <div style="font-size:14px;color:var(--text-mid);line-height:1.6;margin-bottom:10px">${Chamba.escape(p.contenido)}</div>
      ${resps.map(r => `<div class="foro-respuesta">
        <div><div class="foro-resp-autor">${Chamba.escape(r.autor_nombre)} <span class="tipo-chip tipo-${Chamba.escape(r.autor_tipo)}">${Chamba.escape(r.autor_tipo)}</span> · ${Chamba.escape(fmtDate(r.created_at))}</div>${Chamba.escape(r.contenido)}</div>
        <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){eliminarPost(`${r.id}`)})}>×</button>
      </div>`).join('')}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" ${Chamba.bind("click",function(event){toggleRespForm(`resp-form-${p.id}`)})}>💬 Responder como ChamBA</button>
      <div class="foro-resp-form" id="resp-form-${Chamba.escape(p.id)}">
        <div style="display:flex;gap:8px;margin-top:6px">
          <input type="text" id="resp-input-${Chamba.escape(p.id)}" placeholder="Escribí tu respuesta..." ${Chamba.bind("keydown",function(event){if(event.key==='Enter')responderAdmin(`${p.id}`)})}/>
          <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){responderAdmin(`${p.id}`)})}>Enviar</button>
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="empty">No hay publicaciones en el foro</div>');
}

function toggleRespForm(id) { const el=document.getElementById(id); el.style.display = el.style.display==='none'||el.style.display===''?'block':'none'; }

async function responderAdmin(parentId) {
  const input = document.getElementById('resp-input-' + parentId);
  const contenido = input.value.trim(); if (!contenido) return;
  const parent = foroPosts.find(p => p.id === parentId);
  await api('/api/foro', 'POST', { autor_id: null, autor_nombre: 'ChamBA', autor_tipo: 'admin', titulo: 'Re: ' + (parent?.titulo||''), contenido, parent_id: parentId });
  input.value = '';
  toggleRespForm('resp-form-' + parentId);
  await cargarForo();
  toast('Respuesta publicada ✅');
}

async function publicarForoAdmin() {
  const titulo = document.getElementById('foro-admin-titulo').value.trim();
  const contenido = document.getElementById('foro-admin-body').value.trim();
  if (!titulo || !contenido) return;
  await api('/api/foro', 'POST', { autor_id: null, autor_nombre: 'ChamBA', autor_tipo: 'admin', titulo, contenido });
  document.getElementById('foro-admin-titulo').value = '';
  document.getElementById('foro-admin-body').value = '';
  await cargarForo();
  toast('Publicado en el foro ✅');
}

async function eliminarPost(id) {
  if (!confirm('¿Eliminar esta publicación?')) return;
  await api(`/api/foro/${id}`, 'DELETE');
  await cargarForo();
  toast('Publicación eliminada');
}
