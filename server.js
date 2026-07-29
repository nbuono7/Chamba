const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
require('dotenv').config();
const { emailBienvenidaCliente, emailSocioAprobado, emailSocioRechazado, emailPedidoRecibido, emailCodigoVerificacion, emailNuevaOferta, emailNuevoMensaje, emailCodigoPorVencer } = require('./emailService');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

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
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&addressdetails=1&q=${encodeURIComponent(direccion)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ChamBA-App (contacto@chamba.com)' } });
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;
    const d = data[0];
    const a = d.address || {};
    const barrio = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
    const ciudad = a.city || a.town || a.village || a.municipality || '';
    const zona = [barrio, ciudad].filter(Boolean).join(', ') || ciudad || a.state || null;
    return { lat: parseFloat(d.lat), lng: parseFloat(d.lon), zona };
  } catch (e) {
    console.error('❌ Error geocodificando:', e.message);
    return null;
  }
}
// Devuelve una LISTA de direcciones reales que coinciden con lo que la persona va escribiendo (autocompletar, como Google Maps / PedidosYa).
async function buscarDirecciones(texto) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=ar&addressdetails=1&q=${encodeURIComponent(texto)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ChamBA-App (contacto@chamba.com)' } });
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    return data.map(d => {
      const a = d.address || {};
      const barrio = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
      const ciudad = a.city || a.town || a.village || a.municipality || '';
      const zona = [barrio, ciudad].filter(Boolean).join(', ') || ciudad || a.state || null;
      return { display_name: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon), zona };
    });
  } catch (e) {
    console.error('❌ Error buscando direcciones:', e.message);
    return [];
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
// Convierte coordenadas (por ejemplo, al arrastrar un pin en el mapa) en una dirección legible + zona.
async function geocodificarInverso(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ChamBA-App (contacto@chamba.com)' } });
    const d = await r.json();
    if (!d || d.error) return null;
    const a = d.address || {};
    const barrio = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
    const ciudad = a.city || a.town || a.village || a.municipality || '';
    const zona = [barrio, ciudad].filter(Boolean).join(', ') || ciudad || a.state || null;
    return { direccion: d.display_name, zona };
  } catch (e) {
    console.error('❌ Error en geocodificación inversa:', e.message);
    return null;
  }
}

// Rutas públicas de geocodificación, para el mapa interactivo (registro y "Mis ubicaciones")
app.get('/api/geocodificar', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Falta la dirección.' });
  const coords = await geocodificar(q);
  if (!coords) return res.status(404).json({ error: 'No pudimos encontrar esa dirección.' });
  res.json(coords);
});
app.get('/api/geocodificar-buscar', async (req, res) => {
  const q = req.query.q;
  if (!q || q.trim().length < 3) return res.json([]);
  res.json(await buscarDirecciones(q));
});
app.get('/api/geocodificar-inverso', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'Coordenadas inválidas.' });
  const r = await geocodificarInverso(lat, lng);
  if (!r) return res.status(404).json({ error: 'No pudimos identificar esa ubicación.' });
  res.json(r);
});

// Sube un archivo (base64) a Supabase Storage. Devuelve la ruta guardada (no la URL, el bucket es privado).
async function subirArchivo(bucket, path, base64Data, mimeType) {
  const buffer = Buffer.from(base64Data, 'base64');
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': mimeType, 'x-upsert': 'true' },
    body: buffer
  });
  const data = await r.json();
  if (!r.ok) { console.error('❌ Error subiendo archivo:', JSON.stringify(data)); throw new Error('No se pudo subir el archivo.'); }
  return path;
}
// Genera un link temporal (1 hora) para ver un archivo privado — solo para quien lo pida desde el backend (ej. el admin).
async function firmarUrl(bucket, path, expiresIn = 3600) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn })
    });
    const data = await r.json();
    if (!r.ok || !data.signedURL) return null;
    return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
  } catch (e) { console.error('❌ Error firmando URL:', e.message); return null; }
}

