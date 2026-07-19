const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
require('dotenv').config();
const { emailBienvenidaCliente, emailSocioAprobado, emailSocioRechazado, emailPedidoRecibido } = require('./emailService');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Red de seguridad: si algo falla en una ruta y no fue capturado, no tumbar el servidor.
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled error:', err?.message || err);
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const COMISION = 0.20;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error('⚠️  Falta la variable de entorno JWT_SECRET — configurala en Railway.');

// Exige que la persona esté logueada. Guarda sus datos (id, tipo, email) en req.usuario.
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
  try {
    req.usuario = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Tu sesión expiró. Iniciá sesión de nuevo.' });
  }
}
// Exige que además sea admin.
function soloAdmin(req, res, next) {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({ error: 'No tenés permiso para hacer esto.' });
  next();
}

const sbH = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
const sb = async (path, method='GET', body=null) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: body ? { ...sbH, 'Prefer': 'return=representation' } : sbH,
    body: body ? JSON.stringify(body) : null
  });
  const data = await r.json();
  if (!r.ok) {
    console.error(`❌ Supabase error [${method} ${path}]:`, JSON.stringify(data));
    const err = new Error(data?.message || 'Error en la base de datos');
    err.supabase = data;
    err.status = r.status;
    throw err;
  }
  return data;
};

// Convierte una dirección de texto en coordenadas (lat/lng) usando OpenStreetMap. Devuelve null si no la encuentra.
async function geocodificar(direccion) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(direccion)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ChamBA-App (contacto@chamba.com)' } });
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (e) {
    console.error('❌ Error geocodificando:', e.message);
    return null;
  }
}
// Distancia entre dos puntos en km (fórmula de Haversine)
function distanciaKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined)) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

app.get('/', (req, res) => res.json({ status: 'Chamba API ✅' }));

// ── IA ──
app.post('/api/analizar', async (req, res) => {
  const { servicio, descripcion, fotos } = req.body;
  const content = [];
  if (fotos?.length) fotos.forEach(b64 => content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }));
  content.push({ type: 'text', text: `Sos el asistente de ChamBA, empresa argentina de servicios del hogar. Servicio: "${servicio}". Problema: ${descripcion||'(ver fotos)'}. Respondé SOLO en JSON sin backticks: {"profesional":"...","urgencia":"Alta/Media/Baja","diagnostico":"...","precio_min":0,"precio_max":0,"precio_sugerido":0,"recomendacion":"...","puede_solo":false}. El precio_sugerido es el promedio de min y max redondeado.` });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content }] })
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const result = JSON.parse(data.content.map(i => i.text||'').join('').replace(/```json|```/g,'').trim());
    result.comision_pct = COMISION * 100;
    result.precio_cliente = Math.round(result.precio_sugerido);
    result.precio_socio = Math.round(result.precio_sugerido * (1 - COMISION));
    result.comision_chamba = Math.round(result.precio_sugerido * COMISION);
    res.json(result);
  } catch(e) { res.status(500).json({ error: 'Error al analizar.' }); }
});

// ── USUARIOS ──
app.get('/api/usuarios', async (req, res) => {
  const tipo = req.query.tipo ? `&tipo=eq.${req.query.tipo}` : '';
  res.json(await sb(`usuarios?select=id,nombre,email,telefono,tipo,estado,especialidad,dni,experiencia,matricula,trabajos_completados,promedio_estrellas,total_calificaciones,saldo_disponible,saldo_bloqueado,created_at&order=created_at.desc${tipo}`));
});

