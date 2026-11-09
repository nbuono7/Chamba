
const BACKEND = 'https://chamba-backend-vurx.onrender.com';
let usuario = null;
let trabajosDisponibles = [];
let misOfertas = [];
let misTareas = [];
let pedidosCache = {};
let misPedidosCliente = [];
let todasOfertasCliente = {};
let iaSugerenciaCliente = null;
let estrellasPorPedido = {};
let tagsPorPedido = {};
const TAGS_CALIFICACION = ['Rápido', 'Buen trabajo', 'Prolijo', 'Puntual', 'Buena comunicación', 'Lento', 'Deficiente', 'Mala comunicación'];

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
function showConfirm(icon, title, msg, onOk, labelOk='Confirmar') {
  showModal(icon, title, msg, [{ label: labelOk, action: onOk }, { label: 'Cancelar', class: 'btn-ghost' }]);
}

window.onload = async () => {
  const u = localStorage.getItem('chamba_user');
  if (!u) return window.location.href = '/login';
  usuario = JSON.parse(u);
  if (usuario.tipo !== 'socio') {
    return window.location.href = usuario.tipo === 'admin' ? '/admin' : usuario.tipo === 'cliente' ? '/panel-cliente' : '/login';
  }
  try {
    const todos = await api('/api/usuarios');
    const fresco = Array.isArray(todos) ? todos.find(x => x.email === usuario.email) : null;
    if (fresco) { delete fresco.password_hash; usuario = fresco; localStorage.setItem('chamba_user', JSON.stringify(fresco)); }
  } catch(e) {}
  if (usuario.tipo !== 'socio') {
    return window.location.href = usuario.tipo === 'admin' ? '/admin' : usuario.tipo === 'cliente' ? '/panel-cliente' : '/login';
  }
  document.getElementById('sidebar-user').textContent = usuario.nombre;
  document.getElementById('user-avatar').textContent = iniciales(usuario.nombre);
  document.getElementById('bienvenida').textContent = 'Hola, ' + usuario.nombre.split(' ')[0] + ' 👋';
  if (usuario.estado === 'pendiente') {
    document.getElementById('pendiente-aviso').style.display = 'block';
    document.getElementById('inicio-sub').textContent = 'Tu solicitud está pendiente de aprobación.';
  } else {
    document.getElementById('inicio-aprobado').style.display = 'block';
    document.getElementById('inicio-sub').textContent = 'Panel de socio · ' + (usuario.especialidad||'');
    document.getElementById('mi-especialidad').textContent = usuario.especialidad || 'tu especialidad';
    await cargarTodo();
    setInterval(()=>{if(!document.hidden)cargarTodo();}, 30000);
  }
  renderPerfil();
  cargarSolicitudesMatricula();
  cargarVerificacionesIdentidad();
  cargarUbicaciones();
  cargarEspecialidades();
  cargarForo();
  if (window.location.hash === '#mi-perfil') {
    goTo('mi-perfil', document.querySelector('[data-profile-nav]'));
  }
};

function doLogout() { Chamba.clearDraft(); localStorage.removeItem('chamba_user'); localStorage.removeItem('chamba_token'); window.location.href = '/'; }
function iniciales(nombre) { return (nombre || '').trim().split(/\s+/).slice(0,2).map(p => p[0]).join('').toUpperCase(); }

async function cargarEspecialidades() {
  try {
    const especialidades = await api('/api/especialidades');
    const select = document.getElementById('cli-p-servicio');
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
  const badgeMap = {
    trab: { disponibles: 'badge-disponibles', ofertas: 'badge-ofertas', proceso: 'badge-proceso' },
    serv: { esperando: 'badge-cli-esperando', negociacion: 'badge-cli-negociacion', proceso: 'badge-cli-proceso' }
  };
  const id = badgeMap[group] && badgeMap[group][tab];
  if (id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
}

function irATrabajos(tab) { goTo('trabajos', document.getElementById('nav-trabajos')); goSubTab('trab', tab); }
function irAServicio(tab) { goTo('necesito-servicio', document.getElementById('nav-servicio')); goSubTab('serv', tab); }

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

async function cargarTodo() {
  try {
    await cargarDisputas();
    const [todosPedidos, ofertas] = await Promise.all([api('/api/pedidos'), api('/api/ofertas')]);
    const lista = Array.isArray(todosPedidos) ? todosPedidos : [];
    lista.forEach(p => pedidosCache[p.id] = p);
    misOfertas = Array.isArray(ofertas) ? ofertas.filter(o=>o.socio_id===usuario.id) : [];

    // IDs de pedidos donde ya oferté (y no fueron rechazados/cancelados)
    const idsConOferta = new Set(misOfertas.filter(o => o.estado !== 'rechazada').map(o => o.pedido_id));

    // Disponibles: trabajos nuevos de mi especialidad donde NO oferté
    trabajosDisponibles = lista.filter(p => p.estado === 'nuevo' && p.usuario_id!==usuario.id && Chamba.services(usuario.especialidad).includes(p.servicio) && !idsConOferta.has(p.id));

    // Mis tareas (asignadas a mí)
    misTareas = lista.filter(p => p.profesional_id === usuario.id);

    // Pedidos que YO publiqué como cliente (necesito un servicio)
    misPedidosCliente = lista.filter(p => p.usuario_id === usuario.id);
    todasOfertasCliente = {};for(const o of ofertas)(todasOfertasCliente[o.pedido_id]??=[]).push(o);
  } catch(e) {Chamba.notice(e.message);return;}

  const n1 = trabajosDisponibles.length;
  const activas = misOfertas.filter(o => o.estado !== 'rechazada' && o.estado !== 'aceptada' && pedidosCache[o.pedido_id]?.estado !== 'cancelado');
  const n2 = activas.length;
  const enProceso = misTareas.filter(t => t.estado === 'en_proceso');
  const n3 = enProceso.length;

  document.getElementById('stat-disponibles').textContent = n1;
  document.getElementById('stat-mis-ofertas').textContent = n2;
  document.getElementById('stat-proceso').textContent = n3;
  document.getElementById('stat-rep').textContent = usuario.promedio_estrellas ? usuario.promedio_estrellas + '⭐' : '—';

  setBadge('badge-disponibles', n1, 'sub-trab-disponibles');
  setBadge('badge-ofertas', n2, 'sub-trab-ofertas');
  setBadge('badge-proceso', n3, 'sub-trab-proceso');
  const badgeTrabTotal = document.getElementById('badge-trabajos-total');
  badgeTrabTotal.textContent = n1;
  badgeTrabTotal.style.display = n1 > 0 ? 'inline-flex' : 'none';

  renderDisponibles();
  renderMisOfertas();
  // Preservar lo que el socio ya tipeó en el código antes de redibujar (el auto-refresh no debe borrarlo)
  const codigosEnCurso = {};
  document.querySelectorAll('[id^="cod-"], [id^="chat-in-"]').forEach(inp => { if (inp.value) codigosEnCurso[inp.id] = inp.value; });
  document.getElementById('lista-proceso').innerHTML = Chamba.html(enProceso.map(t => renderCardProceso(t)).join('') || '<div class="empty">No tenés trabajos en proceso.</div>');
  Object.entries(codigosEnCurso).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });
  document.getElementById('lista-completados').innerHTML = Chamba.html(misTareas.filter(t=>t.estado==='completado').map(t=>renderCardCompletado(t)).join('') || '<div class="empty">No tenés trabajos completados aún.</div>');
  renderSaldo();
  enProceso.forEach(t => cargarMensajes(t.id));
  renderCliTodo();
  renderActividadReciente();
}