// ── VERIFICACIÓN DE IDENTIDAD (comprobantes de monotributo u otra prueba, además de la matrícula) ──
app.post('/api/verificaciones-identidad', auth, async (req, res) => {
  try {
    const { archivos } = req.body; // [{ data: base64SinPrefijo, mime: 'image/jpeg' }, ...] hasta 3
    if (!Array.isArray(archivos) || !archivos.length) return res.status(400).json({ error: 'Subí al menos un comprobante.' });
    if (archivos.length > 3) return res.status(400).json({ error: 'Máximo 3 archivos.' });
    const paths = [];
    for (let i = 0; i < archivos.length; i++) {
      const ext = (archivos[i].mime.split('/')[1] || 'bin').replace('jpeg', 'jpg');
      const path = `${req.usuario.id}/${Date.now()}_${i}.${ext}`;
      await subirArchivo('identificaciones', path, archivos[i].data, archivos[i].mime);
      paths.push(path);
    }
    const body = { socio_id: req.usuario.id, estado: 'pendiente' };
    ['archivo_1', 'archivo_2', 'archivo_3'].forEach((campo, i) => { if (paths[i]) body[campo] = paths[i]; });
    res.json(await sb('verificaciones_identidad', 'POST', body));
  } catch (e) {
    console.error('❌ Error en POST /verificaciones-identidad:', e.message, e.supabase || '');
    res.status(500).json({ error: e.message || 'No se pudo enviar la verificación.' });
  }
});

app.get('/api/verificaciones-identidad', auth, async (req, res) => {
  try {
    let socio_id = req.query.socio_id;
    if (req.usuario.tipo !== 'admin') socio_id = req.usuario.id;
    const filtro = socio_id ? `&socio_id=eq.${socio_id}` : '';
    const rows = await sb(`verificaciones_identidad?select=*&order=created_at.desc${filtro}`);
    for (const row of rows) {
      row.urls = [];
      for (const campo of ['archivo_1', 'archivo_2', 'archivo_3']) {
        if (row[campo]) { const url = await firmarUrl('identificaciones', row[campo]); if (url) row.urls.push(url); }
      }
    }
    res.json(rows);
  } catch (e) {
    console.error('❌ Error en GET /verificaciones-identidad:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudieron cargar las verificaciones.' });
  }
});

app.patch('/api/verificaciones-identidad/:id', auth, soloAdmin, async (req, res) => {
  try {
    const { estado } = req.body;
    res.json(await sb(`verificaciones_identidad?id=eq.${req.params.id}`, 'PATCH', { estado }));
  } catch (e) {
    console.error('❌ Error en PATCH /verificaciones-identidad:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

app.get('/', (req, res) => res.json({ status: 'Chamba API ✅' }));

// ── IA ──
app.post('/api/analizar', async (req, res) => {
  const { servicio, descripcion, fotos } = req.body;
  const content = [];
  if (fotos?.length) fotos.forEach(b64 => content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }));
  content.push({ type: 'text', text: `Sos el asistente de ChamBA, empresa argentina de servicios del hogar. Servicio: "${servicio}". Problema: ${descripcion||'(ver fotos)'}. Evaluá la urgencia real del problema (¿puede esperar días, o hay riesgo de daño mayor/inseguridad si no se atiende ya?). El precio sugerido debe reflejar esa urgencia: a mayor urgencia, mayor precio esperable, ya que implica prioridad y rapidez para el profesional. Respondé SOLO en JSON sin backticks: {"profesional":"...","urgencia":"Alta/Media/Baja","diagnostico":"...","precio_min":0,"precio_max":0,"precio_sugerido":0,"recomendacion":"...","puede_solo":false}. El precio_sugerido es el promedio de min y max redondeado.` });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 4000, messages: [{ role: 'user', content }] })
    });
    const data = await r.json();
    if (data.error) { console.error('❌ Error de la API de Claude:', data.error.message); return res.status(500).json({ error: data.error.message }); }
    const textoCompleto = data.content.map(i => i.text||'').join('');
    let result;
    try {
      result = JSON.parse(textoCompleto.replace(/```json|```/g,'').trim());
    } catch (e) {
      console.error('❌ La IA no devolvió JSON válido:', textoCompleto);
      return res.status(500).json({ error: 'La IA no pudo procesar este pedido, probá reformular la descripción.' });
    }
    result.comision_pct = COMISION * 100;
    result.precio_cliente = Math.round(result.precio_sugerido);
    result.precio_socio = Math.round(result.precio_sugerido * (1 - COMISION));
    result.comision_chamba = Math.round(result.precio_sugerido * COMISION);
    res.json(result);
  } catch(e) { console.error('❌ Error en /api/analizar:', e.message); res.status(500).json({ error: 'Error al analizar.' }); }
});