app.post('/api/usuarios/registro', async (req, res) => {
  const { nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password, direccion_residencia, direccion_trabajo } = req.body;
  const exists = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
  if (exists.length > 0) return res.status(400).json({ error: 'Ya existe una cuenta con ese email.' });
  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash(password, 10);
  const estado = tipo === 'cliente' ? 'aprobado' : 'pendiente';
  const data = await sb('usuarios', 'POST', { nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password_hash, estado });
  if (data.error || (Array.isArray(data) && data[0]?.code)) return res.status(400).json({ error: 'Error al registrar.' });
  const nuevoUsuario = data[0];

  // Crear las ubicaciones iniciales (no bloquea el registro si el geocodificador falla)
  try {
    let coordsResidencia = null;
    if (direccion_residencia) {
      coordsResidencia = await geocodificar(direccion_residencia);
      await sb('ubicaciones', 'POST', {
        usuario_id: nuevoUsuario.id, etiqueta: 'Casa', direccion: direccion_residencia,
        lat: coordsResidencia?.lat ?? null, lng: coordsResidencia?.lng ?? null, tipo: 'residencia', predeterminada: true
      });
    }
    if (tipo === 'socio') {
      const usaMismaDireccion = !direccion_trabajo;
      const direccionTrabajoFinal = direccion_trabajo || direccion_residencia;
      const coordsTrabajo = usaMismaDireccion ? coordsResidencia : await geocodificar(direccion_trabajo);
      if (direccionTrabajoFinal) {
        await sb('ubicaciones', 'POST', {
          usuario_id: nuevoUsuario.id, etiqueta: 'Zona de trabajo', direccion: direccionTrabajoFinal,
          lat: coordsTrabajo?.lat ?? null, lng: coordsTrabajo?.lng ?? null, tipo: 'trabajo', predeterminada: false
        });
      }
    }
  } catch (e) { console.error('❌ Error creando ubicación inicial:', e.message); }

  if (tipo === 'cliente') emailBienvenidaCliente(nombre, email);
  res.json({ ok: true, tipo, estado });
});

app.post('/api/usuarios/login', async (req, res) => {
  const { email, password } = req.body;
  const users = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=*`);
  if (!users.length) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  const user = users[0];
  const bcrypt = require('bcryptjs');
  const ok = await bcrypt.compare(password, user.password_hash || '');
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  if (user.estado === 'pendiente') return res.status(403).json({ error: 'Tu solicitud está pendiente de aprobación.' });
  if (user.estado === 'rechazado') return res.status(403).json({ error: 'Tu solicitud fue rechazada.' });
  const { password_hash, ...safeUser } = user;
  const token = jwt.sign({ id: user.id, tipo: user.tipo, email: user.email, nombre: user.nombre }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, usuario: safeUser, token });
});

app.patch('/api/usuarios/:id', auth, async (req, res) => {
  try {
    if (req.usuario.id !== req.params.id && req.usuario.tipo !== 'admin') {
      return res.status(403).json({ error: 'No podés editar el perfil de otra persona.' });
    }
    const prev = await sb(`usuarios?id=eq.${req.params.id}&select=*`);
    const data = await sb(`usuarios?id=eq.${req.params.id}`, 'PATCH', req.body);
    if (req.body.estado && prev.length) {
      const u = prev[0];
      if (req.body.estado === 'aprobado' && u.tipo === 'socio') emailSocioAprobado(u.nombre, u.email);
      if (req.body.estado === 'rechazado' && u.tipo === 'socio') emailSocioRechazado(u.nombre, u.email);
    }
    res.json(data);
  } catch (e) {
    console.error('❌ Error en PATCH /usuarios:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo actualizar.', detalle: e.message });
  }
});

app.delete('/api/usuarios/:id', auth, soloAdmin, async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true });
});

// ── UBICACIONES ──
app.get('/api/ubicaciones', auth, async (req, res) => {
  try {
    const usuario_id = req.query.usuario_id || req.usuario.id;
    if (usuario_id !== req.usuario.id && req.usuario.tipo !== 'admin') return res.status(403).json({ error: 'No autorizado.' });
    res.json(await sb(`ubicaciones?usuario_id=eq.${usuario_id}&select=*&order=created_at.asc`));
  } catch (e) {
    console.error('❌ Error en GET /ubicaciones:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudieron cargar las ubicaciones.' });
  }
});

app.post('/api/ubicaciones', auth, async (req, res) => {
  try {
    const { etiqueta, direccion, tipo } = req.body;
    if (!etiqueta || !direccion) return res.status(400).json({ error: 'Faltan datos.' });
    const coords = await geocodificar(direccion);
    if (!coords) return res.status(400).json({ error: 'No pudimos encontrar esa dirección. Probá escribirla con más detalle (calle, ciudad).' });
    const data = await sb('ubicaciones', 'POST', {
      usuario_id: req.usuario.id, etiqueta, direccion, lat: coords.lat, lng: coords.lng,
      tipo: tipo || 'otra', predeterminada: false
    });
    res.json(data);
  } catch (e) {
    console.error('❌ Error en POST /ubicaciones:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo agregar la ubicación.', detalle: e.message });
  }
});

app.patch('/api/ubicaciones/:id/predeterminada', auth, async (req, res) => {
  try {
    const ub = await sb(`ubicaciones?id=eq.${req.params.id}&select=usuario_id,tipo`);
    if (!ub.length || req.usuario.id !== ub[0].usuario_id) return res.status(403).json({ error: 'No podés modificar esta ubicación.' });
    await sb(`ubicaciones?usuario_id=eq.${req.usuario.id}&tipo=eq.${ub[0].tipo}`, 'PATCH', { predeterminada: false });
    await sb(`ubicaciones?id=eq.${req.params.id}`, 'PATCH', { predeterminada: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en PATCH /ubicaciones/predeterminada:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

app.delete('/api/ubicaciones/:id', auth, async (req, res) => {
  try {
    const ub = await sb(`ubicaciones?id=eq.${req.params.id}&select=usuario_id`);
    if (!ub.length || req.usuario.id !== ub[0].usuario_id) return res.status(403).json({ error: 'No podés eliminar esta ubicación.' });
    await fetch(`${SUPABASE_URL}/rest/v1/ubicaciones?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en DELETE /ubicaciones:', e.message);
    res.status(500).json({ error: 'No se pudo eliminar.' });
  }
});