function setBadge(id, count, pageId) {
  const el = document.getElementById(id);
  const activa = document.getElementById(pageId)?.classList.contains('active');
  el.textContent = count;
  el.style.display = (count > 0 && !activa) ? 'inline' : 'none';
}

function renderDisponibles() {
  document.getElementById('lista-disponibles').innerHTML = Chamba.html(trabajosDisponibles.length
    ? trabajosDisponibles.map(t => `
        <div class="trabajo-card nuevo">
          <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(t.servicio)} ${t.es_favorito ? '<span class="badge" style="background:var(--teal-light);color:var(--teal-dark);margin-left:6px">⭐ Te eligieron como favorito</span>' : ''} ${t.urgencia === 'Alta' ? '<span class="badge" style="background:var(--red-light);color:var(--red);margin-left:6px">🔥 BONUS POR URGENCIA</span>' : ''}</div><div style="font-size:12px;color:var(--text-soft)">${Chamba.escape(fmtDate(t.created_at))}</div></div>
          ${t.es_favorito ? `<div style="font-size:12px;color:var(--teal-dark);margin-bottom:4px">Este cliente te pidió el trabajo directamente a vos — solo vos lo ves.</div>` : ''}
          ${t.zona || t.distancia_km != null ? `<div style="font-size:12px;color:var(--teal-dark);font-weight:500;margin-bottom:4px">📍 ${Chamba.escape(t.zona||'Zona sin especificar')}${Chamba.escape(t.distancia_km != null ? ` · a ${t.distancia_km} km de tu zona de trabajo` : '')}</div>` : ''}
          <div class="trabajo-desc">${Chamba.escape(t.descripcion||'')}</div>
          ${t.urgencia === 'Alta' ? `<div style="font-size:12px;color:var(--red);margin-bottom:6px">⚠️ El cliente necesita que esto se resuelva rápido — podés cobrar un poco más por la prioridad.</div>` : ''}
          ${t.precio_sugerido_ia ? `<div class="trabajo-ia">🤖 Precio sugerido al cliente: <strong>${Chamba.escape(fmt(t.precio_sugerido_ia))}</strong><br>Tu parte: <strong>${Chamba.escape(fmt(Chamba.quote(t.precio_sugerido_ia).neto))}</strong> · ChamBA: ${Chamba.escape(fmt(Chamba.quote(t.precio_sugerido_ia).comision))} (13%, mínimo $1.000)</div>` : ''}
          <div id="form-${Chamba.escape(t.id)}" style="display:none" class="oferta-form">
            <div class="form-group" style="margin-bottom:8px"><label>Tu precio (lo que el cliente paga)</label><input type="number" id="precio-${Chamba.escape(t.id)}" placeholder="Ej: 15000" ${Chamba.bind("input",function(event){calcNeto(`${t.id}`)})}/></div>
            <div id="preview-${Chamba.escape(t.id)}" class="oferta-preview"></div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){enviarOferta(`${t.id}`)})}>Enviar oferta</button>
              <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){document.getElementById(`form-${t.id}`).style.display='none'})}>Cancelar</button>
            </div>
          </div>
          <div style="margin-top:10px"><button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){toggleForm(`${t.id}`)})}>💼 Hacer oferta</button></div>
        </div>`).join('')
    : `<div class="empty">No hay trabajos de <strong>${Chamba.escape(usuario.especialidad||'tu especialidad')}</strong> disponibles ahora.</div>`);
}

function renderMisOfertas() {
  const ofertasFiltradas = misOfertas.filter(o => o.estado !== 'aceptada');
  document.getElementById('lista-mis-ofertas').innerHTML = Chamba.html(ofertasFiltradas.length ? ofertasFiltradas.map(o => {
    const pedido = pedidosCache[o.pedido_id];
    const cancelado = o.estado === 'rechazada' || pedido?.estado === 'cancelado';
    const clienteContraoferto = o.ultima_oferta_de === 'cliente' && o.estado === 'negociando';
    const esperandoCliente = o.ultima_oferta_de === 'socio' && o.estado === 'negociando';
    return `<div class="trabajo-card ${Chamba.escape(cancelado?'':'')}" style="position:relative">
      ${cancelado ? `<div class="wasted-overlay"><div class="wasted-text">CANCELADO</div><button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){eliminarOferta(`${o.id}`)})}>Eliminar</button></div>` : ''}
      <div class="trabajo-header">
        <div class="trabajo-servicio">${Chamba.escape(pedido ? pedido.servicio : 'Trabajo')}</div>
        ${o.estado==='negociando' ? '<span class="badge badge-amber">Negociando</span>' : '<span class="badge badge-gray">Pendiente</span>'}
      </div>
      <div class="trabajo-desc">${Chamba.escape(pedido ? pedido.descripcion||'' : '')}</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">Tu oferta: <span style="color:var(--teal-dark)">${Chamba.escape(fmt(o.precio_ofertado))}</span></div>
      <div style="font-size:13px;color:var(--text-soft)">Tu parte: ${Chamba.escape(fmt(o.precio_neto))} · Comisión: ${Chamba.escape(fmt(o.comision))}</div>
      ${clienteContraoferto ? `
        <div class="neg-box">
          <div style="font-size:13px;font-weight:600;color:var(--amber);margin-bottom:6px">💬 El cliente propuso: <strong>${Chamba.escape(fmt(o.precio_ofertado))}</strong></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){aceptarContraoferta(`${o.id}`)})}>✅ Aceptar ${Chamba.escape(fmt(o.precio_ofertado))}</button>
            <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){toggleNegSocio(`neg-${o.id}`)})}>💬 Contraofertar</button>
            <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){rechazarTrabajo(`${o.id}`)})}>❌ Rechazar trabajo</button>
          </div>
          <div id="neg-${Chamba.escape(o.id)}" style="display:none" class="neg-precio-input">
            <input type="number" id="neg-val-${Chamba.escape(o.id)}" placeholder="Tu nuevo precio..."/>
            <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){enviarContraofertaSocio(`${o.id}`)})}>Enviar</button>
          </div>
        </div>` : ''}
      ${esperandoCliente ? `<div style="font-size:13px;color:var(--text-soft);margin-top:8px">⏳ Esperando respuesta del cliente...</div>` : ''}
      ${o.estado==='pendiente' ? `<div style="margin-top:10px"><button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){rechazarTrabajo(`${o.id}`)})}>❌ Rechazar trabajo</button></div>` : ''}
    </div>`;
  }).join('') : '<div class="empty">No enviaste ofertas aún.</div>');
}

