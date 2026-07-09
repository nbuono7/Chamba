const express = require('express');
const cors = require('cors');
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
  const { nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password } = req.body;
  const exists = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
  if (exists.length > 0) return res.status(400).json({ error: 'Ya existe una cuenta con ese email.' });
  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash(password, 10);
  const estado = tipo === 'cliente' ? 'aprobado' : 'pendiente';
  const data = await sb('usuarios', 'POST', { nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password_hash, estado });
  if (data.error || (Array.isArray(data) && data[0]?.code)) return res.status(400).json({ error: 'Error al registrar.' });
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
  res.json({ ok: true, usuario: safeUser });
});

app.patch('/api/usuarios/:id', async (req, res) => {
  const prev = await sb(`usuarios?id=eq.${req.params.id}&select=*`);
  const data = await sb(`usuarios?id=eq.${req.params.id}`, 'PATCH', req.body);
  if (req.body.estado && prev.length) {
    const u = prev[0];
    if (req.body.estado === 'aprobado' && u.tipo === 'socio') emailSocioAprobado(u.nombre, u.email);
    if (req.body.estado === 'rechazado' && u.tipo === 'socio') emailSocioRechazado(u.nombre, u.email);
  }
  res.json(data);
});

app.delete('/api/usuarios/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true });
});

// ── PEDIDOS ──
app.get('/api/pedidos', async (req, res) => {
  const usuario_id = req.query.usuario_id ? `&usuario_id=eq.${req.query.usuario_id}` : '';
  const estado = req.query.estado ? `&estado=eq.${req.query.estado}` : '';
  res.json(await sb(`pedidos?select=*&order=created_at.desc${usuario_id}${estado}`));
});

app.post('/api/pedidos', async (req, res) => {
  const data = await sb('pedidos', 'POST', req.body);
  if (req.body.usuario_id) {
    const users = await sb(`usuarios?id=eq.${req.body.usuario_id}&select=nombre,email`);
    if (users.length) emailPedidoRecibido(users[0].nombre, users[0].email, req.body.servicio);
  }
  res.json(data);
});

app.patch('/api/pedidos/:id', async (req, res) => {
  res.json(await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', req.body));
});

// Eliminar pedido — usado por cliente (cancelados) y por ADMIN (sin penalizar a nadie)
app.delete('/api/pedidos/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true });
});

// Endpoint específico para que el ADMIN elimine un trabajo sin afectar reputación de nadie
app.post('/api/pedidos/:id/eliminar-admin', async (req, res) => {
  // Marca ofertas relacionadas como rechazadas SIN penalizar (no pasa por /rechazar)
  await sb(`ofertas?pedido_id=eq.${req.params.id}`, 'PATCH', { estado: 'rechazada' });
  await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true, mensaje: 'Trabajo eliminado por administración. No afecta reputación.' });
});

// ── OFERTAS ──
app.get('/api/ofertas', async (req, res) => {
  const pedido_id = req.query.pedido_id ? `&pedido_id=eq.${req.query.pedido_id}` : '';
  const socio_id = req.query.socio_id ? `&socio_id=eq.${req.query.socio_id}` : '';
  res.json(await sb(`ofertas?select=*&order=created_at.desc${pedido_id}${socio_id}`));
});

app.post('/api/ofertas', async (req, res) => {
  const { pedido_id, socio_id, socio_nombre, especialidad, precio_ofertado } = req.body;
  const precio_neto = Math.round(precio_ofertado * (1 - COMISION));
  const comision = Math.round(precio_ofertado * COMISION);
  const prev = await sb(`ofertas?pedido_id=eq.${pedido_id}&socio_id=eq.${socio_id}&select=id`);
  if (prev.length > 0) {
    return res.json(await sb(`ofertas?id=eq.${prev[0].id}`, 'PATCH', { precio_ofertado, precio_neto, comision, estado: 'pendiente', ultima_oferta_de: 'socio' }));
  }
  res.json(await sb('ofertas', 'POST', { pedido_id, socio_id, socio_nombre, especialidad, precio_ofertado, precio_neto, comision, ultima_oferta_de: 'socio' }));
});

app.post('/api/ofertas/:id/contraoferta', async (req, res) => {
  const { nuevo_precio, rol } = req.body;
  if (!nuevo_precio || nuevo_precio <= 0) return res.status(400).json({ error: 'Precio inválido.' });
  const precio_neto = Math.round(nuevo_precio * 0.8);
  const comision = Math.round(nuevo_precio * 0.2);
  res.json(await sb(`ofertas?id=eq.${req.params.id}`, 'PATCH', { precio_ofertado: nuevo_precio, precio_neto, comision, estado: 'negociando', ultima_oferta_de: rol }));
});