// ── PEDIDOS ──
app.get('/api/pedidos', async (req, res) => {
  try {
    const usuario_id = req.query.usuario_id ? `&usuario_id=eq.${req.query.usuario_id}` : '';
    const estado = req.query.estado ? `&estado=eq.${req.query.estado}` : '';
    res.json(await sb(`pedidos?select=*&order=created_at.desc${usuario_id}${estado}`));
  } catch (e) {
    console.error('❌ Error en GET /pedidos:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudieron cargar los pedidos.' });
  }
});

app.post('/api/pedidos', auth, async (req, res) => {
  try {
    const { ubicacion_id, ...resto } = req.body;
    const body = { ...resto, usuario_id: req.usuario.id }; // nunca confiar en el usuario_id que manda el cliente
    if (ubicacion_id) {
      const ub = await sb(`ubicaciones?id=eq.${ubicacion_id}&select=lat,lng,etiqueta,direccion`);
      if (ub.length) { body.lat = ub[0].lat; body.lng = ub[0].lng; body.zona = ub[0].etiqueta; }
    }
    const data = await sb('pedidos', 'POST', body);
    const users = await sb(`usuarios?id=eq.${req.usuario.id}&select=nombre,email`);
    if (users.length) emailPedidoRecibido(users[0].nombre, users[0].email, req.body.servicio);
    res.json(data);
  } catch (e) {
    console.error('❌ Error en POST /pedidos:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo publicar el trabajo.', detalle: e.message });
  }
});

app.patch('/api/pedidos/:id', auth, async (req, res) => {
  try {
    const prev = await sb(`pedidos?id=eq.${req.params.id}&select=usuario_id,profesional_id`);
    if (!prev.length) return res.status(404).json({ error: 'Pedido no encontrado.' });
    const esParte = req.usuario.id === prev[0].usuario_id || req.usuario.id === prev[0].profesional_id;
    if (!esParte && req.usuario.tipo !== 'admin') return res.status(403).json({ error: 'No podés modificar este pedido.' });
    res.json(await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', req.body));
  }
  catch (e) { console.error('❌ Error en PATCH /pedidos:', e.message, e.supabase || ''); res.status(500).json({ error: 'No se pudo actualizar el pedido.', detalle: e.message }); }
});

// Eliminar pedido — usado por cliente (cancelados) y por ADMIN (sin penalizar a nadie)
app.delete('/api/pedidos/:id', auth, async (req, res) => {
  try {
    const prev = await sb(`pedidos?id=eq.${req.params.id}&select=usuario_id`);
    if (prev.length && req.usuario.id !== prev[0].usuario_id && req.usuario.tipo !== 'admin') {
      return res.status(403).json({ error: 'No podés eliminar este pedido.' });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
    res.json({ ok: true });
  }
  catch (e) { console.error('❌ Error en DELETE /pedidos:', e.message); res.status(500).json({ error: 'No se pudo eliminar.' }); }
});

// Endpoint específico para que el ADMIN elimine un trabajo sin afectar reputación de nadie
app.post('/api/pedidos/:id/eliminar-admin', auth, soloAdmin, async (req, res) => {
  // Marca ofertas relacionadas como rechazadas SIN penalizar (no pasa por /rechazar)
  await sb(`ofertas?pedido_id=eq.${req.params.id}`, 'PATCH', { estado: 'rechazada' });
  await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true, mensaje: 'Trabajo eliminado por administración. No afecta reputación.' });
});