function renderCardProceso(t) {
  return `<div class="trabajo-card asignado">
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(t.servicio)}</div><span class="badge badge-amber">⚙️ En proceso</span></div>
    <div class="trabajo-desc">${Chamba.escape(t.descripcion||'')}</div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px">
      <div><div style="font-size:12px;color:var(--teal-dark)">Tu pago al completar</div><div style="font-size:22px;font-weight:700;color:var(--teal-dark)">${Chamba.escape(fmt(t.precio_socio))}</div></div>
      <div><div style="font-size:12px;color:var(--teal-dark)">Comisión ChamBA</div><div style="font-size:15px;font-weight:600;color:var(--teal-dark)">${Chamba.escape(fmt(t.comision))}</div></div>
    </div>
    <div style="background:#fff;border:2px solid var(--teal);border-radius:12px;padding:18px;text-align:center">
      <div style="font-size:14px;font-weight:600;color:var(--teal-dark);margin-bottom:12px">🔐 Ingresá el código del cliente</div>
      <div class="codigo-inputs">
        <input class="codigo-digit" id="cod-${Chamba.escape(t.id)}-0" maxlength="1" inputmode="numeric" pattern="[0-9]" ${Chamba.bind("input",function(event){nextDigit(this,`cod-${t.id}-1`)})} ${Chamba.bind("keydown",function(event){prevDigit(event,null,`cod-${t.id}-0`)})}/>
        <input class="codigo-digit" id="cod-${Chamba.escape(t.id)}-1" maxlength="1" inputmode="numeric" pattern="[0-9]" ${Chamba.bind("input",function(event){nextDigit(this,`cod-${t.id}-2`)})} ${Chamba.bind("keydown",function(event){prevDigit(event,`cod-${t.id}-0`,`cod-${t.id}-1`)})}/>
        <input class="codigo-digit" id="cod-${Chamba.escape(t.id)}-2" maxlength="1" inputmode="numeric" pattern="[0-9]" ${Chamba.bind("input",function(event){nextDigit(this,`cod-${t.id}-3`)})} ${Chamba.bind("keydown",function(event){prevDigit(event,`cod-${t.id}-1`,`cod-${t.id}-2`)})}/>
        <input class="codigo-digit" id="cod-${Chamba.escape(t.id)}-3" maxlength="1" inputmode="numeric" pattern="[0-9]" ${Chamba.bind("input",function(event){nextDigit(this,null)})} ${Chamba.bind("keydown",function(event){prevDigit(event,`cod-${t.id}-2`,`cod-${t.id}-3`)})}/>
      </div>
      <button class="btn btn-teal" ${Chamba.bind("click",function(event){verificarCodigo(`${t.id}`)})}>Confirmar código</button>
      <div id="cod-err-${Chamba.escape(t.id)}" style="color:var(--red);font-size:13px;margin-top:8px;display:none"></div>
    </div>
    <div class="codigo-advertencia">⚠️ <strong>Importante:</strong> Pedile el código al cliente solo cuando hayas <strong>terminado el trabajo</strong>. Tenés 4 intentos para ingresarlo correctamente.</div>
    <div style="margin-top:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--teal-dark)">💬 Chat con el cliente</div>
      <div class="chat-box">
        <div class="chat-messages" id="chat-${Chamba.escape(t.id)}"></div>
        <div class="chat-input-row">
          <input class="chat-input" id="chat-in-${Chamba.escape(t.id)}" placeholder="Coordiná día, hora y lugar..." ${Chamba.bind("keydown",function(event){if(event.key==='Enter')enviarMsg(`${t.id}`)})}/>
          <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){enviarMsg(`${t.id}`)})}>Enviar</button>
        </div>
      </div>
    </div>
    ${renderBloqueDisputa(t.id)}
  </div>`;
}

function renderCardCompletado(t) {
  return `<div class="trabajo-card">
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(t.servicio)}</div><span class="badge badge-green">✅ Completado</span></div>
    <div class="trabajo-desc">${Chamba.escape(t.descripcion||'')}</div>
    <div style="font-size:14px;font-weight:500;color:var(--teal-dark)">Cobrado: ${Chamba.escape(fmt(t.precio_socio))} · ${Chamba.escape(fmtDate(t.created_at))}</div>
    ${renderBloqueDisputa(t.id)}
  </div>`;
}

function toggleForm(id) { const el=document.getElementById('form-'+id); el.style.display=el.style.display==='none'?'block':'none'; }
function toggleNegSocio(id) { const el=document.getElementById(id); el.style.display=el.style.display==='none'?'block':'none'; }

function calcNeto(id) {
  const precio = parseFloat(document.getElementById('precio-'+id).value) || 0;
  const preview = document.getElementById('preview-'+id);
  if (precio > 0) { preview.style.display='block'; preview.innerHTML = Chamba.html(`Vas a recibir: <strong>${Chamba.escape(fmt(Chamba.quote(precio).neto))}</strong> · ChamBA cobra: <strong>${Chamba.escape(fmt(Chamba.quote(precio).comision))}</strong> (13%, mínimo $1.000)`); }
  else preview.style.display = 'none';
}

async function enviarOferta(pedidoId) {
  const precio = parseFloat(document.getElementById('precio-'+pedidoId).value);
  if (!Number.isFinite(precio) || precio<1001) return showInfo('⚠️','Precio inválido','Ingresá un precio mayor a $1.000.');
  await api('/api/ofertas', 'POST', { pedido_id: pedidoId, socio_id: usuario.id, socio_nombre: usuario.nombre, especialidad: usuario.especialidad, precio_ofertado: precio });
  showInfo('✅','Oferta enviada','El cliente verá tu oferta y podrá aceptarla o negociar.');
  await cargarTodo();
}

async function aceptarContraoferta(ofertaId) {
  showConfirm('✅','¿Aceptás el precio?','El cliente recibirá el código de verificación una vez que confirme el pago.', async () => {
    const r = await api('/api/ofertas/' + ofertaId + '/acordar', 'POST', { cliente_id: null });
    if (r.error) return showInfo('❌','Error',r.error);
    await cargarTodo();
    irATrabajos('ofertas');
    showInfo('✅','Precio acordado','El cliente debe confirmar el trabajo para habilitar el chat.');
  });
}

async function enviarContraofertaSocio(ofertaId) {
  const precio = parseFloat(document.getElementById('neg-val-'+ofertaId).value);
  if (!Number.isFinite(precio) || precio<1001) return showInfo('⚠️','Precio inválido','Ingresá un precio mayor a $1.000.');
  await api('/api/ofertas/' + ofertaId + '/contraoferta', 'POST', { nuevo_precio: precio, rol: 'socio' });
  showInfo('✅','Contraoferta enviada','El cliente verá tu propuesta.');
  await cargarTodo();
}

async function rechazarTrabajo(ofertaId) {
  showConfirm('⚠️','¿Rechazar trabajo?','Tu reputación bajará 0.2 puntos por rechazar este trabajo.', async () => {
    const r = await api('/api/ofertas/' + ofertaId + '/rechazar', 'POST');
    if (r.error) return showInfo('❌','Error',r.error);
    await cargarTodo();
  }, 'Sí, rechazar');
}

async function eliminarOferta(ofertaId) {
  showConfirm('🗑️','¿Eliminar de tu vista?','El trabajo cancelado desaparecerá de tu lista.', async () => {
    misOfertas = misOfertas.filter(o => o.id !== ofertaId);
    renderMisOfertas();
  }, 'Sí, eliminar');
}

function nextDigit(c, n) { if (c.value && n) document.getElementById(n)?.focus(); }
function prevDigit(e, p, c) { if (e.key==='Backspace' && !document.getElementById(c).value && p) document.getElementById(p).focus(); }