// ── USUARIOS ──
// ── ESPECIALIDADES (catálogo, el admin puede bloquear/desbloquear) ──
app.get('/api/especialidades', async (req, res) => {
  try { res.json(await sb('especialidades?select=*&order=orden.asc')); }
  catch (e) { console.error('❌ Error en GET /especialidades:', e.message); res.status(500).json({ error: 'No se pudieron cargar las especialidades.' }); }
});
app.patch('/api/especialidades/:id', auth, soloAdmin, async (req, res) => {
  try {
    const { activa } = req.body;
    res.json(await sb(`especialidades?id=eq.${req.params.id}`, 'PATCH', { activa }));
  } catch (e) {
    console.error('❌ Error en PATCH /especialidades:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

app.get('/api/usuarios', async (req, res) => {
  const tipo = req.query.tipo ? `&tipo=eq.${req.query.tipo}` : '';
  res.json(await sb(`usuarios?select=id,nombre,email,telefono,tipo,estado,especialidad,dni,experiencia,matricula,trabajos_completados,promedio_estrellas,total_calificaciones,saldo_disponible,saldo_bloqueado,created_at&order=created_at.desc${tipo}`));
});

app.post('/api/usuarios/registro', async (req, res) => {
  const { nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password, direccion_residencia, direccion_trabajo } = req.body;
  const exists = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
  if (exists.length > 0) return res.status(400).json({ error: 'Ya existe una cuenta con ese email.' });

  // La dirección tiene que ser una dirección real (no se acepta cualquier texto)
  if (!direccion_residencia) return res.status(400).json({ error: 'Ingresá tu dirección.' });
  const coordsResidencia = await geocodificar(direccion_residencia);
  if (!coordsResidencia) return res.status(400).json({ error: 'No pudimos encontrar esa dirección. Revisá que esté bien escrita (calle, número y ciudad).' });
  let coordsTrabajo = coordsResidencia;
  const direccionTrabajoFinal = direccion_trabajo || direccion_residencia;
  if (tipo === 'socio' && direccion_trabajo) {
    coordsTrabajo = await geocodificar(direccion_trabajo);
    if (!coordsTrabajo) return res.status(400).json({ error: 'No pudimos encontrar la zona de trabajo. Revisá que esté bien escrita.' });
  }

  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash(password, 10);
  const estado = tipo === 'cliente' ? 'aprobado' : 'pendiente';
  const data = await sb('usuarios', 'POST', { nombre, email, telefono, tipo, especialidad, dni, experiencia, matricula, mensaje_solicitud, password_hash, estado, email_verificado: false });
  if (data.error || (Array.isArray(data) && data[0]?.code)) return res.status(400).json({ error: 'Error al registrar.' });
  const nuevoUsuario = data[0];

  try {
    await sb('ubicaciones', 'POST', {
      usuario_id: nuevoUsuario.id, etiqueta: 'Casa', direccion: direccion_residencia,
      lat: coordsResidencia.lat, lng: coordsResidencia.lng, zona: coordsResidencia.zona, tipo: 'residencia', predeterminada: true
    });
    if (tipo === 'socio') {
      await sb('ubicaciones', 'POST', {
        usuario_id: nuevoUsuario.id, etiqueta: 'Zona de trabajo', direccion: direccionTrabajoFinal,
        lat: coordsTrabajo.lat, lng: coordsTrabajo.lng, zona: coordsTrabajo.zona, tipo: 'trabajo', predeterminada: false
      });
    }
  } catch (e) { console.error('❌ Error creando ubicación inicial:', e.message); }

  try {
    const codigo = await generarYEnviarCodigo(email, 'registro');
    await emailCodigoVerificacion(nombre, email, codigo, 'registro');
  } catch (e) { console.error('❌ Error enviando código de registro:', e.message); }

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
  if (!user.email_verificado) return res.status(403).json({ error: 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada.' });
  if (user.estado === 'pendiente') return res.status(403).json({ error: 'Tu solicitud está pendiente de aprobación.' });
  if (user.estado === 'rechazado') return res.status(403).json({ error: 'Tu solicitud fue rechazada.' });
  const { password_hash, ...safeUser } = user;
  const token = jwt.sign({ id: user.id, tipo: user.tipo, email: user.email, nombre: user.nombre }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ ok: true, usuario: safeUser, token });
});

// ── CÓDIGOS DE EMAIL (confirmar registro / iniciar sesión sin contraseña) ──
// Cada 30 segundos revisa si hay códigos a punto de vencer (entre 1 y 2 minutos restantes) y avisa por email, una sola vez por código.
setInterval(async () => {
  try {
    const ahora = Date.now();
    const desde = new Date(ahora + 60 * 1000).toISOString();
    const hasta = new Date(ahora + 120 * 1000).toISOString();
    const rows = await sb(`codigos_login?usado=eq.false&recordado=eq.false&expira_at=gte.${desde}&expira_at=lte.${hasta}&select=*`);
    for (const c of rows) {
      const users = await sb(`usuarios?email=eq.${encodeURIComponent(c.email)}&select=nombre`);
      const nombre = users.length ? users[0].nombre : '';
      await emailCodigoPorVencer(nombre, c.email, c.tipo);
      await sb(`codigos_login?id=eq.${c.id}`, 'PATCH', { recordado: true });
    }
  } catch (e) { console.error('❌ Error chequeando códigos por vencer:', e.message); }
}, 30000);

async function generarYEnviarCodigo(email, tipo) {
  // Invalida cualquier código anterior sin usar de ese email+tipo (si llega tarde, ya no sirve)
  await sb(`codigos_login?email=eq.${encodeURIComponent(email)}&tipo=eq.${tipo}&usado=eq.false`, 'PATCH', { usado: true });
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const expira_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sb('codigos_login', 'POST', { email, codigo, tipo, expira_at, usado: false });
  return codigo;
}

app.post('/api/enviar-codigo', async (req, res) => {
  try {
    const { email, tipo } = req.body;
    if (!email || !['login', 'registro'].includes(tipo)) return res.status(400).json({ error: 'Datos inválidos.' });
    const users = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=id,nombre,estado,tipo,email_verificado`);
    if (!users.length) return res.status(404).json({ error: 'No encontramos una cuenta con ese email.' });
    const u = users[0];
    if (tipo === 'login') {
      if (!u.email_verificado) return res.status(403).json({ error: 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada.' });
      if (u.tipo === 'socio' && u.estado === 'pendiente') return res.status(403).json({ error: 'Tu solicitud está pendiente de aprobación.' });
      if (u.tipo === 'socio' && u.estado === 'rechazado') return res.status(403).json({ error: 'Tu solicitud fue rechazada.' });
    }
    const codigo = await generarYEnviarCodigo(email, tipo);
    await emailCodigoVerificacion(u.nombre, email, codigo, tipo);
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en /enviar-codigo:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo enviar el código.' });
  }
});

app.post('/api/verificar-codigo', async (req, res) => {
  try {
    const { email, codigo, tipo } = req.body;
    if (!email || !codigo || !['login', 'registro'].includes(tipo)) return res.status(400).json({ error: 'Datos inválidos.' });
    const rows = await sb(`codigos_login?email=eq.${encodeURIComponent(email)}&tipo=eq.${tipo}&codigo=eq.${codigo}&usado=eq.false&select=*&order=created_at.desc&limit=1`);
    if (!rows.length) return res.status(400).json({ error: 'Código incorrecto.' });
    const c = rows[0];
    if (new Date(c.expira_at) < new Date()) return res.status(400).json({ error: 'El código expiró. Pedí uno nuevo.' });
    await sb(`codigos_login?id=eq.${c.id}`, 'PATCH', { usado: true });

    if (tipo === 'registro') {
      const users = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=nombre,tipo`);
      await sb(`usuarios?email=eq.${encodeURIComponent(email)}`, 'PATCH', { email_verificado: true });
      if (users.length && users[0].tipo === 'cliente') emailBienvenidaCliente(users[0].nombre, email);
      return res.json({ ok: true });
    }

    // tipo === 'login': generar la sesión, igual que el login tradicional
    const users = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=*`);
    if (!users.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const user = users[0];
    const { password_hash, ...safeUser } = user;
    const token = jwt.sign({ id: user.id, tipo: user.tipo, email: user.email, nombre: user.nombre }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, usuario: safeUser, token });
  } catch (e) {
    console.error('❌ Error en /verificar-codigo:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo verificar el código.' });
  }
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
    const { etiqueta, direccion, tipo, lat, lng, piso_depto, referencias } = req.body;
    if (!etiqueta || !direccion) return res.status(400).json({ error: 'Faltan datos.' });
    let coords;
    if (lat != null && lng != null) {
      // Ya viene confirmado desde el mapa: solo necesitamos la zona
      const rev = await geocodificarInverso(lat, lng);
      coords = { lat, lng, zona: rev?.zona || null };
    } else {
      coords = await geocodificar(direccion);
      if (!coords) return res.status(400).json({ error: 'No pudimos encontrar esa dirección. Probá escribirla con más detalle (calle, ciudad).' });
    }
    const data = await sb('ubicaciones', 'POST', {
      usuario_id: req.usuario.id, etiqueta, direccion, lat: coords.lat, lng: coords.lng, zona: coords.zona,
      piso_depto: piso_depto || null, referencias: referencias || null,
      tipo: tipo || 'otra', predeterminada: false
    });
    res.json(data);
  } catch (e) {
    console.error('❌ Error en POST /ubicaciones:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo agregar la ubicación.', detalle: e.message });
  }
});

app.patch('/api/ubicaciones/:id', auth, async (req, res) => {
  try {
    const ub = await sb(`ubicaciones?id=eq.${req.params.id}&select=usuario_id`);
    if (!ub.length || req.usuario.id !== ub[0].usuario_id) return res.status(403).json({ error: 'No podés editar esta ubicación.' });
    const { etiqueta, tipo, piso_depto, referencias, direccion, lat, lng } = req.body;
    const patch = {};
    if (etiqueta !== undefined) patch.etiqueta = etiqueta;
    if (tipo !== undefined) patch.tipo = tipo;
    if (piso_depto !== undefined) patch.piso_depto = piso_depto || null;
    if (referencias !== undefined) patch.referencias = referencias || null;
    if (direccion !== undefined && lat != null && lng != null) {
      const rev = await geocodificarInverso(lat, lng);
      Object.assign(patch, { direccion, lat, lng, zona: rev?.zona || null });
    }
    res.json(await sb(`ubicaciones?id=eq.${req.params.id}`, 'PATCH', patch));
  } catch (e) {
    console.error('❌ Error en PATCH /ubicaciones:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo actualizar la ubicación.', detalle: e.message });
  }
});

app.patch('/api/ubicaciones/:id/predeterminada', auth, async (req, res) => {
  try {
    const ub = await sb(`ubicaciones?id=eq.${req.params.id}&select=usuario_id,tipo`);
    if (!ub.length || req.usuario.id !== ub[0].usuario_id) return res.status(403).json({ error: 'No podés modificar esta ubicación.' });
    await sb(`ubicaciones?usuario_id=eq.${req.usuario.id}`, 'PATCH', { predeterminada: false });
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
app.get('/api/pedidos', auth, async (req, res) => {
  try {
    const usuario_id_q = req.query.usuario_id ? `&usuario_id=eq.${req.query.usuario_id}` : '';
    const estado = req.query.estado ? `&estado=eq.${req.query.estado}` : '';
    const pedidos = await sb(`pedidos?select=*&order=created_at.desc${usuario_id_q}${estado}`);
    if (!Array.isArray(pedidos)) return res.json(pedidos);

    // Admin ve todo tal cual, sin filtrar ni redactar
    if (req.usuario.tipo === 'admin') return res.json(pedidos);

    // Solo la ubicación PREDETERMINADA cuenta para mostrarte trabajos cercanos
    const misUbs = await sb(`ubicaciones?usuario_id=eq.${req.usuario.id}&predeterminada=eq.true&select=lat,lng`);
    const origenes = misUbs.filter(u => u.lat != null && u.lng != null);

    const resultado = [];
    for (const p of pedidos) {
      const esPropio = req.usuario.id === p.usuario_id || req.usuario.id === p.profesional_id;
      if (esPropio) { resultado.push(p); continue; }
      // No es mío: nunca se manda lat/lng exacto, solo la zona y la distancia calculada acá adentro
      let distancia_km = null;
      if (origenes.length && p.lat != null && p.lng != null) {
        distancia_km = Math.min(...origenes.map(o => distanciaKm(o.lat, o.lng, p.lat, p.lng)));
      }
      if (distancia_km === null || distancia_km > 15) continue; // fuera de rango o sin ubicación: no se muestra
      const { lat, lng, direccion, ...sinCoordenadas } = p;
      resultado.push({ ...sinCoordenadas, distancia_km: Math.round(distancia_km * 10) / 10 });
    }
    res.json(resultado);
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
      const ub = await sb(`ubicaciones?id=eq.${ubicacion_id}&select=lat,lng,zona,etiqueta,direccion,piso_depto,referencias`);
      if (ub.length) {
        const u = ub[0];
        body.lat = u.lat; body.lng = u.lng; body.zona = u.zona || u.etiqueta;
        body.direccion = [u.direccion, u.piso_depto, u.referencias ? `(${u.referencias})` : null].filter(Boolean).join(' — ');
      }
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
    const body = req.body.estado ? { ...req.body, mensaje_email_enviado: false } : req.body;
    res.json(await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', body));
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
  try {
    const { pedido_id, socio_nombre, especialidad, precio_ofertado } = req.body;
    const socio_id = req.usuario.id; // nunca confiar en el socio_id que manda el cliente
    const precio_neto = Math.round(precio_ofertado * (1 - COMISION));
    const comision = Math.round(precio_ofertado * COMISION);
    const prev = await sb(`ofertas?pedido_id=eq.${pedido_id}&socio_id=eq.${socio_id}&select=id`);
    let data;
    if (prev.length > 0) {
      data = await sb(`ofertas?id=eq.${prev[0].id}`, 'PATCH', { precio_ofertado, precio_neto, comision, estado: 'pendiente', ultima_oferta_de: 'socio' });
    } else {
      data = await sb('ofertas', 'POST', { pedido_id, socio_id, socio_nombre, especialidad, precio_ofertado, precio_neto, comision, ultima_oferta_de: 'socio' });
    }
    // Avisar por email al dueño del pedido
    try {
      const pedidos = await sb(`pedidos?id=eq.${pedido_id}&select=usuario_id,servicio`);
      if (pedidos.length) {
        const clientes = await sb(`usuarios?id=eq.${pedidos[0].usuario_id}&select=nombre,email`);
        if (clientes.length) emailNuevaOferta(clientes[0].nombre, clientes[0].email, pedidos[0].servicio, precio_ofertado);
      }
    } catch (e) { console.error('❌ Error avisando nueva oferta:', e.message); }
    res.json(data);
  } catch (e) {
    console.error('❌ Error en POST /ofertas:', e.message, e.supabase || '');
    res.status(500).json({ error: 'No se pudo enviar la oferta.' });
  }
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
    const data = await sb(`ofertas?id=eq.${req.params.id}`, 'PATCH', { precio_ofertado: nuevo_precio, precio_neto, comision, estado: 'negociando', ultima_oferta_de: rol });
    // Avisar a la OTRA parte (si contraofertó el socio, avisar al cliente y viceversa)
    try {
      const pedidos = await sb(`pedidos?id=eq.${o.pedido_id}&select=usuario_id,servicio`);
      if (pedidos.length) {
        const destinatarioId = rol === 'socio' ? pedidos[0].usuario_id : o.socio_id;
        const destinatarios = await sb(`usuarios?id=eq.${destinatarioId}&select=nombre,email`);
        if (destinatarios.length) emailNuevaOferta(destinatarios[0].nombre, destinatarios[0].email, pedidos[0].servicio, nuevo_precio, true);
      }
    } catch (e) { console.error('❌ Error avisando contraoferta:', e.message); }
    res.json(data);
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
      comision: o.comision, codigo_verificacion: codigo, intentos_codigo: 0, chat_habilitado: true, mensaje_email_enviado: false
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
    codigo_verificacion: null, intentos_codigo: 0, chat_habilitado: false, mensaje_email_enviado: false
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
    await sb(`pedidos?id=eq.${req.params.id}`, 'PATCH', { codigo_usado: true, estado: 'completado', dinero_liberado: true, estado_pago: 'liberado', mensaje_email_enviado: false });
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
    const pedido = await sb(`pedidos?id=eq.${req.body.pedido_id}&select=chat_habilitado,usuario_id,profesional_id,servicio,mensaje_email_enviado`);
    if (!pedido.length || !pedido[0].chat_habilitado) return res.status(403).json({ error: 'El chat se habilita después del pago.' });
    if (req.usuario.id !== pedido[0].usuario_id && req.usuario.id !== pedido[0].profesional_id) {
      return res.status(403).json({ error: 'No sos parte de esta conversación.' });
    }
    const rol = req.usuario.id === pedido[0].profesional_id ? 'socio' : 'cliente';
    const data = await sb('mensajes', 'POST', { ...req.body, autor: req.usuario.nombre || req.body.autor, rol });
    // Avisar a la otra persona — una sola vez por trabajo, hasta que el pedido cambie de estado
    if (!pedido[0].mensaje_email_enviado) {
      try {
        const destinatarioId = rol === 'socio' ? pedido[0].usuario_id : pedido[0].profesional_id;
        if (destinatarioId) {
          const destinatarios = await sb(`usuarios?id=eq.${destinatarioId}&select=nombre,email`);
          if (destinatarios.length) {
            await emailNuevoMensaje(destinatarios[0].nombre, destinatarios[0].email, pedido[0].servicio);
            await sb(`pedidos?id=eq.${req.body.pedido_id}`, 'PATCH', { mensaje_email_enviado: true });
          }
        }
      } catch (e) { console.error('❌ Error avisando nuevo mensaje:', e.message); }
    }
    res.json(data);
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