// ── OFERTAS ──
app.get('/api/ofertas', async (req, res) => {
  try {
    const pedido_id = req.query.pedido_id ? `&pedido_id=eq.${req.query.pedido_id}` : '';
    const socio_id = req.query.socio_id ? `&socio_id=eq.${req.query.socio_id}` : '';
    const ofertas = await sb(`ofertas?select=*&order=created_at.desc${pedido_id}${socio_id}`);
    if (Array.isArray(ofertas) && ofertas.length) {
      const ids = [...new Set(ofertas.map(o => o.socio_id).filter(Boolean))];
      const socios = ids.length ? await sb(`usuarios?id=in.(${ids.join(',')})&select=id,promedio_estrellas,trabajos_completados`) : [];
      const mapa = {};
      (Array.isArray(socios) ? socios : []).forEach(s => mapa[s.id] = s);
      ofertas.forEach(o => {
        const s = mapa[o.socio_id];
        o.rep_promedio = s?.promedio_estrellas || 0;
        o.trabajos_completados = s?.trabajos_completados || 0;
      });
    }
    res.json(ofertas);
  } catch (e) {
    console.error('❌ Error en GET /ofertas:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudieron cargar las ofertas.' });
  }
});

app.post('/api/ofertas', auth, async (req, res) => {
  const { pedido_id, socio_nombre, especialidad, precio_ofertado } = req.body;
  const socio_id = req.usuario.id; // nunca confiar en el socio_id que manda el cliente
  const precio_neto = Math.round(precio_ofertado * (1 - COMISION));
  const comision = Math.round(precio_ofertado * COMISION);
  const prev = await sb(`ofertas?pedido_id=eq.${pedido_id}&socio_id=eq.${socio_id}&select=id`);
  if (prev.length > 0) {
    return res.json(await sb(`ofertas?id=eq.${prev[0].id}`, 'PATCH', { precio_ofertado, precio_neto, comision, estado: 'pendiente', ultima_oferta_de: 'socio' }));
  }
  res.json(await sb('ofertas', 'POST', { pedido_id, socio_id, socio_nombre, especialidad, precio_ofertado, precio_neto, comision, ultima_oferta_de: 'socio' }));
});

app.post('/api/ofertas/:id/contraoferta', auth, async (req, res) => {
  try {
    const { nuevo_precio } = req.body;
    if (!nuevo_precio || nuevo_precio <= 0) return res.status(400).json({ error: 'Precio inválido.' });
    const ofertas = await sb(`ofertas?id=eq.${req.params.id}&select=*`);
    if (!ofertas.length) return res.status(404).json({ error: 'Oferta no encontrada' });
    const o = ofertas[0];
    let rol;
    if (req.usuario.id === o.socio_id) rol = 'socio';
    else {
      const pedidos = await sb(`pedidos?id=eq.${o.pedido_id}&select=usuario_id`);
      if (pedidos.length && req.usuario.id === pedidos[0].usuario_id) rol = 'cliente';
      else return res.status(403).json({ error: 'No podés modificar esta oferta.' });
    }
    const precio_neto = Math.round(nuevo_precio * 0.8);
    const comision = Math.round(nuevo_precio * 0.2);
    res.json(await sb(`ofertas?id=eq.${req.params.id}`, 'PATCH', { precio_ofertado: nuevo_precio, precio_neto, comision, estado: 'negociando', ultima_oferta_de: rol }));
  } catch (e) {
    console.error('❌ Error en /contraoferta:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo enviar la contraoferta.' });
  }
});