async function verificarCodigo(tareaId) {
  const digits = [0,1,2,3].map(i => document.getElementById(`cod-${tareaId}-${i}`).value).join('');
  if (digits.length < 4) return showCodErr(tareaId, 'Ingresá los 4 dígitos.');
  try {
    const r = await api('/api/pedidos/' + tareaId + '/verificar-codigo', 'POST', { codigo: digits });
    if (r.error) return showCodErr(tareaId, r.error);
    showInfo('🎉','¡Código verificado!', r.mensaje);
    const users = await api('/api/usuarios');
    const fresco = Array.isArray(users) ? users.find(x => x.email === usuario.email) : null;
    if (fresco) { delete fresco.password_hash; usuario = fresco; localStorage.setItem('chamba_user', JSON.stringify(fresco)); }
    await cargarTodo();
    renderSaldo();
  } catch(e) { showCodErr(tareaId, 'Error al verificar. Intentá de nuevo.'); }
}
function showCodErr(id, msg) { const el=document.getElementById('cod-err-'+id); if(el){el.textContent=msg;el.style.display='block';} }

async function cargarMensajes(pedidoId) {
  try { await Chamba.chat(pedidoId,api,usuario,document.getElementById('chat-in-'+pedidoId)?.dataset.rol||'socio'); }
  catch(e) { Chamba.notice('No se pudo actualizar el chat. Tus mensajes se conservan.'); }
}

async function enviarMsg(tareaId) {
  const input = document.getElementById('chat-in-' + tareaId);
  const contenido = input.value.trim(); if (!contenido) return;
  const pedido = pedidosCache[tareaId];
  const rol = pedido && pedido.usuario_id === usuario.id ? 'cliente' : 'socio';
  const r = await api('/api/mensajes', 'POST', { pedido_id: tareaId, autor: usuario.nombre, rol, contenido, client_message_id:Chamba.messageId(tareaId,contenido) });
  if (r.error) { showInfo('❌','Error',r.error); return; }
  if(input.value.trim()===contenido){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}
  Chamba.messageDone(tareaId);
  await cargarMensajes(tareaId);
}

function renderSaldo() {
  document.getElementById('saldo-disponible').textContent = fmt(usuario.saldo_disponible||0);
  document.getElementById('saldo-bloqueado').textContent = fmt(usuario.saldo_bloqueado||0);
}

function starsHtml(n) { return n ? '⭐'.repeat(Math.min(5, Math.round(n))) + ' ' + n : 'Sin calificaciones'; }

function renderActividadReciente() {
  const box = document.getElementById('actividad-reciente');
  if (!box) return;
  if (!misTareas.length && !misPedidosCliente.length) {
    box.innerHTML = Chamba.html('<div style="text-align:center;padding:20px 10px"><div style="font-size:14px;color:var(--text-mid)">Todavía no tenés actividad en ChamBA.</div></div>');
    return;
  }
  const eventosTrabajo = misTareas.map(t => {
    if (t.estado === 'completado') return { icon: '✅', texto: `Completaste el trabajo de <strong>${Chamba.escape(t.servicio)}</strong> — consultá el estado del saldo en Reclamos y saldo`, fecha: t.created_at };
    if (t.estado === 'en_proceso') return { icon: '⚙️', texto: `Estás realizando el trabajo de <strong>${Chamba.escape(t.servicio)}</strong> — cobrarás ${Chamba.escape(fmt(t.precio_socio))}`, fecha: t.created_at };
    return { icon: '📤', texto: `Ofertaste en un trabajo de <strong>${Chamba.escape(t.servicio)}</strong>`, fecha: t.created_at };
  });
  const eventosServicio = misPedidosCliente.map(p => {
    const ofertasPedido = (todasOfertasCliente[p.id] || []).filter(o => o.estado !== 'rechazada');
    if (p.estado === 'cancelado') return { icon: '🗑️', texto: `Cancelaste tu solicitud de <strong>${Chamba.escape(p.servicio)}</strong>`, fecha: p.created_at };
    if (p.estado === 'completado') return { icon: '✅', texto: `Completaste el trabajo de <strong>${Chamba.escape(p.servicio)}</strong>${Chamba.escape(p.calificado ? '' : ' — todavía no lo calificaste')}`, fecha: p.created_at };
    if (p.estado === 'en_proceso') return { icon: '⚙️', texto: `<strong>${Chamba.escape(p.servicio)}</strong> está en proceso — pagaste ${Chamba.escape(fmt(p.precio_cliente))}`, fecha: p.created_at };
    if (ofertasPedido.length) return { icon: '💬', texto: `Recibiste ${Chamba.escape(ofertasPedido.length)} oferta${Chamba.escape(ofertasPedido.length!==1?'s':'')} para <strong>${Chamba.escape(p.servicio)}</strong>`, fecha: p.created_at };
    return { icon: '🔍', texto: `Publicaste un pedido de <strong>${Chamba.escape(p.servicio)}</strong>`, fecha: p.created_at };
  });
  const eventos = [...eventosTrabajo, ...eventosServicio].sort((a,b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 6);
  box.innerHTML = Chamba.html(eventos.map(e => `<div class="actividad-item">
    <div class="actividad-icon">${Chamba.escape(e.icon)}</div>
    <div><div class="actividad-texto">${e.texto}</div><div class="actividad-fecha">${Chamba.escape(fmtDate(e.fecha))}</div></div>
  </div>`).join(''));
}

// ── NECESITO UN SERVICIO (el socio actuando como cliente) ──
function renderCliTodo() {
  const esperando = misPedidosCliente.filter(p => p.estado === 'nuevo' && (!todasOfertasCliente[p.id] || !todasOfertasCliente[p.id].filter(o => o.estado !== 'rechazada').length));
  const negociacion = misPedidosCliente.filter(p => p.estado === 'nuevo' && todasOfertasCliente[p.id] && todasOfertasCliente[p.id].filter(o => o.estado !== 'rechazada').length > 0);
  const proceso = misPedidosCliente.filter(p => p.estado === 'en_proceso');
  const completados = misPedidosCliente.filter(p => p.estado === 'completado');
  const cancelados = misPedidosCliente.filter(p => p.estado === 'cancelado');

  setBadge('badge-cli-esperando', esperando.length, 'sub-serv-esperando');
  setBadge('badge-cli-negociacion', negociacion.length, 'sub-serv-negociacion');
  setBadge('badge-cli-proceso', proceso.length, 'sub-serv-proceso');
  const badgeServTotal = document.getElementById('badge-servicio-total');
  badgeServTotal.textContent = negociacion.length;
  badgeServTotal.style.display = negociacion.length > 0 ? 'inline-flex' : 'none';

  document.getElementById('lista-cli-esperando').innerHTML = Chamba.html([...esperando, ...cancelados].map(p => renderCardCliEsperando(p)).join('') || '<div class="empty">No tenés trabajos esperando ofertas.</div>');
  document.getElementById('lista-cli-negociacion').innerHTML = Chamba.html(negociacion.map(p => renderCardCliNegociacion(p)).join('') || '<div class="empty">No tenés trabajos en negociación.</div>');

  const chatsEnCurso = {};
  document.querySelectorAll('[id^="chat-in-"]').forEach(inp => { if (inp.value) chatsEnCurso[inp.id] = inp.value; });
  document.getElementById('lista-cli-proceso').innerHTML = Chamba.html(proceso.map(p => renderCardCliProceso(p)).join('') || '<div class="empty">No tenés trabajos en proceso.</div>');
  Object.entries(chatsEnCurso).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });

  document.getElementById('lista-cli-completados').innerHTML = Chamba.html(completados.map(p => renderCardCliCompletado(p)).join('') || '<div class="empty">No tenés trabajos completados aún.</div>');
  proceso.forEach(p => cargarMensajes(p.id));
}