app.post('/api/ofertas/:id/aceptar', async (req, res) => {
  try {
    const oferta = await sb(`ofertas?id=eq.${req.params.id}&select=*`);
    if (!oferta.length) return res.status(404).json({ error: 'Oferta no encontrada' });
    const o = oferta[0];
    const codigo = Math.floor(1000 + Math.random() * 9000); // número, no texto (la columna es numérica)
    await sb(`pedidos?id=eq.${o.pedido_id}`, 'PATCH', {
      profesional_id: o.socio_id, estado: 'en_proceso', estado_pago: 'pagado',
      precio_cliente: o.precio_ofertado, precio_socio: o.precio_neto,
      comision: o.comision, codigo_verificacion: codigo, intentos_codigo: 0, chat_habilitado: true
    });
    await sb(`ofertas?id=eq.${o.id}`, 'PATCH', { estado: 'aceptada' });
    await sb(`ofertas?pedido_id=eq.${o.pedido_id}&id=neq.${o.id}`, 'PATCH', { estado: 'rechazada' });
    res.json({ ok: true, codigo, precio_cliente: o.precio_ofertado, precio_socio: o.precio_neto, comision: o.comision });
  } catch (e) {
    console.error('❌ Error en /aceptar:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo aceptar la oferta.', detalle: e.message });
  }
});

// Rechazar trabajo (SOLO el socio puede hacer esto) → penaliza reputación
app.post('/api/ofertas/:id/rechazar', async (req, res) => {
  const oferta = await sb(`ofertas?id=eq.${req.params.id}&select=*`);
  if (!oferta.length) return res.status(404).json({ error: 'Oferta no encontrada' });
  const o = oferta[0];
  await sb(`ofertas?id=eq.${o.id}`, 'PATCH', { estado: 'rechazada' });
  const socio = await sb(`usuarios?id=eq.${o.socio_id}&select=promedio_estrellas`);
  if (socio.length) {
    const actual = parseFloat(socio[0].promedio_estrellas) || 5;
    await sb(`usuarios?id=eq.${o.socio_id}`, 'PATCH', { promedio_estrellas: Math.max(1, Math.round((actual - 0.2) * 10) / 10) });
  }
  res.json({ ok: true });
});

app.post('/api/pedidos/:id/buscar-otro-socio', async (req, res) => {
  await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', {
    profesional_id: null, estado: 'nuevo', estado_pago: 'sin_pagar',
    precio_cliente: 0, precio_socio: 0, comision: 0,
    codigo_verificacion: null, intentos_codigo: 0, chat_habilitado: false
  });
  await sb(`ofertas?pedido_id=eq.${req.params.id}`, 'PATCH', { estado: 'rechazada' });
  res.json({ ok: true });
});

app.post('/api/pedidos/:id/verificar-codigo', async (req, res) => {
  const { codigo } = req.body;
  const pedidos = await sb(`pedidos?id=eq.${req.params.id}&select=*`);
  if (!pedidos.length) return res.status(404).json({ error: 'Pedido no encontrado' });
  const p = pedidos[0];
  if (p.codigo_usado) return res.status(400).json({ error: 'Este código ya fue usado.' });
  if (p.intentos_codigo >= 4) return res.status(400).json({ error: 'Límite de 4 intentos alcanzado. Contactá a ChamBA.' });
  if (String(p.codigo_verificacion) !== String(codigo)) {
    await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', { intentos_codigo: (p.intentos_codigo || 0) + 1 });
    const restantes = 4 - (p.intentos_codigo + 1);
    return res.status(400).json({ error: `Código incorrecto. Te quedan ${restantes} intento${restantes !== 1 ? 's' : ''}.` });
  }
  await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', { codigo_usado: true, estado: 'completado', dinero_liberado: true, estado_pago: 'liberado' });
  await sb(`usuarios?id=eq.${p.profesional_id}`, 'PATCH', { saldo_disponible: p.precio_socio, saldo_bloqueado: 0 });
  res.json({ ok: true, mensaje: '¡Código verificado! El dinero fue liberado a tu cuenta.' });
});

// ── MENSAJES (solo si chat_habilitado) ──
app.get('/api/mensajes/:pedido_id', async (req, res) => res.json(await sb(`mensajes?pedido_id=eq.${req.params.pedido_id}&select=*&order=created_at.asc`)));
app.post('/api/mensajes', async (req, res) => {
  const pedido = await sb(`pedidos?id=eq.${req.body.pedido_id}&select=chat_habilitado`);
  if (!pedido.length || !pedido[0].chat_habilitado) return res.status(403).json({ error: 'El chat se habilita después del pago.' });
  res.json(await sb('mensajes', 'POST', req.body));
});

// ── CALIFICACIONES ──
app.post('/api/calificaciones', async (req, res) => {
  const { pedido_id, socio_id, cliente_id, estrellas, comentario } = req.body;
  const data = await sb('calificaciones', 'POST', { pedido_id, socio_id, cliente_id, estrellas, comentario });
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
});

app.get('/api/calificaciones/:socio_id', async (req, res) => res.json(await sb(`calificaciones?socio_id=eq.${req.params.socio_id}&select=*&order=created_at.desc`)));

// ── FORO (con soporte para respuestas vía parent_id) ──
app.get('/api/foro', async (req, res) => res.json(await sb('foro?select=*&order=created_at.asc')));
app.post('/api/foro', async (req, res) => res.json(await sb('foro', 'POST', req.body)));
app.delete('/api/foro/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/foro?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Chamba backend en puerto ${PORT}`));