app.post('/api/ofertas/:id/aceptar', auth, async (req, res) => {
  try {
    const oferta = await sb(`ofertas?id=eq.${req.params.id}&select=*`);
    if (!oferta.length) return res.status(404).json({ error: 'Oferta no encontrada' });
    const o = oferta[0];
    const pedidoPrev = await sb(`pedidos?id=eq.${o.pedido_id}&select=usuario_id`);
    if (!pedidoPrev.length || req.usuario.id !== pedidoPrev[0].usuario_id) {
      return res.status(403).json({ error: 'Solo quien publicó el trabajo puede aceptar una oferta.' });
    }
    const codigo = Math.floor(1000 + Math.random() * 9000); // número, no texto (la columna es numérica)
    await sb(`pedidos?id=eq.${o.pedido_id}`, 'PATCH', {
      profesional_id: o.socio_id, estado: 'en_proceso', estado_pago: 'pagado',
      precio_cliente: o.precio_ofertado, precio_socio: o.precio_neto,
      comision: o.comision, codigo_verificacion: codigo, intentos_codigo: 0, chat_habilitado: true
    });
    // El pago del cliente queda "bloqueado" hasta que se verifique el código de finalización
    const socio = await sb(`usuarios?id=eq.${o.socio_id}&select=saldo_bloqueado`);
    const bloqueadoActual = socio.length ? parseFloat(socio[0].saldo_bloqueado) || 0 : 0;
    await sb(`usuarios?id=eq.${o.socio_id}`, 'PATCH', { saldo_bloqueado: bloqueadoActual + o.precio_neto });
    await sb(`ofertas?id=eq.${o.id}`, 'PATCH', { estado: 'aceptada' });
    await sb(`ofertas?pedido_id=eq.${o.pedido_id}&id=neq.${o.id}`, 'PATCH', { estado: 'rechazada' });
    res.json({ ok: true, codigo, precio_cliente: o.precio_ofertado, precio_socio: o.precio_neto, comision: o.comision });
  } catch (e) {
    console.error('❌ Error en /aceptar:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo aceptar la oferta.', detalle: e.message });
  }
});

// Rechazar trabajo (SOLO el socio puede hacer esto) → penaliza reputación
app.post('/api/ofertas/:id/rechazar', auth, async (req, res) => {
  const oferta = await sb(`ofertas?id=eq.${req.params.id}&select=*`);
  if (!oferta.length) return res.status(404).json({ error: 'Oferta no encontrada' });
  const o = oferta[0];
  if (req.usuario.id !== o.socio_id) return res.status(403).json({ error: 'No podés rechazar esta oferta.' });
  await sb(`ofertas?id=eq.${o.id}`, 'PATCH', { estado: 'rechazada' });
  const socio = await sb(`usuarios?id=eq.${o.socio_id}&select=promedio_estrellas`);
  if (socio.length) {
    const actual = parseFloat(socio[0].promedio_estrellas) || 5;
    await sb(`usuarios?id=eq.${o.socio_id}`, 'PATCH', { promedio_estrellas: Math.max(1, Math.round((actual - 0.2) * 10) / 10) });
  }
  res.json({ ok: true });
});

app.post('/api/pedidos/:id/buscar-otro-socio', auth, async (req, res) => {
  const prev = await sb(`pedidos?id=eq.${req.params.id}&select=usuario_id`);
  if (!prev.length || req.usuario.id !== prev[0].usuario_id) return res.status(403).json({ error: 'No podés hacer esto en este pedido.' });
  await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', {
    profesional_id: null, estado: 'nuevo', estado_pago: 'sin_pagar',
    precio_cliente: 0, precio_socio: 0, comision: 0,
    codigo_verificacion: null, intentos_codigo: 0, chat_habilitado: false
  });
  await sb(`ofertas?pedido_id=eq.${req.params.id}`, 'PATCH', { estado: 'rechazada' });
  res.json({ ok: true });
});

