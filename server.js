const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
require('dotenv').config();
const { emailBienvenidaCliente, emailSocioAprobado, emailSocioRechazado, emailNuevaTarea, emailPedidoRecibido } = require('./emailService');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const sbH = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

const sb = async (path, method='GET', body=null) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: body ? { ...sbH, 'Prefer': 'return=representation' } : sbH, body: body ? JSON.stringify(body) : null });
  return r.json();
};

app.get('/', (req, res) => res.json({ status: 'Chamba API funcionando ✅' }));

// ── IA ──
app.post('/api/analizar', async (req, res) => {
  const { servicio, descripcion, fotos } = req.body;
  const content = [];
  if (fotos?.length) fotos.forEach(b64 => content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }));
  content.push({ type: 'text', text: `Sos el asistente de ChamBA. Servicio: "${servicio}". Problema: ${descripcion||'(ver fotos)'}. Respondé SOLO en JSON sin backticks: {"profesional":"...","urgencia":"Alta/Media/Baja","diagnostico":"...","precio_min":0,"precio_max":0,"recomendacion":"...","puede_solo":false}` });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content }] }) });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json(JSON.parse(data.content.map(i => i.text||'').join('').replace(/```json|```/g,'').trim()));
  } catch(e) { res.status(500).json({ error: 'Error al analizar.' }); }
});

// ── USUARIOS ──
app.get('/api/usuarios', async (req, res) => {
  const tipo = req.query.tipo ? `&tipo=eq.${req.query.tipo}` : '';
  res.json(await sb(`usuarios?select=*&order=created_at.desc${tipo}`));
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
  // Emails de bienvenida
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
  if (user.estado === 'pendiente') return res.status(403).json({ error: 'Tu solicitud está pendiente de aprobación. Te avisaremos pronto.' });
  if (user.estado === 'rechazado') return res.status(403).json({ error: 'Tu solicitud fue rechazada. Contactanos para más información.' });
  const { password_hash, ...safeUser } = user;
  res.json({ ok: true, usuario: safeUser });
});

app.patch('/api/usuarios/:id', async (req, res) => {
  const prev = await sb(`usuarios?id=eq.${req.params.id}&select=*`);
  const data = await sb(`usuarios?id=eq.${req.params.id}`, 'PATCH', req.body);
  // Emails al cambiar estado
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
app.get('/api/pedidos', async (req, res) => res.json(await sb('pedidos?select=*&order=created_at.desc')));

app.post('/api/pedidos', async (req, res) => {
  const data = await sb('pedidos', 'POST', req.body);
  // Email al cliente
  if (req.body.usuario_id) {
    const users = await sb(`usuarios?id=eq.${req.body.usuario_id}&select=nombre,email`);
    if (users.length) emailPedidoRecibido(users[0].nombre, users[0].email, req.body.servicio);
  }
  res.json(data);
});

app.patch('/api/pedidos/:id', async (req, res) => {
  const prev = await sb(`pedidos?id=eq.${req.params.id}&select=*`);
  const data = await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', req.body);
  // Email al socio si se le asigna una tarea
  if (req.body.profesional_id && prev.length && prev[0].profesional_id !== req.body.profesional_id) {
    const socios = await sb(`usuarios?id=eq.${req.body.profesional_id}&select=nombre,email`);
    if (socios.length) emailNuevaTarea(socios[0].nombre, socios[0].email, prev[0].servicio, prev[0].descripcion);
  }
  res.json(data);
});

app.delete('/api/pedidos/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true });
});

// ── MENSAJES ──
app.get('/api/mensajes/:pedido_id', async (req, res) => res.json(await sb(`mensajes?pedido_id=eq.${req.params.pedido_id}&select=*&order=created_at.asc`)));
app.post('/api/mensajes', async (req, res) => res.json(await sb('mensajes', 'POST', req.body)));

// ── FORO ──
app.get('/api/foro', async (req, res) => res.json(await sb('foro?select=*&order=created_at.desc')));
app.post('/api/foro', async (req, res) => res.json(await sb('foro', 'POST', req.body)));
app.delete('/api/foro/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/foro?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbH });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Chamba backend en puerto ${PORT}`));