function renderCardCliEsperando(p) {
  const cancelado = p.estado === 'cancelado';
  return `<div class="trabajo-card" style="position:relative">
    ${cancelado ? `<div class="wasted-overlay"><div class="wasted-text">CANCELADO</div><button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){eliminarPedidoCliente(`${p.id}`)})}>Eliminar</button></div>` : ''}
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(p.servicio)}</div><span class="badge badge-gray">Esperando ofertas</span></div>
    <div class="trabajo-desc">${Chamba.escape(p.descripcion||'')}</div>
    ${p.precio_sugerido_ia ? `<div class="trabajo-ia">🤖 Precio sugerido: <strong>${Chamba.escape(fmt(p.precio_sugerido_ia))}</strong></div>` : ''}
    <div class="trabajo-footer">
      <span style="font-size:12px;color:var(--text-soft)">📅 ${Chamba.escape(fmtDate(p.created_at))}</span>
      ${!cancelado ? `<button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){cancelarPedidoCliente(`${p.id}`)})}>Eliminar solicitud</button>` : ''}
    </div>
  </div>`;
}

function renderCardCliNegociacion(p) {
  const ofertas = (todasOfertasCliente[p.id] || []).filter(o => o.estado !== 'rechazada');
  const sorted = [...ofertas].sort((a,b) => (b.rep_promedio||0) - (a.rep_promedio||0) || a.precio_ofertado - b.precio_ofertado);
  return `<div class="trabajo-card con-ofertas">
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(p.servicio)}</div><span class="badge badge-amber">${Chamba.escape(ofertas.length)} oferta${Chamba.escape(ofertas.length!==1?'s':'')}</span></div>
    <div class="trabajo-desc">${Chamba.escape(p.descripcion||'')}</div>
    ${p.precio_sugerido_ia ? `<div class="trabajo-ia">🤖 Precio sugerido: <strong>${Chamba.escape(fmt(p.precio_sugerido_ia))}</strong></div>` : ''}
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
            <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){aceptarOfertaCliente(`${o.id}`,`${p.id}`,(o.precio_ofertado))})}>✅ Aceptar ${Chamba.escape(fmt(o.precio_ofertado))}</button>
            <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){toggleNegCliente(`neg-cli-${o.id}`)})}>💬 Contraofertar</button>
            <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){buscarOtroSocioCliente(`${p.id}`)})}>🔄 Buscar otro socio</button>
          </div>
          <div id="neg-cli-${Chamba.escape(o.id)}" style="display:none" class="neg-box">
            <div style="font-size:13px;font-weight:600;color:var(--amber);margin-bottom:8px">Tu contraoferta (solo precio)</div>
            <div class="neg-precio-input">
              <input type="number" id="neg-cli-val-${Chamba.escape(o.id)}" placeholder="Tu precio máximo..."/>
              <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){enviarContraofertaCliente(`${o.id}`)})}>Enviar</button>
            </div>
          </div>` : ''}
        </div>`).join('')}
    </div>
    <div class="trabajo-footer">
      <span style="font-size:12px;color:var(--text-soft)">📅 ${Chamba.escape(fmtDate(p.created_at))}</span>
      <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){cancelarPedidoCliente(`${p.id}`)})}>Eliminar solicitud</button>
    </div>
  </div>`;
}