app.post('/api/pedidos/:id/verificar-codigo', auth, async (req, res) => {
  try {
    const { codigo } = req.body;
    const pedidos = await sb(`pedidos?id=eq.${req.params.id}&select=*`);
    if (!pedidos.length) return res.status(404).json({ error: 'Pedido no encontrado' });
    const p = pedidos[0];
    if (req.usuario.id !== p.profesional_id) return res.status(403).json({ error: 'Solo el socio asignado puede ingresar el código.' });
    if (p.codigo_usado) return res.status(400).json({ error: 'Este código ya fue usado.' });
    if (p.intentos_codigo >= 4) return res.status(400).json({ error: 'Límite de 4 intentos alcanzado. Contactá a ChamBA.' });
    if (String(p.codigo_verificacion) !== String(codigo)) {
      await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', { intentos_codigo: (p.intentos_codigo || 0) + 1 });
      const restantes = 4 - (p.intentos_codigo + 1);
      return res.status(400).json({ error: `Código incorrecto. Te quedan ${restantes} intento${restantes !== 1 ? 's' : ''}.` });
    }
    await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', { codigo_usado: true, estado: 'completado', dinero_liberado: true, estado_pago: 'liberado' });
    const socio = await sb(`usuarios?id=eq.${p.profesional_id}&select=saldo_disponible,saldo_bloqueado`);
    const saldoActual = socio.length ? parseFloat(socio[0].saldo_disponible) || 0 : 0;
    const bloqueadoActual = socio.length ? parseFloat(socio[0].saldo_bloqueado) || 0 : 0;
    await sb(`usuarios?id=eq.${p.profesional_id}`, 'PATCH', {
      saldo_disponible: saldoActual + p.precio_socio,
      saldo_bloqueado: Math.max(0, bloqueadoActual - p.precio_socio)
    });
    res.json({ ok: true, mensaje: '¡Código verificado! El dinero fue liberado a tu cuenta.' });
  } catch (e) {
    console.error('❌ Error en /verificar-codigo:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo verificar el código.', detalle: e.message });
  }
});

// ── MENSAJES (solo si chat_habilitado) ──
app.get('/api/mensajes/:pedido_id', async (req, res) => {
  try { res.json(await sb(`mensajes?pedido_id=eq.${req.params.pedido_id}&select=*&order=created_at.asc`)); }
  catch (e) { console.error('❌ Error en GET /mensajes:', e.message, e.supabase || ''); res.status(500).json({ error: 'No se pudieron cargar los mensajes.' }); }
});
app.post('/api/mensajes', auth, async (req, res) => {
  try {
    const pedido = await sb(`pedidos?id=eq.${req.body.pedido_id}&select=chat_habilitado,usuario_id,profesional_id`);
    if (!pedido.length || !pedido[0].chat_habilitado) return res.status(403).json({ error: 'El chat se habilita después del pago.' });
    if (req.usuario.id !== pedido[0].usuario_id && req.usuario.id !== pedido[0].profesional_id) {
      return res.status(403).json({ error: 'No sos parte de esta conversación.' });
    }
    const rol = req.usuario.id === pedido[0].profesional_id ? 'socio' : 'cliente';
    res.json(await sb('mensajes', 'POST', { ...req.body, autor: req.usuario.nombre || req.body.autor, rol }));
  } catch (e) {
    console.error('❌ Error en POST /mensajes:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo enviar el mensaje.', detalle: e.message });
  }
});

