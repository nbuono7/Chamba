const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const sbHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`
};

app.get('/', (req, res) => res.json({ status: 'Chamba API funcionando ✅' }));

// ── ANALIZAR CON IA ──
app.post('/api/analizar', async (req, res) => {
  const { servicio, descripcion, fotos } = req.body;
  const userContent = [];
  if (fotos?.length) fotos.forEach(b64 => userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }));
  userContent.push({ type: 'text', text: `Sos el asistente de ChamBA, empresa argentina de servicios del hogar. Servicio: "${servicio}". Problema: ${descripcion || '(ver fotos)'}. Respondé SOLO en JSON sin backticks: {"profesional":"...","urgencia":"Alta/Media/Baja","diagnostico":"...","precio_min":0,"precio_max":0,"recomendacion":"...","puede_solo":false}` });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: userContent }] })
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content.map(i => i.text || '').join('');
    res.json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (err) { res.status(500).json({ error: 'Error al analizar.' }); }
});

// ── USUARIOS (registro/login) ──
app.get('/api/usuarios', async (req, res) => {
  const tipo = req.query.tipo ? `&tipo=eq.${req.query.tipo}` : '';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?select=*&order=created_at.desc${tipo}`, { headers: sbHeaders });
  res.json(await r.json());
});

app.post('/api/usuarios/registro', async (req, res) => {
  const { nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password } = req.body;
  // Verificar si ya existe
  const check = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=id`, { headers: sbHeaders });
  const exists = await check.json();
  if (exists.length > 0) return res.status(400).json({ error: 'Ya existe una cuenta con ese email.' });

  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash(password, 10);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify({ nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password_hash, estado: tipo === 'cliente' ? 'aprobado' : 'pendiente' })
  });
  const data = await r.json();
  if (data.error || (Array.isArray(data) && data[0]?.code)) return res.status(400).json({ error: 'Error al registrar.' });
  res.json({ ok: true, tipo, estado: tipo === 'cliente' ? 'aprobado' : 'pendiente' });
});

app.post('/api/usuarios/login', async (req, res) => {
  const { email, password } = req.body;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=*`, { headers: sbHeaders });
  const users = await r.json();
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
  const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${req.params.id}`, {
    method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=representation' }, body: JSON.stringify(req.body)
  });
  res.json(await r.json());
});

app.delete('/api/usuarios/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbHeaders });
  res.json({ ok: true });
});

// ── CLIENTES (legacy) ──
app.get('/api/clientes', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes?select=*&order=created_at.desc`, { headers: sbHeaders });
  res.json(await r.json());
});

// ── PROFESIONALES (legacy) ──
app.get('/api/profesionales', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profesionales?select=*&order=created_at.desc`, { headers: sbHeaders });
  res.json(await r.json());
});
app.patch('/api/profesionales/:id', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profesionales?id=eq.${req.params.id}`, { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=representation' }, body: JSON.stringify(req.body) });
  res.json(await r.json());
});
app.delete('/api/profesionales/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/profesionales?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbHeaders });
  res.json({ ok: true });
});

// ── PEDIDOS ──
app.get('/api/pedidos', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?select=*&order=created_at.desc`, { headers: sbHeaders });
  res.json(await r.json());
});
app.post('/api/pedidos', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, { method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=representation' }, body: JSON.stringify(req.body) });
  res.json(await r.json());
});
app.patch('/api/pedidos/:id', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${req.params.id}`, { method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=representation' }, body: JSON.stringify(req.body) });
  res.json(await r.json());
});
app.delete('/api/pedidos/:id', async (req, res) => {
  await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${req.params.id}`, { method: 'DELETE', headers: sbHeaders });
  res.json({ ok: true });
});

// ── MENSAJES ──
app.get('/api/mensajes/:pedido_id', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/mensajes?pedido_id=eq.${req.params.pedido_id}&select=*&order=created_at.asc`, { headers: sbHeaders });
  res.json(await r.json());
});
app.post('/api/mensajes', async (req, res) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/mensajes`, { method: 'POST', headers: { ...sbHeaders, 'Prefer': 'return=representation' }, body: JSON.stringify(req.body) });
  res.json(await r.json());
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Chamba backend en puerto ${PORT}`));