function renderCardCliProceso(p) {
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
    ${p.codigo_usado ? '<div style="background:var(--teal);color:#fff;border-radius:8px;padding:10px 14px;font-size:14px;font-weight:500;margin:10px 0">✅ Código verificado — consultá el estado del dinero en Reclamos y saldo</div>' : ''}
    <div style="margin-top:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">💬 Chat con el socio</div>
      <div class="chat-box">
        <div class="chat-messages" id="chat-${Chamba.escape(p.id)}"><div style="text-align:center;color:var(--text-soft);font-size:13px;padding:14px">Cargando...</div></div>
        <div class="chat-input-row">
          <input class="chat-input" id="chat-in-${Chamba.escape(p.id)}" data-rol="cliente" placeholder="Coordiná día, hora y lugar..." ${Chamba.bind("keydown",function(event){if(event.key==='Enter')enviarMsg(`${p.id}`)})}/>
          <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){enviarMsg(`${p.id}`)})}>Enviar</button>
        </div>
      </div>
    </div>
    ${renderBloqueDisputa(p.id)}
  </div>`;
}

function renderCardCliCompletado(p) {
  return `<div class="trabajo-card">
    <div class="trabajo-header"><div class="trabajo-servicio">${Chamba.escape(p.servicio)}</div><span class="badge badge-green">✅ Completado</span></div>
    <div class="trabajo-desc">${Chamba.escape(p.descripcion||'')}</div>
    <div style="font-size:14px;color:var(--teal-dark);font-weight:500;margin-bottom:10px">Precio final: ${Chamba.escape(fmt(p.precio_cliente))} · ${Chamba.escape(fmtDate(p.created_at))}</div>
    ${p.calificado ? `<div style="background:#fafafa;border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--text-soft);font-size:14px">✅ Ya calificaste a este socio. ¡Gracias!</div>` : p.profesional_id ? `<div style="background:#fafafa;border:1px solid var(--border);border-radius:10px;padding:14px">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">⭐ Calificá al socio</div>
      <div class="stars-input" id="stars-${Chamba.escape(p.id)}">${[1,2,3,4,5].map(n=>`<button class="star-btn" ${Chamba.bind("click",function(event){selStar(`${p.id}`,(n))})}>⭐</button>`).join('')}</div>
      <div style="margin-top:10px" id="tags-${Chamba.escape(p.id)}">${TAGS_CALIFICACION.map(tag=>`<button class="tag-chip" ${Chamba.bind("click",function(event){toggleTag(`${p.id}`,`${tag}`)})}>${Chamba.escape(tag)}</button>`).join('')}</div>
      <button class="btn btn-teal btn-sm" style="margin-top:10px" ${Chamba.bind("click",function(event){calificar(`${p.id}`,`${p.profesional_id}`)})}>Enviar calificación</button>
    </div>` : ''}
    ${renderBloqueDisputa(p.id)}
  </div>`;
}

function toggleNegCliente(id) { const el=document.getElementById(id); el.style.display=el.style.display==='none'?'block':'none'; }

async function aceptarOfertaCliente(ofertaId, pedidoId, precio) {
  if(!await Custodia.confirmPayment(precio))return;
  await api('/api/ofertas/'+ofertaId+'/aceptar','POST',{acepto_aviso:true,aviso_version:'custodia-v2'});
  await cargarTodo();irAServicio('proceso');
}

async function enviarContraofertaCliente(ofertaId) {
  const precio = parseFloat(document.getElementById('neg-cli-val-' + ofertaId).value);
  if (!Number.isFinite(precio) || precio<1001) return showInfo('⚠️', 'Precio inválido', 'Ingresá un precio mayor a $1.000.');
  await api('/api/ofertas/' + ofertaId + '/contraoferta', 'POST', { nuevo_precio: precio, rol: 'cliente' });
  document.getElementById('neg-cli-' + ofertaId).style.display = 'none';
  showInfo('✅', 'Contraoferta enviada', 'El socio verá tu propuesta y podrá aceptarla o responder con otro precio.');
  await cargarTodo();
}

async function buscarOtroSocioCliente(pedidoId) {
  showConfirm('🔄', '¿Buscar otro socio?', 'Se cancelarán todas las ofertas actuales y el trabajo volverá a estar disponible para otros socios.',
    async () => { await api('/api/pedidos/' + pedidoId + '/buscar-otro-socio', 'POST'); await cargarTodo(); });
}

async function cancelarPedidoCliente(pedidoId) {
  showConfirm('🗑️', '¿Eliminar solicitud?', 'Los socios que ofertaron verán que el trabajo fue cancelado.',
    async () => { await api('/api/pedidos/' + pedidoId, 'PATCH', { estado: 'cancelado' }); await cargarTodo(); }, 'Sí, eliminar');
}

async function eliminarPedidoCliente(pedidoId) {
  showConfirm('🗑️', '¿Eliminar de tu vista?', 'El trabajo cancelado desaparecerá de tu lista.',
    async () => { await api('/api/pedidos/' + pedidoId, 'DELETE'); await cargarTodo(); }, 'Sí, eliminar');
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

async function consultarIACliente() {
  const servicio = document.getElementById('cli-p-servicio').value;
  const desc = document.getElementById('cli-p-desc').value.trim();
  if (!servicio || !desc) return showInfo('⚠️', 'Falta información', 'Completá el servicio y la descripción primero.');
  const box = document.getElementById('cli-ia-sugerencia');
  box.style.display = 'block'; box.innerHTML = Chamba.html('🤖 Consultando a la IA...');
  try {
    const r = await api('/api/analizar', 'POST', { servicio, descripcion: desc, fotos:(await Chamba.draftPhotos()).map(url=>url.split(',')[1]) });
    if (r.error || r.precio_cliente == null) { box.innerHTML = Chamba.html('⚠️ No pudimos consultar la IA en este momento. Probá de nuevo en un momento.'); return; }
    iaSugerenciaCliente = r;
    box.innerHTML = Chamba.html(renderTarjetaIA(r));
    if (r.urgencia) {
      const chip = document.querySelector(`.chip-btn[data-urgencia="${r.urgencia}"]`);
      if (chip) elegirUrgenciaCliente(r.urgencia, chip);
    }
  } catch(e) { box.innerHTML = Chamba.html('⚠️ No pudimos consultar la IA en este momento. Probá de nuevo en un momento.'); }
}

function elegirUrgenciaCliente(valor, btn) {
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

async function publicarTrabajoCliente() {
  const servicio = document.getElementById('cli-p-servicio').value;
  const descripcion = document.getElementById('cli-p-desc').value.trim();
  const ubicacion_id = document.getElementById('cli-p-ubicacion').value;
  document.getElementById('cli-pedido-ok').style.display = 'none';
  document.getElementById('cli-pedido-err').style.display = 'none';
  if (!servicio || !descripcion) { const e=document.getElementById('cli-pedido-err'); e.textContent='Completá todos los campos.'; e.style.display='block'; return; }
  if (!ubicacion_id) { const e=document.getElementById('cli-pedido-err'); e.textContent='Elegí dónde es el trabajo.'; e.style.display='block'; return; }
  const ubicacion = misUbicaciones.find(u => u.id === ubicacion_id);
  showConfirm('📍', 'Confirmá la zona del trabajo',
    `Estás por solicitar un trabajo de ${servicio} en la zona "${ubicacion?.etiqueta}" (${ubicacion?.direccion}). Los socios cercanos a esa zona van a ver tu pedido primero. ¿Confirmás?`,
    () => confirmarPublicarTrabajoCliente(servicio, descripcion, ubicacion_id), '✅ Sí, publicar');
}

async function confirmarPublicarTrabajoCliente(servicio, descripcion, ubicacion_id) {
  const chipUrgencia = document.querySelector('.chip-btn[data-urgencia].active');
  const urgencia = chipUrgencia ? chipUrgencia.dataset.urgencia : 'Media';
  const body = { servicio, descripcion, ubicacion_id, estado: 'nuevo', urgencia };
  if (iaSugerenciaCliente) body.precio_sugerido_ia = iaSugerenciaCliente.precio_cliente;
  try {
    const r = await api('/api/pedidos', 'POST', body);
    if (r.error) throw new Error(r.error);
    document.getElementById('cli-pedido-ok').style.display = 'block';
    setTimeout(() => { document.getElementById('cli-pedido-ok').style.display = 'none'; }, 8000);
    document.getElementById('cli-p-servicio').value = '';
    document.getElementById('cli-p-desc').value = '';
    Chamba.clearDraft();document.getElementById('draft-photos')?.remove();
    document.getElementById('cli-ia-sugerencia').style.display = 'none';
    document.querySelectorAll('.chip-btn[data-urgencia]').forEach(b => b.classList.remove('active'));
    document.querySelector('.chip-btn[data-urgencia="Media"]').classList.add('active');
    iaSugerenciaCliente = null;
    await cargarTodo();
  } catch(e) { const el=document.getElementById('cli-pedido-err'); el.textContent=e.message||'Error al publicar.'; el.style.display='block'; }
}

function renderPerfil() {
  document.getElementById('perfil-grid').innerHTML = Chamba.html(`
    <div class="form-group"><label for="perfil-nombre">Nombre</label><input type="text" id="perfil-nombre" value="${Chamba.escape(usuario.nombre||'')}"/></div>
    <div><div class="perfil-label">Email</div><div class="perfil-val">${Chamba.escape(usuario.email)}</div></div>
    <div class="form-group"><label for="perfil-telefono">Teléfono</label><input type="text" id="perfil-telefono" value="${Chamba.escape(usuario.telefono||'')}"/></div>
    <div><div class="perfil-label">Especialidad</div><div class="perfil-val">${Chamba.escape(usuario.especialidad||'—')}</div></div>
    <div><div class="perfil-label">DNI</div><div class="perfil-val">${Chamba.escape(usuario.dni||'—')}</div></div>
    <div><div class="perfil-label">Matrícula</div><div class="perfil-val">${Chamba.escape(usuario.matricula||'—')}</div></div>
    <div><div class="perfil-label">Reputación</div><div class="perfil-val">${Chamba.escape(usuario.promedio_estrellas ? usuario.promedio_estrellas+' ⭐ ('+(usuario.total_calificaciones||0)+' reviews)' : 'Sin calificaciones aún')}</div></div>
    <div><div class="perfil-label">Trabajos completados</div><div class="perfil-val">${Chamba.escape(usuario.trabajos_completados||0)}</div></div>
    <div><div class="perfil-label">Estado</div><div class="perfil-val">${Chamba.escape(usuario.estado==='aprobado'?'✅ Aprobado':'⏳ Pendiente')}</div></div>`);
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

// ── UBICACIONES: buscar → confirmar en mapa → detalles (estilo PedidosYa) ──
let misUbicaciones = [];
let misDisputas = [];

// ── DISPUTAS (reportar un problema) ──
async function cargarDisputas() {
  try { misDisputas = await api('/api/disputas'); if (!Array.isArray(misDisputas)) misDisputas = []; } catch(e) { misDisputas = []; }
}

function renderBloqueDisputa(pedidoId) {
 return `<p><a href="/reclamos?pedido=${Chamba.escape(pedidoId)}">Reclamos, descargos y estado del dinero →</a></p>`;
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
let mapaPicker = null, marcadorPicker = null;
let ubSugerenciasCache = [];
let ubBusquedaTimer = null;
let ubSeleccionActual = null; // { direccion, lat, lng }
let ubEditandoId = null; // si no es null, "Guardar" hace PATCH en vez de POST

function direccionCorta(direccionCompleta) {
  const partes = (direccionCompleta || '').split(',').map(p => p.trim()).filter(Boolean);
  if (!partes.length) return direccionCompleta || '';
  if (partes.length >= 2 && /^\d+[a-zA-Z]?$/.test(partes[0])) return `${partes[1]} ${partes[0]}`;
  return partes.slice(0, 2).join(', ');
}

async function cargarUbicaciones() {
  try {
    const ubs = await api('/api/ubicaciones');
    misUbicaciones = Array.isArray(ubs) ? ubs : [];
    const box = document.getElementById('lista-ubicaciones');
    if (!box) return;
    const tipoLabel = { residencia: '🏠 Donde vivo', trabajo: '🔧 Zona de trabajo', otra: '📍 Otra' };
    box.innerHTML = Chamba.html(misUbicaciones.length ? misUbicaciones.map(u => `
      <div class="ubicacion-item">
        <div class="ubicacion-info">
          <div class="etiqueta">${Chamba.escape(u.etiqueta)} <span class="badge badge-gray" style="margin-left:6px">${Chamba.escape(tipoLabel[u.tipo]||u.tipo)}</span> ${u.predeterminada ? '<span class="badge badge-green" style="margin-left:4px">Predeterminada</span>' : ''}</div>
          <div class="direccion">${Chamba.escape(direccionCorta(u.direccion))}${Chamba.escape(u.piso_depto ? ' — ' + u.piso_depto : '')}</div>
        </div>
        <div class="ubicacion-acciones">
          ${!u.predeterminada ? `<button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){marcarPredeterminada(`${u.id}`)})}>Usar como predeterminada</button>` : ''}
          <button class="btn btn-ghost btn-sm" ${Chamba.bind("click",function(event){editarUbicacion(`${u.id}`)})}>✏️</button>
          <button class="btn btn-red btn-sm" ${Chamba.bind("click",function(event){eliminarUbicacion(`${u.id}`)})}>🗑️</button>
        </div>
      </div>`).join('') : '<div style="font-size:13px;color:var(--text-soft)">Todavía no agregaste ninguna ubicación.</div>');
    const select = document.getElementById('cli-p-ubicacion');
    if (select) {
      const actual = select.value;
      select.innerHTML = Chamba.html('<option value="">Elegí una ubicación...</option>' + misUbicaciones.map(u => `<option value="${Chamba.escape(u.id)}">${Chamba.escape(u.etiqueta)} — ${Chamba.escape(u.direccion)}</option>`).join(''));
      if (actual) select.value = actual;
      else { const pred = misUbicaciones.find(u => u.predeterminada); if (pred) select.value = pred.id; }
    }
  } catch(e) {}
}

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
  document.querySelector('.chip-btn[data-tipo="trabajo"]').classList.add('active');
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
  const tipo = tipoBtn ? tipoBtn.dataset.tipo : 'trabajo';
  const nombres = { residencia: 'Casa', trabajo: 'Zona de trabajo' };
  const etiqueta = tipo === 'otra' ? document.getElementById('ub-etiqueta-custom').value.trim() : nombres[tipo];
  if (tipo === 'otra' && !etiqueta) return showInfo('⚠️', 'Faltan datos', 'Contanos qué ubicación es.');
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
  showInfo('✅', ubEditandoId ? 'Ubicación actualizada' : 'Ubicación agregada', 'Ya la vamos a tener en cuenta para mostrarte trabajos cercanos.');
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
  showConfirm('🗑️', '¿Eliminar ubicación?', 'No la vamos a tener más en cuenta para mostrarte trabajos cercanos.', async () => {
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

async function cargarSolicitudesMatricula() {
  try {
    const sols = await api('/api/solicitudes-matricula?socio_id=' + usuario.id);
    if (!Array.isArray(sols)) return;
    // Las pendientes se muestran en la lista de abajo
    const box = document.getElementById('lista-solicitudes-matricula');
    const pendientes = sols.filter(s => s.estado === 'pendiente');
    if (box) {
      box.innerHTML = Chamba.html(pendientes.length
        ? '<div style="font-size:13px;font-weight:600;color:var(--text-mid);margin-bottom:8px">Pendientes de revisión</div>' +
          pendientes.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--border)">
            <div><div style="font-size:14px;font-weight:500">${Chamba.escape(s.matricula_nueva)}</div><div style="font-size:12px;color:var(--text-soft)">${Chamba.escape(s.especialidad||'')}${Chamba.escape(s.matricula_organismo ? ' · ' + s.matricula_organismo : '')}</div></div>
            <span class="badge badge-amber">⏳ Pendiente</span>
          </div>`).join('')
        : '');
    }
    // Las recién resueltas (aprobada/rechazada) y no vistas se avisan con una notificación arriba
    const noVistas = sols.filter(s => s.estado !== 'pendiente' && !s.visto);
    if (noVistas.length) mostrarNotificacionMatricula(noVistas);
  } catch(e) {}
}