// ── SOLICITUDES DE MATRÍCULA ──
app.get('/api/solicitudes-matricula', async (req, res) => {
  try {
    const socio_id = req.query.socio_id ? `&socio_id=eq.${req.query.socio_id}` : '';
    res.json(await sb(`solicitudes_matricula?select=*&order=created_at.desc${socio_id}`));
  } catch (e) {
    console.error('❌ Error en GET /solicitudes-matricula:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudieron cargar las solicitudes.' });
  }
});
app.post('/api/solicitudes-matricula', auth, async (req, res) => {
  try {
    const { matricula_nueva, especialidad } = req.body;
    if (!matricula_nueva) return res.status(400).json({ error: 'Faltan datos.' });
    res.json(await sb('solicitudes_matricula', 'POST', { socio_id: req.usuario.id, matricula_nueva, especialidad, estado: 'pendiente' }));
  } catch (e) {
    console.error('❌ Error en POST /solicitudes-matricula:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo enviar la solicitud.', detalle: e.message });
  }
});
app.patch('/api/solicitudes-matricula/:id', auth, soloAdmin, async (req, res) => {
  try {
    const { estado } = req.body; // 'aprobada' | 'rechazada'
    const sol = await sb(`solicitudes_matricula?id=eq.${req.params.id}&select=*`);
    if (!sol.length) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    const s = sol[0];
    await sb(`solicitudes_matricula?id=eq.${req.params.id}`, 'PATCH', { estado, visto: false });
    if (estado === 'aprobada') {
      const socio = await sb(`usuarios?id=eq.${s.socio_id}&select=matricula,especialidad`);
      if (socio.length) {
        const u = socio[0];
        const patch = { matricula: u.matricula ? `${u.matricula}, ${s.matricula_nueva}` : s.matricula_nueva };
        if (s.especialidad && !(u.especialidad || '').includes(s.especialidad)) {
          patch.especialidad = u.especialidad ? `${u.especialidad}, ${s.especialidad}` : s.especialidad;
        }
        await sb(`usuarios?id=eq.${s.socio_id}`, 'PATCH', patch);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en PATCH /solicitudes-matricula:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo procesar la solicitud.', detalle: e.message });
  }
});
app.patch('/api/solicitudes-matricula/:id/visto', auth, async (req, res) => {
  try {
    const sol = await sb(`solicitudes_matricula?id=eq.${req.params.id}&select=socio_id`);
    if (!sol.length || req.usuario.id !== sol[0].socio_id) return res.status(403).json({ error: 'No podés modificar esta solicitud.' });
    await sb(`solicitudes_matricula?id=eq.${req.params.id}`, 'PATCH', { visto: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en PATCH /solicitudes-matricula/visto:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

// ── CALIFICACIONES ──
app.post('/api/calificaciones', auth, async (req, res) => {
  try {
    const { pedido_id, socio_id, estrellas, comentario } = req.body;
    const pedidoPrev = await sb(`pedidos?id=eq.${pedido_id}&select=usuario_id`);
    if (!pedidoPrev.length || req.usuario.id !== pedidoPrev[0].usuario_id) {
      return res.status(403).json({ error: 'Solo quien pidió el trabajo puede calificarlo.' });
    }
    const data = await sb('calificaciones', 'POST', { pedido_id, socio_id, cliente_id: req.usuario.id, estrellas, comentario });
    await sb(`pedidos?id=eq.${pedido_id}`, 'PATCH', { calificado: true });
    const cals = await sb(`calificaciones?socio_id=eq.${socio_id}&select=estrellas`);
    if (Array.isArray(cals) && cals.length) {
      const promedio = cals.reduce((s, c) => s + c.estrellas, 0) / cals.length;
      const trabajos = await sb(`pedidos?profesional_id=eq.${socio_id}&estado=eq.completado&select=id`);
      await sb(`usuarios?id=eq.${socio_id}`, 'PATCH', {
        promedio_estrellas: Math.round(promedio * 10) / 10,
        total_calificaciones: cals.length,
        trabajos_completados: Array.isArray(trabajos) ? trabajos.length : 0
      });
    }
    res.json(data);
  } catch (e) {
    console.error('❌ Error en /calificaciones:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo enviar la calificación.', detalle: e.message });
  }
});

app.get('/api/calificaciones/:socio_id', async (req, res) => res.json(await sb(`calificaciones?socio_id=eq.${req.params.socio_id}&select=*&order=created_at.desc`)));

// ── FORO (con soporte para respuestas vía parent_id) ──
app.get('/api/foro', async (req, res) => {
  try { res.json(await sb('foro?select=*&order=created_at.asc')); }
  catch (e) { console.error('❌ Error en GET /foro:', e.message, e.supabase || ''); res.status(500).json({ error: 'No se pudo cargar el foro.' }); }
});
app.post('/api/foro', auth, async (req, res) => {
  try { res.json(await sb('foro', 'POST', { ...req.body, autor_id: req.usuario.id, autor_nombre: req.usuario.nombre, autor_tipo: req.usuario.tipo })); }
  catch (e) { console.error('❌ Error en POST /foro:', e.message, e.supabase || ''); res.status(500).json({ error: 'No se pudo publicar.', detalle: e.message }); }
});
app.delete('/api/foro/:id', auth, soloAdmin, async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/foro?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Chamba backend en puerto ${PORT}`));