function mostrarNotificacionMatricula(sols) {
  const aprobadas = sols.filter(s => s.estado === 'aprobada');
  const rechazadas = sols.filter(s => s.estado === 'rechazada');
  let partes = [];
  if (aprobadas.length) partes.push(`✅ Se aprobó tu matrícula: ${aprobadas.map(s=>s.matricula_nueva).join(', ')}`);
  if (rechazadas.length) partes.push(`❌ Se rechazó tu solicitud de matrícula: ${rechazadas.map(s=>s.matricula_nueva).join(', ')}`);
  const banner = document.getElementById('notif-banner');
  banner.className = rechazadas.length && !aprobadas.length ? 'notif-rechazada' : 'notif-aprobada';
  banner.querySelector('span').textContent = partes.join(' · ');
  banner.style.display = 'flex';
  banner.dataset.ids = sols.map(s => s.id).join(',');
}

async function cerrarNotificacionMatricula() {
  const banner = document.getElementById('notif-banner');
  const ids = (banner.dataset.ids || '').split(',').filter(Boolean);
  banner.style.display = 'none';
  await Promise.all(ids.map(id => api(`/api/solicitudes-matricula/${id}/visto`, 'PATCH')));
}

// ── VERIFICACIÓN DE IDENTIDAD (otra forma de demostrar la profesión) ──
function leerArchivoComoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // saca el prefijo data:...;base64,
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function enviarVerificacionIdentidad() {
  const inputFacturas = document.getElementById('verif-facturas');
  const inputMono = document.getElementById('verif-monotributo');
  const archivosFacturas = Array.from(inputFacturas.files || []);
  const archivosMono = Array.from(inputMono.files || []);

  if (!archivosFacturas.length) return showInfo('⚠️', 'Faltan las facturas', 'Subí al menos 1 archivo con tus últimas 3 facturas a clientes (puede ser un solo PDF con las 3, o hasta 4 archivos sueltos).');
  if (archivosFacturas.length > 4) return showInfo('⚠️', 'Demasiados archivos', 'Subí como máximo 4 archivos en la sección de facturas.');
  if (!archivosMono.length) return showInfo('⚠️', 'Falta el comprobante de monotributo', 'Subí la última factura pagada de tu monotributo.');
  if (archivosMono.length > 1) return showInfo('⚠️', 'Un solo archivo', 'El comprobante de monotributo es un único archivo.');

  const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const TAMANO_MAX = 8 * 1024 * 1024; // 8MB
  for (const f of [...archivosFacturas, ...archivosMono]) {
    if (!TIPOS_PERMITIDOS.includes(f.type)) return showInfo('⚠️', 'Formato no permitido', `"${f.name}" no es una imagen (JPG/PNG/WEBP) ni un PDF.`);
    if (f.size > TAMANO_MAX) return showInfo('⚠️', 'Archivo muy pesado', `"${f.name}" pesa más de 8MB. Subí una versión más liviana.`);
  }

  const btn = document.getElementById('verif-btn-enviar');
  btn.disabled = true; btn.textContent = 'Subiendo...';
  try {
    const facturas = [];
    for (const f of archivosFacturas) {
      const data = await leerArchivoComoBase64(f);
      facturas.push({ data, mime: f.type || 'application/octet-stream' });
    }
    const monoFile = archivosMono[0];
    const monotributo = { data: await leerArchivoComoBase64(monoFile), mime: monoFile.type || 'application/octet-stream' };

    const r = await api('/api/verificaciones-identidad', 'POST', { monotributo, facturas });
    if (r.error) { showInfo('❌', 'Error', r.error); return; }
    inputFacturas.value = ''; inputMono.value = '';
    showInfo('✅', 'Comprobantes enviados', 'El equipo de ChamBA los va a revisar.');
    cargarVerificacionesIdentidad();
  } catch(e) {
    showInfo('❌', 'Error', 'No se pudieron subir los archivos. Probá con imágenes más livianas.');
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar comprobantes';
  }
}

async function cargarVerificacionesIdentidad() {
  try {
    const rows = await api('/api/verificaciones-identidad');
    const box = document.getElementById('lista-verificaciones-identidad');
    if (!box || !Array.isArray(rows)) return;
    const badge = { pendiente: 'badge-amber', aprobada: 'badge-green', rechazada: 'badge-red' };
    const label = { pendiente: '⏳ Pendiente de revisión', aprobada: '✅ Aprobado', rechazada: '❌ Rechazado' };
    box.innerHTML = Chamba.html(rows.length ? '<div style="font-size:13px;font-weight:600;color:var(--text-mid);margin-bottom:8px">Tus envíos</div>' +
      rows.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--border)">
        <div style="font-size:13px">${Chamba.escape(fmtDate(r.created_at))} · ${Chamba.escape((r.urls||[]).length)} archivo${Chamba.escape((r.urls||[]).length!==1?'s':'')}</div>
        <span class="badge ${Chamba.escape(badge[r.estado]||'badge-gray')}">${Chamba.escape(label[r.estado]||r.estado)}</span>
      </div>`).join('') : '');
  } catch(e) {}
}

let foroPosts = [];
async function cargarForo() {
  try { foroPosts = await api('/api/foro'); if (!Array.isArray(foroPosts)) foroPosts = []; renderForo(); } catch(e) {}
}
function renderForo() {
  const principales = foroPosts.filter(p => !p.parent_id);
  const respuestas = foroPosts.filter(p => p.parent_id);
  document.getElementById('foro-posts').innerHTML = Chamba.html(principales.length ? principales.map(p => {
    const resps = respuestas.filter(r => r.parent_id === p.id);
    return `<div class="foro-post">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div><span style="font-size:13px;font-weight:600">${Chamba.escape(p.autor_nombre)}</span><span class="tipo-chip tipo-${Chamba.escape(p.autor_tipo)}">${Chamba.escape(p.autor_tipo)}</span></div>
        <div style="font-size:12px;color:var(--text-soft)">${Chamba.escape(fmtDate(p.created_at))}</div>
      </div>
      <div style="font-size:15px;font-weight:600;margin-bottom:4px">${Chamba.escape(p.titulo)}</div>
      <div style="font-size:14px;color:var(--text-mid);line-height:1.6;margin-bottom:10px">${Chamba.escape(p.contenido)}</div>
      ${resps.map(r=>`<div class="foro-respuesta"><div class="foro-resp-autor">${Chamba.escape(r.autor_nombre)} <span class="tipo-chip tipo-${Chamba.escape(r.autor_tipo)}">${Chamba.escape(r.autor_tipo)}</span> · ${Chamba.escape(fmtDate(r.created_at))}</div>${Chamba.escape(r.contenido)}</div>`).join('')}
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" ${Chamba.bind("click",function(event){toggleRespForm(`resp-form-${p.id}`)})}>💬 Responder</button>
      <div class="foro-resp-form" id="resp-form-${Chamba.escape(p.id)}">
        <div style="display:flex;gap:8px;margin-top:6px">
          <input type="text" id="resp-input-${Chamba.escape(p.id)}" placeholder="Escribí tu respuesta..." ${Chamba.bind("keydown",function(event){if(event.key==='Enter')responder(`${p.id}`)})}/>
          <button class="btn btn-teal btn-sm" ${Chamba.bind("click",function(event){responder(`${p.id}`)})}>Enviar</button>
        </div>
      </div>
    </div>`;
  }).join('') : '<div class="empty">No hay publicaciones aún.</div>');
}
function toggleRespForm(id) { const el=document.getElementById(id); el.style.display=el.style.display==='none'||el.style.display===''?'block':'none'; }
async function responder(parentId) {
  const input = document.getElementById('resp-input-' + parentId);
  const contenido = input.value.trim(); if (!contenido) return;
  const parent = foroPosts.find(p => p.id === parentId);
  const r = await api('/api/foro', 'POST', { autor_id: usuario.id, autor_nombre: usuario.nombre, autor_tipo: 'socio', titulo: 'Re: '+(parent?.titulo||''), contenido, parent_id: parentId });
  if (r.error) return showInfo('❌', 'Error', r.error);
  input.value = '';
  toggleRespForm('resp-form-' + parentId);
  await cargarForo();
}
async function publicarForo() {
  const titulo = document.getElementById('foro-titulo').value.trim();
  const contenido = document.getElementById('foro-body').value.trim();
  if (!titulo || !contenido) return;
  await api('/api/foro', 'POST', { autor_id: usuario.id, autor_nombre: usuario.nombre, autor_tipo: 'socio', titulo, contenido });
  document.getElementById('foro-titulo').value = '';
  document.getElementById('foro-body').value = '';
  await cargarForo();
}

function recuperarBorrador(){
 try {
  const draft=JSON.parse(sessionStorage.getItem('chamba_request_draft')||'null');if(!draft)return;
  const service=document.getElementById('cli-p-servicio'),description=document.getElementById('cli-p-desc');
  if(!service||!description)return;
  if(draft.servicio && [...service.options].some(o=>o.value===draft.servicio))service.value=draft.servicio;
  if(typeof draft.descripcion==='string'&&!description.value)description.value=draft.descripcion;
  Chamba.showDraftPhotos(description);
  if(draft.diagnostico)iaSugerenciaCliente=draft.diagnostico;
  irAServicio('publicar');
 }catch{}
}
document.addEventListener('input',e=>{
 if(!['cli-p-desc','cli-p-servicio'].includes(e.target.id))return;
 sessionStorage.setItem('chamba_request_draft',JSON.stringify({servicio:document.getElementById('cli-p-servicio').value,descripcion:document.getElementById('cli-p-desc').value}));
});
