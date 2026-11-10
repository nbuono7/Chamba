require('./instrument'); // Sentry SIEMPRE primero, antes de cualquier otro require
const Sentry = require('@sentry/node');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fetch = async (url, options = {}) => { const {default:f} = await import('node-fetch'); return f(url, {...options, signal: options.signal || AbortSignal.timeout(30000)}); };
const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();
const { emailBienvenidaCliente, emailSocioAprobado, emailSocioRechazado, emailPedidoRecibido, emailCodigoVerificacion, emailNuevaOferta, emailNuevoMensaje, emailCodigoPorVencer, emailNuevaDisputa, emailRestablecerPassword } = require('./emailService');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: (origin,cb) => cb(null,!origin || origin === 'https://chamba-vert.vercel.app' || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin))) }));
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Cache-Control','no-store');next();});
const limited=(limit,windowMs=60000)=>rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Esperá unos minutos y volvé a probar.'}});
app.use('/api',limited(300));
app.use(['/api/usuarios/login','/api/verificar-codigo'],limited(30,15*60000));
app.use(['/api/enviar-codigo','/api/usuarios/olvide-password','/api/usuarios/registro'],limited(10,15*60000));
app.use(['/api/geocodificar','/api/geocodificar-buscar','/api/geocodificar-inverso'],limited(20));
app.use('/api/analizar',limited(8,15*60000));
app.use(['/api/usuarios/registro','/api/usuarios/solicitar-socio','/api/verificaciones-identidad'],limited(6,15*60000));
app.use(['/api/usuarios/registro','/api/usuarios/solicitar-socio','/api/verificaciones-identidad','/api/analizar','/api/reclamos'],express.json({limit:'60mb'}));
app.use(express.json({limit:'256kb'}));
const uuid = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
for (const param of ['id','pedido_id','socio_id']) app.param(param,(req,res,next,value)=>uuid(value)?next():res.status(400).json({error:'Identificador inválido.'}));
app.use('/api',(req,res,next)=>{
 for(const [key,value] of Object.entries({...req.query,...req.body})) {
   if((key==='id'||key.endsWith('_id')) && value!=null && value!=='' && !uuid(value)) return res.status(400).json({error:'Identificador inválido.'});
   if(typeof value==='string' && value.length>12000) return res.status(400).json({error:'El texto es demasiado largo.'});
 }
 next();
});
const accountLimit=rateLimit({windowMs:15*60000,limit:12,standardHeaders:'draft-8',legacyHeaders:false,keyGenerator:req=>crypto.createHash('sha256').update(String(req.body?.identificador||req.body?.email||'').trim().toLowerCase()).digest('hex'),message:{error:'Demasiados intentos para esta cuenta. Esperá unos minutos.'}});
app.use(['/api/usuarios/login','/api/enviar-codigo','/api/usuarios/olvide-password','/api/verificar-codigo'],accountLimit);
const aiAccountLimit=rateLimit({windowMs:15*60000,limit:20,keyGenerator:req=>req.usuario.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Alcanzaste el límite de consultas. Probá en unos minutos.'}});
// Express 4 does not forward async rejections automatically.
for(const verb of ['get','post','patch','delete']) {
 const register=app[verb].bind(app);
 app[verb]=(path,...handlers)=>register(path,...handlers.map(fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next)));
}


// Red de seguridad: si algo falla en una ruta y no fue capturado, no tumbar el servidor.
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled error:', err?.message || err);
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const COMISION = 0.13;
const PISO_COMISION = 1000; // piso fijo en pesos, para que trabajos muy chicos (< ~$7.700) no dejen una comisión insignificante

// Rubros con matrícula habilitante exigida por ley/normativa (debe reflejar lo mismo que
// RUBROS_MATRICULA_OBLIGATORIA en registro.html y panel-socio.html — si se agrega un rubro
// ahí, agregarlo también acá para que la validación del servidor no quede desactualizada).
const RUBROS_MATRICULA_OBLIGATORIA = ['Gas', 'Electricidad', 'Plomería'];

/** Valida que una contraseña tenga más de 6 caracteres y combine letras, números y símbolos. */
function validarPassword(password) {
  if (typeof password!=='string' || password.length <= 6 || Buffer.byteLength(password)>72) return { ok: false, error: 'La contraseña tiene que tener más de 6 caracteres.' };
  if (!/[A-Za-z]/.test(password)) return { ok: false, error: 'La contraseña tiene que incluir al menos una letra.' };
  if (!/[0-9]/.test(password)) return { ok: false, error: 'La contraseña tiene que incluir al menos un número.' };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, error: 'La contraseña tiene que incluir al menos un símbolo (ej: !@#$%&).' };
  return { ok: true };
}

/** Valida el formato de un nombre de usuario: 3 a 20 caracteres, solo minúsculas, números y guion bajo. */
function validarNombreUsuario(nombre_usuario) {
  if (!nombre_usuario) return { ok: false, error: 'Elegí un nombre de usuario.' };
  if (!/^[a-z0-9_]{3,20}$/.test(nombre_usuario)) {
    return { ok: false, error: 'El nombre de usuario tiene que tener entre 3 y 20 caracteres, solo minúsculas, números y guion bajo (_), sin espacios ni acentos.' };
  }
  return { ok: true };
}

/** Calcula la comisión de ChamBA sobre un precio acordado: el mayor entre el % y el piso fijo. */
function calcularComision(precioAcordado, config = {comision_bps:1300,minimo_centavos:100000}) {
  const comisionPorcentual = Math.round(precioAcordado * config.comision_bps / 100) / 100;
  const comision = Math.max(comisionPorcentual, config.minimo_centavos/100);
  const precio_neto = Math.max(0,Math.round(precioAcordado) - comision);
  return { comision, precio_neto };
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error('⚠️  Falta la variable de entorno JWT_SECRET — configurala en Render.');

// Exige que la persona esté logueada. Guarda sus datos (id, tipo, email) en req.usuario.
async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
  try {
    const claims = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET, {algorithms:['HS256']});
    if(!uuid(claims.id)) return res.status(401).json({error:'Sesión inválida.'});
    const [current] = await sb(`usuarios?id=eq.${claims.id}&select=id,tipo,email,nombre,estado,email_verificado,session_version,especialidad`);
    if(!current || !['aprobado','baja','suspendido'].includes(current.estado) || !current.email_verificado || current.tipo!==claims.tipo || current.session_version!==(claims.sv||0)) return res.status(401).json({error:'Tu sesión cambió. Iniciá sesión nuevamente.'});
    const limitedState=current.estado!=='aprobado';
    if(limitedState && current.tipo==='admin')return res.status(403).json({error:'El acceso administrativo de esta cuenta está suspendido.'});
    if(limitedState && claims.scope!=='limited')return res.status(401).json({error:'Tu sesión cambió. Iniciá sesión nuevamente.'});
    if(limitedState && !/^\/api\/(custodia\/(me|config|trabajos)|reclamos(?:\/|$)|saldo(?:\/|$)|notificaciones(?:\/|$))/.test(req.path))return res.status(403).json({error:'Tu cuenta tiene acceso limitado a reclamos y retiro de saldo.'});
    req.usuario = current;
    next();
  } catch (e) {
    return res.status(e.status===503?503:401).json({ error: e.status===503?'No pudimos verificar tu sesión. Intentá nuevamente.':'Tu sesión expiró. Iniciá sesión de nuevo.' });
  }
}
// Exige que además sea admin.
function soloAdmin(req, res, next) {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({ error: 'No tenés permiso para hacer esto.' });
  next();
}

const sbH = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
const sb = async (path, method='GET', body=null) => {
 try {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: body ? { ...sbH, 'Prefer': 'return=representation' } : sbH,
    body: body ? JSON.stringify(body) : null
  });
  const data = r.status===204 ? [] : await r.json();
  if (!r.ok) {
    console.error('Supabase request failed:',method,r.status,data?.code);
    const err = new Error(data?.code==='P0001' ? data.message : 'No se pudo completar la operación.');
    err.supabase = data;
    err.status = data?.code==='P0001' ? 409 : 503;
    throw err;
  }
  return data;
 } catch (error) {
   // Transport/JSON failures are outages, not expired sessions.
   if (error.status) throw error;
   throw Object.assign(new Error('No pudimos conectar con la base de datos. Intentá nuevamente.'), {status:503});
 }
};

function signToken(user) { return jwt.sign({id:user.id,tipo:user.tipo,email:user.email,nombre:user.nombre,sv:user.session_version||0,scope:['baja','suspendido'].includes(user.estado)?'limited':'full'},JWT_SECRET,{expiresIn:'7d',algorithm:'HS256'}); }
const secretHash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const splitServices=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
function textValue(value,max=2000) { if(typeof value!=='string'||!value.trim()||value.length>max) {const e=new Error('Completá los campos con datos válidos.');e.status=400;throw e;}return value.trim(); }
function pick(body,keys) {return Object.fromEntries(keys.filter(k=>body[k]!==undefined).map(k=>[k,body[k]]));}
async function sbAll(path) {const rows=[];for(let offset=0;;offset+=500){const page=await sb(path+`&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)return rows;if(offset>=99500)throw Object.assign(Error('Hay demasiados resultados. Acotá la búsqueda.'),{status:413});}}
async function jobAction(req,res,action,id=req.params.id,data={}) {
 try {
 const out=await sb('rpc/chamba_job_action','POST',{p_actor:req.usuario.id,p_action:action,p_id:id,p_data:data});
 if(!out.error && !out.duplicate && ['offer','counter','partner_agree'].includes(action)) {
  try {
   const offer=action==='partner_agree'?(await sb(`ofertas?id=eq.${id}&select=*`))[0]:out;
   const [job]=await sb(`pedidos?id=eq.${offer.pedido_id}&select=usuario_id,servicio`);
   const recipient=req.usuario.id===offer.socio_id?job.usuario_id:offer.socio_id;
   const [user]=await sb(`usuarios?id=eq.${recipient}&select=nombre,email`);
   if(user)await emailNuevaOferta(user.nombre,user.email,job.servicio,offer.precio_ofertado,action!=='offer');
  } catch(e) { console.error('No se pudo enviar el aviso de oferta:',e.message); }
 }
 return res.status(out.error?400:200).json(out);
 }
 catch(e){return res.status(e.status||500).json({error:e.message});}
}
// A single-instance queue, bounded cache and explicit search respect public Nominatim limits.
let geoQueue=Promise.resolve(),geoLast=0,geoPending=0;const geoCache=new Map();
async function geoFetch(url,options){
 const hit=geoCache.get(url);if(hit && Date.now()-hit.at<86400000)return {json:async()=>hit.data};
 if(geoPending>=20)throw Object.assign(Error('El buscador de direcciones está ocupado. Intentá en unos segundos.'),{status:429});
 geoPending++;
 const task=geoQueue.catch(()=>{}).then(async()=>{
  await new Promise(r=>setTimeout(r,Math.max(0,1100-(Date.now()-geoLast))));geoLast=Date.now();
  const response=await fetch(url,options);if(!response.ok)throw Error('No se pudo consultar la ubicación.');const data=await response.json();
  if(geoCache.size>=500)geoCache.delete(geoCache.keys().next().value);geoCache.set(url,{at:Date.now(),data});return {json:async()=>data};
 }).finally(()=>geoPending--);geoQueue=task;return task;
}
// Convierte una dirección de texto en coordenadas (lat/lng) usando OpenStreetMap. Devuelve null si no la encuentra.
async function geocodificar(direccion) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&addressdetails=1&q=${encodeURIComponent(direccion)}`;
    const r = await geoFetch(url, { headers: { 'User-Agent': 'ChamBA/1.0 https://chamba-vert.vercel.app' } });
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
// Búsqueda explícita: no se consulta Nominatim mientras la persona escribe.
async function buscarDirecciones(texto) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=ar&addressdetails=1&q=${encodeURIComponent(texto)}`;
    const r = await geoFetch(url, { headers: { 'User-Agent': 'ChamBA/1.0 https://chamba-vert.vercel.app' } });
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
    const r = await geoFetch(url, { headers: { 'User-Agent': 'ChamBA/1.0 https://chamba-vert.vercel.app' } });
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
  if (typeof q!=='string' || q.trim().length < 3 || q.length>300) return res.json([]);
  res.json(await buscarDirecciones(q));
});
app.get('/api/geocodificar-inverso', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180) return res.status(400).json({ error: 'Coordenadas inválidas.' });
  const r = await geocodificarInverso(lat, lng);
  if (!r) return res.status(404).json({ error: 'No pudimos identificar esa ubicación.' });
  res.json(r);
});

// Validación real de archivos subidos: tamaño máximo y que el contenido coincida con el tipo declarado (no solo la extensión, que se puede falsificar)
const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const TAMANO_MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB

function detectarTipoReal(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

function validarArchivo(base64Data, mimeDeclarado) {
  if (!MIME_PERMITIDOS.includes(mimeDeclarado)) {
    return { ok: false, error: `Tipo de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, WEBP) o PDF.` };
  }
  let buffer;
  try { buffer = Buffer.from(base64Data, 'base64'); } catch (e) { return { ok: false, error: 'El archivo está dañado o no se pudo leer.' }; }
  if (!buffer.length) return { ok: false, error: 'El archivo está vacío.' };
  if (buffer.length > TAMANO_MAX_ARCHIVO) return { ok: false, error: 'El archivo pesa demasiado (máximo 8MB por archivo).' };
  const tipoReal = detectarTipoReal(buffer);
  if (!tipoReal) return { ok: false, error: 'No pudimos verificar que el archivo sea una imagen o PDF válido.' };
  if (tipoReal !== mimeDeclarado) return { ok: false, error: 'El contenido del archivo no coincide con el tipo esperado. Probá subirlo de nuevo.' };
  return { ok: true, buffer };
}

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
async function borrarArchivos(paths) {
 if(!paths.length)return;
 try {const r=await fetch(`${SUPABASE_URL}/storage/v1/object/identificaciones`,{method:'DELETE',headers:sbH,body:JSON.stringify({prefixes:paths})});if(!r.ok)throw Error('Storage cleanup failed');}
 catch(e){console.error('Archivos huérfanos pendientes de limpieza:',paths,e.message);}
}
async function recuperarCarga(uploads, lookup, writeStarted, error) {
  if (writeStarted) {
    try {
      const [saved] = await sb(lookup);
      if (saved) return saved;
    } catch { return null; } // Cannot establish whether the files are referenced.
    // A timeout can leave a transaction running even after a read returns empty.
    // Delete only after a definitive database rejection, never on an ambiguous write.
    if (!/^[0-9A-Z]{5}$/.test(error.supabase?.code||'')) return null;
  }
  await borrarArchivos(uploads);
  return null;
}
async function validarEspecialidades(value) {
 const requested=splitServices(value),active=await sb('especialidades?activa=eq.true&select=nombre');
 if(!requested.length||requested.some(s=>!active.some(a=>a.nombre===s)))throw Object.assign(Error('Elegí una especialidad disponible.'),{status:400});
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
  const uploads=[];
  const submissionId=crypto.randomUUID();
  let writeStarted=false;
  try {
    if(req.usuario.tipo!=='socio')return res.status(403).json({error:'Esta opción es para Socios.'});
    const { monotributo, facturas } = req.body; // monotributo: {data,mime}; facturas: [{data,mime}, ...] hasta 3
    if (!monotributo || !monotributo.data || !monotributo.mime) return res.status(400).json({ error: 'Subí el comprobante de pago del monotributo (el más reciente).' });
    if (!Array.isArray(facturas) || !facturas.length) return res.status(400).json({ error: 'Subí al menos un archivo con tus últimas 3 facturas a clientes.' });
    if (facturas.length > 4) return res.status(400).json({ error: 'Máximo 4 archivos en la sección de facturas.' });

    // Validar TODO antes de subir nada (tipo real de archivo + tamaño)
    const vMono = validarArchivo(monotributo.data, monotributo.mime);
    if (!vMono.ok) return res.status(400).json({ error: 'Comprobante de monotributo: ' + vMono.error });
    for (const f of facturas) {
      const v = validarArchivo(f.data, f.mime);
      if (!v.ok) return res.status(400).json({ error: 'Factura: ' + v.error });
    }

    const extMono = (monotributo.mime.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const pathMono = `${req.usuario.id}/monotributo_${submissionId}.${extMono}`;
    uploads.push(pathMono);await subirArchivo('identificaciones', pathMono, monotributo.data, monotributo.mime);

    const pathsFacturas = [];
    for (let i = 0; i < facturas.length; i++) {
      const ext = (facturas[i].mime.split('/')[1] || 'bin').replace('jpeg', 'jpg');
      const path = `${req.usuario.id}/factura_${submissionId}_${i}.${ext}`;
      uploads.push(path);
      await subirArchivo('identificaciones', path, facturas[i].data, facturas[i].mime);
      pathsFacturas.push(path);
    }

    const body = { id: submissionId, socio_id: req.usuario.id, estado: 'pendiente', comprobante_monotributo: pathMono };
    ['factura_cliente_1', 'factura_cliente_2', 'factura_cliente_3', 'factura_cliente_4'].forEach((campo, i) => { if (pathsFacturas[i]) body[campo] = pathsFacturas[i]; });
    writeStarted=true;
    res.json(await sb('verificaciones_identidad', 'POST', body));
  } catch (e) {
    const saved=await recuperarCarga(uploads,`verificaciones_identidad?id=eq.${submissionId}&socio_id=eq.${req.usuario.id}&select=*`,writeStarted,e);
    if(saved)return res.json([saved]);
    console.error('❌ Error en POST /verificaciones-identidad:', e.message, e.supabase?.code || '');
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
      row.archivos = []; // [{ label, url }]
      if (row.comprobante_monotributo) {
        const url = await firmarUrl('identificaciones', row.comprobante_monotributo);
        if (url) row.archivos.push({ label: 'Monotributo', url });
      }
      let n = 1;
      for (const campo of ['factura_cliente_1', 'factura_cliente_2', 'factura_cliente_3', 'factura_cliente_4']) {
        if (row[campo]) { const url = await firmarUrl('identificaciones', row[campo]); if (url) row.archivos.push({ label: 'Factura ' + n, url }); }
        n++;
      }
    }
    res.json(rows);
  } catch (e) {
    console.error('❌ Error en GET /verificaciones-identidad:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudieron cargar las verificaciones.' });
  }
});

app.patch('/api/verificaciones-identidad/:id', auth, soloAdmin, async (req, res) => {
  try {
    const { estado } = req.body;
    if(!['aprobada','rechazada'].includes(estado))return res.status(400).json({error:'Estado inválido.'});
    res.json(await sb(`verificaciones_identidad?id=eq.${req.params.id}`, 'PATCH', { estado }));
  } catch (e) {
    console.error('❌ Error en PATCH /verificaciones-identidad:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

app.get('/', (req, res) => res.json({ status: 'Chamba API ✅' }));
app.get('/health',async(req,res)=>{await sb('especialidades?select=id&limit=1');res.json({ok:true});});
app.get('/api/config',async(_,res)=>{const [c]=await sb('chamba_config?select=comision_bps,minimo_centavos');res.json({comision_pct:c.comision_bps/100,piso_comision:c.minimo_centavos/100,precio_minimo:Math.floor(c.minimo_centavos/100)+1});});

// ── IA ──
app.post('/api/analizar', auth, aiAccountLimit, async (req, res) => {
  const { servicio, descripcion, fotos } = req.body;
  if(typeof servicio!=='string'||(descripcion && typeof descripcion!=='string')||(fotos && !Array.isArray(fotos))) return res.status(400).json({error:'Datos inválidos.'});
  if (fotos?.length > 4) return res.status(400).json({ error: 'Máximo 4 fotos.' });
  const content = [];
  if (fotos?.length) {
    for (const b64 of fotos) {
      let buffer;
      try { buffer = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).json({ error: 'Una de las fotos está dañada.' }); }
      if (buffer.length > TAMANO_MAX_ARCHIVO) return res.status(400).json({ error: 'Una de las fotos pesa demasiado (máximo 8MB).' });
      const tipoReal = detectarTipoReal(buffer);
      if (!tipoReal || !tipoReal.startsWith('image/')) return res.status(400).json({ error: 'Una de las fotos no es una imagen válida (solo JPG, PNG o WEBP).' });
      content.push({ type: 'image', source: { type: 'base64', media_type: tipoReal, data: b64 } });
    }
  }
  content.push({ type: 'text', text: `Sos el asistente de ChamBA, empresa argentina de servicios del hogar. Servicio: "${servicio}". Problema: ${descripcion||'(ver fotos)'}. Evaluá la urgencia real del problema (¿puede esperar días, o hay riesgo de daño mayor/inseguridad si no se atiende ya?). El precio sugerido debe reflejar esa urgencia: a mayor urgencia, mayor precio esperable, ya que implica prioridad y rapidez para el profesional. Respondé SOLO en JSON sin backticks: {"profesional":"...","urgencia":"Alta/Media/Baja","diagnostico":"...","precio_min":0,"precio_max":0,"precio_sugerido":0,"recomendacion":"...","puede_solo":false}. El precio_sugerido es el promedio de min y max redondeado.` });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5', max_tokens: 4000, messages: [{ role: 'user', content }] })
    });
    const data = await r.json();
    if (!r.ok || data.error) { console.error('Error del proveedor IA:',r.status); return res.status(502).json({ error: 'El diagnóstico no está disponible en este momento. Podés publicar tu solicitud sin IA.' }); }
    const textoCompleto = data.content.map(i => i.text||'').join('');
    let result;
    try {
      result = JSON.parse(textoCompleto.replace(/```json|```/g,'').trim());
    } catch (e) {
      console.error('La IA no devolvió JSON válido');
      return res.status(500).json({ error: 'La IA no pudo procesar este pedido, probá reformular la descripción.' });
    }
    if(!result || !['Alta','Media','Baja'].includes(result.urgencia) || ['profesional','diagnostico','recomendacion'].some(k=>typeof result[k]!=='string'||result[k].length>6000) || ['precio_min','precio_max','precio_sugerido'].some(k=>!Number.isFinite(result[k])||result[k]<0||result[k]>100000000) || result.precio_min>result.precio_max) return res.status(502).json({error:'La IA no devolvió una estimación válida. Probá de nuevo.'});
    result.puede_solo = result.puede_solo===true;
    const [feeConfig]=await sb('chamba_config?select=comision_bps,minimo_centavos');
    result.comision_pct = feeConfig.comision_bps / 100;
    result.precio_cliente = Math.round(result.precio_sugerido);
    { const { comision, precio_neto } = calcularComision(result.precio_cliente,feeConfig);
      result.precio_socio = precio_neto;
      result.comision_chamba = comision; }
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
    if(typeof activa!=='boolean')return res.status(400).json({error:'Estado inválido.'});
    res.json(await sb(`especialidades?id=eq.${req.params.id}`, 'PATCH', { activa }));
  } catch (e) {
    console.error('❌ Error en PATCH /especialidades:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

app.get('/api/usuarios', auth, async (req, res) => {
  const tipo = req.query.tipo ? `&tipo=eq.${encodeURIComponent(req.query.tipo)}` : '';
  const propietario = req.usuario.tipo === 'admin' ? '' : `&id=eq.${encodeURIComponent(req.usuario.id)}`;
  res.json(await sb(`usuarios?select=id,nombre,email,telefono,tipo,estado,especialidad,dni,experiencia,matricula,matricula_organismo,nombre_usuario,nombre_usuario_actualizado_at,conversion_desde_cliente,trabajos_completados,promedio_estrellas,total_calificaciones,saldo_disponible,saldo_bloqueado,created_at&order=created_at.desc${tipo}${propietario}`));
});

// Fotos de DNI y perfil de un Socio, solo para el admin (URLs firmadas, el bucket es privado)
app.get('/api/usuarios/:id/fotos-verificacion', auth, soloAdmin, async (req, res) => {
  try {
    const rows = await sb(`usuarios?id=eq.${req.params.id}&select=dni_foto_path,foto_perfil_path`);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const { dni_foto_path, foto_perfil_path } = rows[0];
    const dni_foto_url = dni_foto_path ? await firmarUrl('identificaciones', dni_foto_path) : null;
    const foto_perfil_url = foto_perfil_path ? await firmarUrl('identificaciones', foto_perfil_path) : null;
    res.json({ dni_foto_url, foto_perfil_url });
  } catch (e) {
    console.error('❌ Error en GET fotos-verificacion:', e.message);
    res.status(500).json({ error: 'No se pudieron cargar las fotos.' });
  }
});

/** Genera hasta 3 variantes disponibles de un nombre de usuario ya tomado. */
async function generarSugerenciasUsuario(base) {
  const sugerencias = [];
  const candidatos = [
    base + Math.floor(Math.random() * 90 + 10),           // ej: juan23
    base + '_' + Math.floor(Math.random() * 90 + 10),      // ej: juan_45
    base + new Date().getFullYear().toString().slice(-2),  // ej: juan26
    base + Math.floor(Math.random() * 900 + 100),          // ej: juan734
    base + '_oficial',
  ];
  for (const c of candidatos) {
    if (sugerencias.length >= 3) break;
    const cNorm = c.toLowerCase().slice(0, 20);
    if (!/^[a-z0-9_]{3,20}$/.test(cNorm) || sugerencias.includes(cNorm)) continue;
    const existe = await sb(`usuarios?nombre_usuario=eq.${encodeURIComponent(cNorm)}&select=id`);
    if (existe.length === 0) sugerencias.push(cNorm);
  }
  return sugerencias;
}

// Chequeo de disponibilidad en vivo mientras el usuario escribe (sin auth, es antes de tener cuenta)
app.get('/api/usuarios/chequear-usuario', async (req, res) => {
  try {
    const nombre_usuario = (req.query.nombre_usuario || '').toLowerCase().trim();
    const v = validarNombreUsuario(nombre_usuario);
    if (!v.ok) return res.json({ disponible: false, error: v.error });
    const existe = await sb(`usuarios?nombre_usuario=eq.${encodeURIComponent(nombre_usuario)}&select=id`);
    if (existe.length === 0) return res.json({ disponible: true });
    const sugerencias = await generarSugerenciasUsuario(nombre_usuario);
    res.json({ disponible: false, error: 'Ese usuario ya existe.', sugerencias });
  } catch (e) {
    res.status(500).json({ disponible: false, error: 'No se pudo chequear.' });
  }
});

app.post('/api/usuarios/registro', async (req, res) => {
  const { nombre, telefono, tipo, especialidad, dni, experiencia, matricula, matricula_organismo, mensaje_solicitud, password, nombre_usuario, direccion_residencia, direccion_trabajo, dni_foto, foto_perfil } = req.body;
  const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof nombre!=='string'||!nombre.trim()||nombre.length>100)return res.status(400).json({error:'Revisá tu nombre y email.'});
  if (!['cliente', 'socio'].includes(tipo)) return res.status(400).json({ error: 'Tipo de cuenta inválido.' });
  const exists = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=id`);
  if (exists.length > 0) return res.status(400).json({ error: 'Ya existe una cuenta con ese email.' });

  const vPass = validarPassword(password);
  if (!vPass.ok) return res.status(400).json({ error: vPass.error });

  const nombreUsuarioNormalizado = (nombre_usuario || '').toLowerCase().trim();
  const vUsuario = validarNombreUsuario(nombreUsuarioNormalizado);
  if (!vUsuario.ok) return res.status(400).json({ error: vUsuario.error });
  const usuarioExiste = await sb(`usuarios?nombre_usuario=eq.${encodeURIComponent(nombreUsuarioNormalizado)}&select=id`);
  if (usuarioExiste.length > 0) return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso. Elegí otro.' });

  if (tipo === 'socio' && splitServices(especialidad).some(e=>RUBROS_MATRICULA_OBLIGATORIA.includes(e)) && (!matricula || !matricula_organismo)) {
    return res.status(400).json({ error: `${especialidad} exige matrícula habilitante: completá el número y el organismo que te la otorgó.` });
  }

  if(tipo==='socio') await validarEspecialidades(especialidad);
  // Los Socios tienen que subir foto de DNI y foto de perfil (con el rostro visible) para poder registrarse.
  // La foto de perfil no se muestra a ningún Cliente hasta que paga por el trabajo (evita discriminación por aspecto antes de esa instancia).
  if (tipo === 'socio') {
    if (!dni_foto || !dni_foto.data || !dni_foto.mime) return res.status(400).json({ error: 'Subí una foto de tu DNI (frente).' });
    if (!foto_perfil || !foto_perfil.data || !foto_perfil.mime) return res.status(400).json({ error: 'Subí una foto de perfil donde se te vea la cara.' });
    const vDni = validarArchivo(dni_foto.data, dni_foto.mime);
    if (!vDni.ok) return res.status(400).json({ error: 'Foto de DNI: ' + vDni.error });
    const vPerfil = validarArchivo(foto_perfil.data, foto_perfil.mime);
    if (!vPerfil.ok) return res.status(400).json({ error: 'Foto de perfil: ' + vPerfil.error });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(dni_foto.mime) || !['image/jpeg', 'image/png', 'image/webp'].includes(foto_perfil.mime)) {
      return res.status(400).json({ error: 'La foto de DNI y la foto de perfil tienen que ser imágenes (JPG, PNG o WEBP), no PDF.' });
    }
  }

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
  const uid=crypto.randomUUID(), uploads=[];
  let writeStarted=false;
  const user={id:uid,nombre:nombre.trim(),email,telefono,tipo,especialidad,dni,experiencia,matricula,matricula_organismo,mensaje_solicitud,password_hash,estado,nombre_usuario:nombreUsuarioNormalizado};
  try {
    if(tipo==='socio') {
      for(const [field,file] of [['dni_foto_path',dni_foto],['foto_perfil_path',foto_perfil]]) {
        const path=`${uid}/${field}_${crypto.randomUUID()}.${file.mime.split('/')[1].replace('jpeg','jpg')}`;
        uploads.push(path);await subirArchivo('identificaciones',path,file.data,file.mime);user[field]=path;
      }
    }
    const locations=[{etiqueta:'Casa',direccion:direccion_residencia,...coordsResidencia,tipo:'residencia',predeterminada:true}];
    if(tipo==='socio')locations.push({etiqueta:'Zona de trabajo',direccion:direccionTrabajoFinal,...coordsTrabajo,tipo:'trabajo',predeterminada:false});
    writeStarted=true;
    await sb('rpc/chamba_register','POST',{p_user:user,p_locations:locations});
  } catch(e) {
    const saved=await recuperarCarga(uploads,`usuarios?id=eq.${uid}&select=id`,writeStarted,e);
    if(!saved)throw e;
  }

  try {
    const codigo = await generarYEnviarCodigo(email, 'registro');
    await emailCodigoVerificacion(nombre, email, codigo, 'registro');
  } catch (e) { console.error('No se pudo enviar el código de registro:', e.message);return res.json({ok:true,tipo,estado,aviso:'Tu cuenta se creó, pero no pudimos enviar el email. Pedí otro código desde la pantalla de verificación.'}); }

  res.json({ ok: true, tipo, estado });
});

app.post('/api/usuarios/login', async (req, res) => {
  const { identificador, password } = req.body;
  if(typeof identificador!=='string'||typeof password!=='string')return res.status(400).json({error:'Completá usuario y contraseña.'});
  if (!identificador) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  const idNorm = textValue(identificador,254).toLowerCase();
  const users = await sb(`usuarios?${idNorm.includes('@')?'email':'nombre_usuario'}=eq.${encodeURIComponent(idNorm)}&select=*`);
  if (!users.length) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  const user = users[0];
  const bcrypt = require('bcryptjs');
  const ok = await bcrypt.compare(password, user.password_hash || '');
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  if (!user.email_verificado) return res.status(403).json({ error: 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada.' });
  if (user.estado === 'pendiente') return res.status(403).json({ error: 'Tu solicitud está pendiente de aprobación.' });
  if (user.estado === 'rechazado') return res.status(403).json({ error: 'Tu solicitud fue rechazada.' });
  if (!['aprobado','baja','suspendido'].includes(user.estado) || !user.email_verificado) return res.status(403).json({ error: 'Tu cuenta fue suspendida. Contactanos si creés que es un error.' });
  const { password_hash, ...safeUser } = user;
  const token = signToken(user);
  res.json({ ok: true, usuario: safeUser, token });
});

// Pide el link de recuperación de contraseña. Responde siempre "ok" exista o no la cuenta,
// para no revelarle a un desconocido qué emails están registrados en ChamBA.
app.post('/api/usuarios/olvide-password', async (req, res) => {
  try {
    const { identificador } = req.body;
    if (!identificador) return res.status(400).json({ error: 'Ingresá tu usuario o email.' });
    const idNorm = textValue(identificador,254).toLowerCase();
    const users = await sb(`usuarios?${idNorm.includes('@')?'email':'nombre_usuario'}=eq.${encodeURIComponent(idNorm)}&select=id,nombre,email`);
    if (users.length) {
      const user = users[0];
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const expira_at = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora
      await sb('password_reset_tokens', 'POST', { email: user.email, token:secretHash(token), expira_at, usado: false });
      const link = `https://chamba-vert.vercel.app/restablecer-password?token=${token}`;
      await emailRestablecerPassword(user.nombre, user.email, link);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en POST /usuarios/olvide-password:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo procesar el pedido.' });
  }
});

// Confirma el link y cambia la contraseña.
app.post('/api/usuarios/restablecer-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Faltan datos.' });
    const vPass = validarPassword(password);
    if (!vPass.ok) return res.status(400).json({ error: vPass.error });

    if(typeof token!=='string'||!/^([a-f0-9]{64})$/.test(token))return res.status(400).json({error:'Link inválido.'});
    const password_hash=await require('bcryptjs').hash(password,10);
    await sb('rpc/chamba_reset_password','POST',{p_token:secretHash(token),p_password_hash:password_hash});
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en POST /usuarios/restablecer-password:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo restablecer la contraseña.' });
  }
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
  const codigo=String(crypto.randomInt(100000,1000000));
  await sb('rpc/chamba_issue_code','POST',{p_email:email,p_tipo:tipo,p_hash:secretHash(codigo)});
  return codigo;
}

app.post('/api/enviar-codigo', async (req, res) => {
  try {
    const { identificador, tipo } = req.body;
    if (!identificador || !['login', 'registro'].includes(tipo)) return res.status(400).json({ error: 'Datos inválidos.' });
    const idNorm = textValue(identificador,254).toLowerCase();
    const users = tipo === 'registro'
      ? await sb(`usuarios?email=eq.${encodeURIComponent(idNorm)}&select=id,nombre,email,estado,tipo,email_verificado`)
      : await sb(`usuarios?${idNorm.includes('@')?'email':'nombre_usuario'}=eq.${encodeURIComponent(idNorm)}&select=id,nombre,email,estado,tipo,email_verificado`);
    if (!users.length) return res.status(404).json({ error: tipo === 'registro' ? 'No encontramos una cuenta con ese email.' : 'No encontramos una cuenta con ese usuario o email.' });
    const u = users[0];
    if (tipo === 'login') {
      if (!u.email_verificado) return res.status(403).json({ error: 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada.' });
      if (u.tipo === 'socio' && u.estado === 'pendiente') return res.status(403).json({ error: 'Tu solicitud está pendiente de aprobación.' });
      if (u.estado === 'rechazado') return res.status(403).json({ error: 'Tu solicitud fue rechazada.' });

    }
    const codigo = await generarYEnviarCodigo(u.email, tipo);
    await emailCodigoVerificacion(u.nombre, u.email, codigo, tipo);
    res.json({ ok: true, email: u.email });
  } catch (e) {
    console.error('❌ Error en /enviar-codigo:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo enviar el código.' });
  }
});

app.post('/api/verificar-codigo', async (req, res) => {
  try {
    const { email, codigo, tipo } = req.body;
    if (!email || !codigo || !['login', 'registro'].includes(tipo)) return res.status(400).json({ error: 'Datos inválidos.' });
    if(typeof codigo!=='string'||!/^\d{6}$/.test(codigo)||typeof email!=='string')return res.status(400).json({error:'Código incorrecto.'});
    const verified=await sb('rpc/chamba_consume_code','POST',{p_email:email,p_tipo:tipo,p_hash:secretHash(codigo)});
    if(!verified.ok)return res.status(400).json({error:'Código incorrecto, vencido o con demasiados intentos.'});
    if(tipo==='registro')return res.json({ok:true});
    // tipo === 'login': generar la sesión, igual que el login tradicional
    const users = await sb(`usuarios?email=eq.${encodeURIComponent(email)}&select=*`);
    if (!users.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const user = users[0];
    if (!['aprobado','baja','suspendido'].includes(user.estado) || !user.email_verificado) return res.status(403).json({ error: 'Tu cuenta fue suspendida. Contactanos si creés que es un error.' });
    const { password_hash, ...safeUser } = user;
    const token = signToken(user);
    res.json({ ok: true, usuario: safeUser, token });
  } catch (e) {
    console.error('❌ Error en /verificar-codigo:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo verificar el código.' });
  }
});

// Cambiar el nombre de usuario propio — limitado a una vez cada 3 meses.
app.post('/api/usuarios/cambiar-usuario', auth, async (req, res) => {
  try {
    const nuevo = (req.body.nombre_usuario || '').toLowerCase().trim();
    const v = validarNombreUsuario(nuevo);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const [actual] = await sb(`usuarios?id=eq.${req.usuario.id}&select=nombre_usuario,nombre_usuario_actualizado_at`);
    if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (nuevo === actual.nombre_usuario) return res.status(400).json({ error: 'Ese ya es tu nombre de usuario actual.' });

    if (actual.nombre_usuario_actualizado_at) {
      const proximoCambio = new Date(actual.nombre_usuario_actualizado_at);
      proximoCambio.setMonth(proximoCambio.getMonth() + 3);
      if (new Date() < proximoCambio) {
        return res.status(400).json({ error: `Ya cambiaste tu nombre de usuario recientemente. Vas a poder volver a cambiarlo a partir del ${proximoCambio.toLocaleDateString('es-AR')}.` });
      }
    }

    const enUso = await sb(`usuarios?nombre_usuario=eq.${encodeURIComponent(nuevo)}&select=id`);
    if (enUso.length > 0) return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso. Elegí otro.' });

    await sb(`usuarios?id=eq.${req.usuario.id}`, 'PATCH', { nombre_usuario: nuevo, nombre_usuario_actualizado_at: new Date().toISOString() });
    res.json({ ok: true, nombre_usuario: nuevo });
  } catch (e) {
    console.error('❌ Error en POST /usuarios/cambiar-usuario:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo cambiar el nombre de usuario.' });
  }
});

app.patch('/api/usuarios/:id', auth, async (req, res) => {
  try {
    if (req.usuario.id !== req.params.id && req.usuario.tipo !== 'admin') {
      return res.status(403).json({ error: 'No podés editar el perfil de otra persona.' });
    }
    if(req.usuario.tipo==='admin' && ['suspendido','baja'].includes(req.body.estado))return res.json(await sb('rpc/chamba_account','POST',{p_actor:req.usuario.id,p_user:req.params.id,p_state:req.body.estado,p_reason:textValue(req.body.motivo)}));
    const permitidos = req.usuario.tipo === 'admin' ? ['nombre', 'telefono', 'estado','motivo'] : ['nombre', 'telefono'];
    if (Object.keys(req.body).some(k => !permitidos.includes(k))) {
      return res.status(403).json({ error: 'Este campo no se puede modificar desde el perfil.' });
    }
    if(req.body.estado && !['aprobado','rechazado','suspendido','pendiente'].includes(req.body.estado))return res.status(400).json({error:'Estado inválido.'});
    if(req.body.nombre!==undefined)req.body.nombre=textValue(req.body.nombre,100);
    if(req.body.telefono!==undefined)req.body.telefono=textValue(req.body.telefono,40);
    const prev = await sb(`usuarios?id=eq.${encodeURIComponent(req.params.id)}&select=*`);
    const u = prev[0];

    if(req.usuario.tipo==='admin' && req.body.estado && ['suspendido','baja'].includes(u?.estado))return res.json(await sb('rpc/chamba_account','POST',{p_actor:req.usuario.id,p_user:req.params.id,p_state:req.body.estado,p_reason:textValue(req.body.motivo)}));
    let body = pick(req.body,['nombre','telefono','estado']);
    // Si se rechaza a un Socio que en realidad venía de una conversión desde Cliente,
    // no lo dejamos "rechazado" (eso lo bloquearía para siempre) — vuelve a ser Cliente
    // con su cuenta activa, y puede volver a solicitar ser Socio cuando quiera.
    if (req.body.estado === 'rechazado' && u && u.tipo === 'socio' && u.conversion_desde_cliente) {
      body = { ...body, tipo: 'cliente', estado: 'aprobado' };
    }

    const data = await sb(`usuarios?id=eq.${req.params.id}`, 'PATCH', body);
    if (req.body.estado && u) {
      if (req.body.estado === 'aprobado' && u.tipo === 'socio') emailSocioAprobado(u.nombre, u.email).catch(e=>console.error('No se pudo enviar aviso de aprobación')); 
      if (req.body.estado === 'rechazado' && u.tipo === 'socio') emailSocioRechazado(u.nombre, u.email).catch(e=>console.error('No se pudo enviar aviso de rechazo')); 
    }
    res.json(data.map(({ password_hash, ...usuario }) => usuario));
  } catch (e) {
    console.error('❌ Error en PATCH /usuarios:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo actualizar.', detalle: e.message });
  }
});

app.delete('/api/usuarios/:id', auth, soloAdmin, async (req, res) => {
  res.json(await sb('rpc/chamba_account','POST',{p_actor:req.usuario.id,p_user:req.params.id,p_state:'baja',p_reason:textValue(req.body.motivo)}));
});

// ── UBICACIONES ──
app.get('/api/ubicaciones', auth, async (req, res) => {
  try {
    const usuario_id = req.query.usuario_id || req.usuario.id;
    if (usuario_id !== req.usuario.id && req.usuario.tipo !== 'admin') return res.status(403).json({ error: 'No autorizado.' });
    res.json(await sb(`ubicaciones?usuario_id=eq.${usuario_id}&select=*&order=created_at.asc`));
  } catch (e) {
    console.error('❌ Error en GET /ubicaciones:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudieron cargar las ubicaciones.' });
  }
});

app.post('/api/ubicaciones', auth, async (req, res) => {
  try {
    const { etiqueta, direccion, tipo, lat, lng, piso_depto, referencias } = req.body;
    if (tipo && !['otra','trabajo','residencia'].includes(tipo))return res.status(400).json({error:'Tipo de ubicación inválido.'});
    if (!etiqueta || !direccion) return res.status(400).json({ error: 'Faltan datos.' });
    let coords;
    if (lat != null && lng != null) {
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return res.status(400).json({error:'Ubicación inválida.'});
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
    console.error('❌ Error en POST /ubicaciones:', e.message, e.supabase?.code || '');
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
    if (tipo !== undefined){if(!['otra','trabajo','residencia'].includes(tipo))return res.status(400).json({error:'Tipo de ubicación inválido.'});patch.tipo=tipo;}
    if (piso_depto !== undefined) patch.piso_depto = piso_depto || null;
    if (referencias !== undefined) patch.referencias = referencias || null;
    if (direccion !== undefined && lat != null && lng != null) {
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return res.status(400).json({error:'Ubicación inválida.'});
      const rev = await geocodificarInverso(lat, lng);
      Object.assign(patch, { direccion, lat, lng, zona: rev?.zona || null });
    }
    res.json(await sb(`ubicaciones?id=eq.${req.params.id}`, 'PATCH', patch));
  } catch (e) {
    console.error('❌ Error en PATCH /ubicaciones:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo actualizar la ubicación.', detalle: e.message });
  }
});

app.patch('/api/ubicaciones/:id/predeterminada',auth,async(req,res)=>res.json(await sb('rpc/chamba_default_location','POST',{p_actor:req.usuario.id,p_id:req.params.id})));


app.delete('/api/ubicaciones/:id',auth,async(req,res)=>res.json(await sb('rpc/chamba_remove_location','POST',{p_actor:req.usuario.id,p_id:req.params.id})));

// ── PEDIDOS ──
app.get('/api/pedidos', auth, async (req, res) => {
  try {
    const usuario_id_q = req.query.usuario_id ? `&usuario_id=eq.${req.query.usuario_id}` : '';
    const estado = req.query.estado ? `&estado=eq.${encodeURIComponent(req.query.estado)}` : '';
    if(req.query.estado && !['nuevo','en_proceso','completado','cancelado'].includes(req.query.estado))return res.status(400).json({error:'Estado inválido.'});
    const scope=req.usuario.tipo==='admin'?'':req.usuario.tipo==='socio'?`&or=(usuario_id.eq.${req.usuario.id},profesional_id.eq.${req.usuario.id},estado.eq.nuevo)`:`&usuario_id=eq.${req.usuario.id}&oculto_cliente=eq.false`;
    const pedidos = await sbAll(`pedidos?select=*&order=created_at.desc,id.asc${scope}${usuario_id_q}${estado}`);
    if (!Array.isArray(pedidos)) return res.json(pedidos);

    // Admin ve todo tal cual, sin filtrar ni redactar
    if (req.usuario.tipo === 'admin') return res.json(pedidos);

    // Solo la ubicación PREDETERMINADA cuenta para mostrarte trabajos cercanos
    const misUbs = await sb(`ubicaciones?usuario_id=eq.${req.usuario.id}&predeterminada=eq.true&select=lat,lng`);
    const origenes = misUbs.filter(u => u.lat != null && u.lng != null);

    // Clientes que me bloquearon a mí (nunca debo ver sus pedidos — de forma confidencial, sin que ellos lo sepan)
    const bloqueosContraMi = await sb(`relaciones_socio?socio_id=eq.${req.usuario.id}&tipo=eq.bloqueado&select=cliente_id`);
    const clientesQueMeBloquearon = new Set(bloqueosContraMi.map(b => b.cliente_id));

    const resultado = [];
    for (const p of pedidos) {
      const esPropio = req.usuario.id === p.usuario_id || req.usuario.id === p.profesional_id;
      if(esPropio){if(p.usuario_id===req.usuario.id&&p.oculto_cliente)continue;const copy={...p};if(req.usuario.id!==p.usuario_id)delete copy.codigo_verificacion;resultado.push(copy);continue;}
      if(req.usuario.tipo!=='socio'||p.estado!=='nuevo'||!splitServices(req.usuario.especialidad).includes(p.servicio))continue;

      // El cliente que publicó esto me bloqueó: nunca lo veo, sin ningún aviso
      if (clientesQueMeBloquearon.has(p.usuario_id)) continue;

      // Trabajo dirigido a un socio favorito: solo esa persona lo ve, sin importar la distancia
      if (p.socio_preferido_id) {
        if (p.socio_preferido_id !== req.usuario.id) continue;
        const sinCoordenadas=pick(p,['id','servicio','descripcion','estado','created_at','zona','urgencia','precio_sugerido_ia']);
        resultado.push({ ...sinCoordenadas, distancia_km: null, es_favorito: true });
        continue;
      }

      // No es mío: nunca se manda lat/lng exacto, solo la zona y la distancia calculada acá adentro
      let distancia_km = null;
      if (origenes.length && p.lat != null && p.lng != null) {
        distancia_km = Math.min(...origenes.map(o => distanciaKm(o.lat, o.lng, p.lat, p.lng)));
      }
      if (distancia_km === null || distancia_km > 15) continue; // fuera de rango o sin ubicación: no se muestra
      const sinCoordenadas=pick(p,['id','servicio','descripcion','estado','created_at','zona','urgencia','precio_sugerido_ia']);
      resultado.push({ ...sinCoordenadas, distancia_km: Math.round(distancia_km * 10) / 10 });
    }

    // Si sos el Cliente y ya pagaste, te mostramos la foto de perfil del Socio asignado (antes de pagar, nunca se manda)
    const idsParaFoto = [...new Set(resultado
      .filter(p => p.usuario_id === req.usuario.id && p.profesional_id && ['pagado', 'liberado'].includes(p.estado_pago))
      .map(p => p.profesional_id))];
    if (idsParaFoto.length) {
      const socios = await sb(`usuarios?id=in.(${idsParaFoto.join(',')})&select=id,foto_perfil_path`);
      const mapaFotos = {};
      for (const s of (Array.isArray(socios) ? socios : [])) {
        mapaFotos[s.id] = s.foto_perfil_path ? await firmarUrl('identificaciones', s.foto_perfil_path) : null;
      }
      resultado.forEach(p => {
        if (p.usuario_id === req.usuario.id && p.profesional_id && ['pagado', 'liberado'].includes(p.estado_pago)) {
          p.socio_foto_url = mapaFotos[p.profesional_id] || null;
        }
      });
    }
    res.json(resultado);
  } catch (e) {
    console.error('❌ Error en GET /pedidos:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudieron cargar los pedidos.' });
  }
});

app.post('/api/pedidos',auth,async(req,res)=>{
 const {servicio,ubicacion_id,socio_preferido_id}=req.body;
 if(!uuid(ubicacion_id))return res.status(400).json({error:'Elegí una ubicación.'});
 const active=await sb(`especialidades?nombre=eq.${encodeURIComponent(servicio)}&activa=eq.true&select=id`);
 if(!active.length)return res.status(400).json({error:'Servicio no disponible.'});
 const [u]=await sb(`ubicaciones?id=eq.${ubicacion_id}&usuario_id=eq.${req.usuario.id}&select=*`);
 if(!u)return res.status(403).json({error:'Elegí una ubicación de tu cuenta.'});
 if(socio_preferido_id){const fav=await sb(`relaciones_socio?cliente_id=eq.${req.usuario.id}&socio_id=eq.${socio_preferido_id}&tipo=eq.favorito&select=id`);if(!fav.length)return res.status(400).json({error:'Ese socio no está en tus favoritos.'});}
 const body={usuario_id:req.usuario.id,servicio,descripcion:textValue(req.body.descripcion,6000),estado:'nuevo',urgencia:['Alta','Media','Baja'].includes(req.body.urgencia)?req.body.urgencia:'Media',lat:u.lat,lng:u.lng,zona:u.zona||u.etiqueta,direccion:[u.direccion,u.piso_depto,u.referencias].filter(Boolean).join(' — ')};
 if(socio_preferido_id)body.socio_preferido_id=socio_preferido_id;
 if(Number.isFinite(req.body.precio_sugerido_ia)&&req.body.precio_sugerido_ia>=0)body.precio_sugerido_ia=req.body.precio_sugerido_ia;
 const data=await sb('pedidos','POST',body);emailPedidoRecibido(req.usuario.nombre,req.usuario.email,servicio).catch(e=>console.error('Email de pedido no enviado'));res.json(data);
});
app.patch('/api/pedidos/:id',auth,async(req,res)=>{
 if(Object.keys(req.body).length!==1||req.body.estado!=='cancelado')return res.status(403).json({error:'Usá la acción correspondiente para modificar este trabajo.'});
 return jobAction(req,res,'cancel');
});

app.delete('/api/pedidos/:id',auth,async(req,res)=>jobAction(req,res,req.usuario.tipo==='admin'?'admin_cancel':'archive'));

app.post('/api/pedidos/:id/eliminar-admin',auth,soloAdmin,async(req,res)=>jobAction(req,res,'admin_cancel'));

app.get('/api/ofertas', auth, async (req, res) => {
  try {
    const pedido_id = req.query.pedido_id ? `&pedido_id=eq.${req.query.pedido_id}` : '';
    const socio_id = req.query.socio_id ? `&socio_id=eq.${req.query.socio_id}` : '';
    let scope='';
    if(req.usuario.tipo!=='admin'){
      const own=await sbAll(`pedidos?usuario_id=eq.${req.usuario.id}&select=id&order=id`);
      scope=own.length?`&or=(socio_id.eq.${req.usuario.id},pedido_id.in.(${own.map(p=>p.id).join(',')}))`:`&socio_id=eq.${req.usuario.id}`;
    }
    const ofertas = await sbAll(`ofertas?select=*&order=created_at.desc,id.asc${scope}${pedido_id}${socio_id}`);
    if (Array.isArray(ofertas) && ofertas.length) {
      const ids = [...new Set(ofertas.map(o => o.socio_id).filter(Boolean))];
      const socios = ids.length ? await sb(`usuarios?id=in.(${ids.join(',')})&select=id,promedio_estrellas,trabajos_completados,foto_perfil_path`) : [];
      const mapa = {};
      (Array.isArray(socios) ? socios : []).forEach(s => mapa[s.id] = s);

      // La foto de perfil del Socio solo se revela una vez que el Cliente pagó ese trabajo puntual — antes, ni ChamBA la muestra.
      const pedidoIds = [...new Set(ofertas.map(o => o.pedido_id).filter(Boolean))];
      const pedidosInfo = pedidoIds.length ? await sb(`pedidos?id=in.(${pedidoIds.join(',')})&select=id,estado_pago,usuario_id,profesional_id`) : [];
      const mapaPedidos = {};
      (Array.isArray(pedidosInfo) ? pedidosInfo : []).forEach(p => mapaPedidos[p.id] = p);

      for (const o of ofertas) {
        const s = mapa[o.socio_id];
        o.rep_promedio = s?.promedio_estrellas || 0;
        o.trabajos_completados = s?.trabajos_completados || 0;
        const job=mapaPedidos[o.pedido_id];const yaPagado=job && ['pagado','liberado'].includes(job.estado_pago) && job.profesional_id===o.socio_id && (job.usuario_id===req.usuario.id||req.usuario.tipo==='admin');
        o.foto_perfil_url = (yaPagado && s?.foto_perfil_path) ? await firmarUrl('identificaciones', s.foto_perfil_path) : null;
      }
    }
    res.json(ofertas);
  } catch (e) {
    console.error('❌ Error en GET /ofertas:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudieron cargar las ofertas.' });
  }
});

app.post('/api/ofertas',auth,async(req,res)=>{
 if(!uuid(req.body.pedido_id))return res.status(400).json({error:'Pedido inválido.'});
 return jobAction(req,res,'offer',req.body.pedido_id,{precio:req.body.precio_ofertado});
});

app.post('/api/ofertas/:id/contraoferta',auth,async(req,res)=>jobAction(req,res,'counter',req.params.id,{precio:req.body.nuevo_precio}));
app.post('/api/ofertas/:id/acordar',auth,async(req,res)=>jobAction(req,res,'partner_agree'));

app.post('/api/ofertas/:id/aceptar',auth,async(req,res)=>jobAction(req,res,'accept',req.params.id,{codigo:String(crypto.randomInt(1000,10000)),acepto_aviso:req.body.acepto_aviso===true,aviso_version:req.body.aviso_version}));

app.post('/api/ofertas/:id/rechazar',auth,async(req,res)=>jobAction(req,res,'reject'));

app.post('/api/pedidos/:id/buscar-otro-socio',auth,async(req,res)=>jobAction(req,res,'restart'));

app.post('/api/pedidos/:id/verificar-codigo',auth,async(req,res)=>jobAction(req,res,'finish',req.params.id,{codigo:String(req.body.codigo||'')}));

app.get('/api/mensajes/:pedido_id', auth, async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.pedido_id);
    const [pedido] = await sb(`pedidos?id=eq.${id}&select=usuario_id,profesional_id,chat_habilitado,revision`);
    if (!pedido || ![pedido.usuario_id, pedido.profesional_id].includes(req.usuario.id)) {
      return res.status(403).json({ error: 'No sos parte de esta conversación.' });
    }
    if (!pedido.chat_habilitado) return res.status(403).json({ error: 'El chat se habilita después del pago.' });
    if(req.query.page==='true') {
      let cursor=null;
      const direction=req.query.before?'before':req.query.after?'after':null;
      if(req.query.before&&req.query.after)return res.status(400).json({error:'Paginación inválida.'});
      if(direction) {
        try {
          const value=req.query[direction];
          if(typeof value!=='string'||value.length>400)throw Error();
          cursor=JSON.parse(Buffer.from(value,'base64url').toString());
          if(!uuid(cursor.id)||!Number.isInteger(cursor.revision)||typeof cursor.at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(cursor.at)||!Number.isFinite(Date.parse(cursor.at)))throw Error();
        }catch{return res.status(400).json({error:'Paginación inválida.'});}
      }
      if(cursor&&cursor.revision!==pedido.revision)return res.json({messages:[],revision:pedido.revision,reset:true});
      const op=direction==='after'?'gt':'lt',sort=direction==='after'?'asc':'desc';
      const filter=cursor?`&or=(created_at.${op}.${encodeURIComponent(cursor.at)},and(created_at.eq.${encodeURIComponent(cursor.at)},id.${op}.${cursor.id}))`:'';
      const rows=await sb(`mensajes?pedido_id=eq.${id}&revision=eq.${pedido.revision}&select=*&order=created_at.${sort},id.${sort}&limit=51${filter}`);
      const more=rows.length>50,items=rows.slice(0,50);
      if(sort==='desc')items.reverse();
      const encode=m=>m?Buffer.from(JSON.stringify({at:m.created_at,id:m.id,revision:pedido.revision})).toString('base64url'):null;
      return res.json({messages:items,revision:pedido.revision,next_before:direction!=='after'&&more?encode(items[0]):null,latest:encode(items.at(-1)),has_more_after:direction==='after'&&more});
    }
    res.json(await sbAll(`mensajes?pedido_id=eq.${id}&revision=eq.${pedido.revision}&select=*&order=created_at.asc,id.asc`));
  }
  catch (e) { console.error('❌ Error en GET /mensajes:', e.message, e.supabase?.code || ''); res.status(500).json({ error: 'No se pudieron cargar los mensajes.' }); }
});
app.post('/api/mensajes', auth, async (req, res) => {
  try {
    if(!uuid(req.body.pedido_id)||!uuid(req.body.client_message_id))return res.status(400).json({error:'Identificador de mensaje inválido.'});
    const result=await sb('rpc/chamba_send_message','POST',{p_actor:req.usuario.id,p_job:req.body.pedido_id,p_retry:req.body.client_message_id,p_content:textValue(req.body.contenido,4000)});
    const data=[result.message],pedido=[result.job],rol=result.message.rol;
    if(result.duplicate)return res.json(data);
    // Avisar a la otra persona — una sola vez por trabajo, hasta que el pedido cambie de estado
    if (!pedido[0].mensaje_email_enviado) {
      try {
        const destinatarioId = rol === 'socio' ? pedido[0].usuario_id : pedido[0].profesional_id;
        if (destinatarioId) {
          const destinatarios = await sb(`usuarios?id=eq.${destinatarioId}&select=nombre,email`);
          if (destinatarios.length) {
            await emailNuevoMensaje(destinatarios[0].nombre, destinatarios[0].email, pedido[0].servicio,`chat-${req.body.pedido_id}-${pedido[0].revision}-${pedido[0].estado}`);
            await sb(`pedidos?id=eq.${req.body.pedido_id}&revision=eq.${pedido[0].revision}&estado=eq.${pedido[0].estado}`, 'PATCH', { mensaje_email_enviado: true });
          }
        }
      } catch (e) { console.error('❌ Error avisando nuevo mensaje:', e.message); }
    }
    res.json(data);
  } catch (e) {
    console.error('❌ Error en POST /mensajes:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo enviar el mensaje.', detalle: e.message });
  }
});

// ── SOLICITUDES DE MATRÍCULA ──
app.get('/api/solicitudes-matricula', auth, async (req, res) => {
  try {
    const propietario = req.usuario.tipo === 'admin' ? req.query.socio_id : req.usuario.id;
    const socio_id = propietario ? `&socio_id=eq.${encodeURIComponent(propietario)}` : '';
    res.json(await sb(`solicitudes_matricula?select=*&order=created_at.desc${socio_id}`));
  } catch (e) {
    console.error('❌ Error en GET /solicitudes-matricula:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudieron cargar las solicitudes.' });
  }
});
// Un Cliente pide convertirse en Socio: llena los mismos datos que en el registro de socio,
// y queda "pendiente" con el mismo flujo de aprobación que ya usa el admin para socios nuevos.
app.post('/api/usuarios/solicitar-socio', auth, async (req, res) => {
  const uploads=[];
  let writeStarted=false,lookup='';
  try {
    const { dni, especialidad, experiencia, matricula, matricula_organismo, direccion_trabajo, dni_foto, foto_perfil } = req.body;
    if (!dni || !especialidad || !experiencia) return res.status(400).json({ error: 'Completá DNI, especialidad y años de experiencia.' });
    if (splitServices(especialidad).some(e=>RUBROS_MATRICULA_OBLIGATORIA.includes(e)) && (!matricula || !matricula_organismo)) {
      return res.status(400).json({ error: `${especialidad} exige matrícula habilitante: completá el número y el organismo que te la otorgó.` });
    }
    if (!dni_foto || !dni_foto.data || !dni_foto.mime) return res.status(400).json({ error: 'Subí una foto de tu DNI (frente).' });
    if (!foto_perfil || !foto_perfil.data || !foto_perfil.mime) return res.status(400).json({ error: 'Subí una foto de perfil donde se te vea la cara.' });
    const vDni = validarArchivo(dni_foto.data, dni_foto.mime);
    if (!vDni.ok) return res.status(400).json({ error: 'Foto de DNI: ' + vDni.error });
    const vPerfil = validarArchivo(foto_perfil.data, foto_perfil.mime);
    if (!vPerfil.ok) return res.status(400).json({ error: 'Foto de perfil: ' + vPerfil.error });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(dni_foto.mime) || !['image/jpeg', 'image/png', 'image/webp'].includes(foto_perfil.mime)) {
      return res.status(400).json({ error: 'La foto de DNI y la foto de perfil tienen que ser imágenes (JPG, PNG o WEBP), no PDF.' });
    }

    await validarEspecialidades(especialidad);
    const [actual] = await sb(`usuarios?id=eq.${req.usuario.id}&select=*`);
    if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (actual.tipo !== 'cliente') return res.status(400).json({ error: 'Esta solicitud es solo para cuentas de Cliente.' });

    let coordsTrabajo = null;
    if (direccion_trabajo) {
      coordsTrabajo = await geocodificar(direccion_trabajo);
      if (!coordsTrabajo) return res.status(400).json({ error: 'No pudimos encontrar la zona de trabajo. Revisá que esté bien escrita.' });
    }

    const extDni = (dni_foto.mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const extPerfil = (foto_perfil.mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const submissionId=crypto.randomUUID();
    const pathDni = `${req.usuario.id}/dni_${submissionId}.${extDni}`;
    const pathPerfil = `${req.usuario.id}/perfil_${submissionId}.${extPerfil}`;
    uploads.push(pathDni);await subirArchivo('identificaciones', pathDni, dni_foto.data, dni_foto.mime);
    uploads.push(pathPerfil);await subirArchivo('identificaciones', pathPerfil, foto_perfil.data, foto_perfil.mime);

    lookup=`usuarios?id=eq.${req.usuario.id}&dni_foto_path=eq.${encodeURIComponent(pathDni)}&foto_perfil_path=eq.${encodeURIComponent(pathPerfil)}&select=id`;
    writeStarted=true;
    await sb('rpc/chamba_submit_partner','POST',{p_actor:req.usuario.id,p_data:{dni,especialidad,experiencia,matricula,matricula_organismo,dni_foto_path:pathDni,foto_perfil_path:pathPerfil},p_location:coordsTrabajo?{direccion:direccion_trabajo,...coordsTrabajo}:null});
    res.json({ ok: true });
  } catch (e) {
    const saved=await recuperarCarga(uploads,lookup,writeStarted,e);
    if(saved)return res.json({ok:true});
    console.error('❌ Error en POST /usuarios/solicitar-socio:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo enviar la solicitud.' });
  }
});


app.post('/api/solicitudes-matricula', auth, async (req, res) => {
  try {
    if(req.usuario.tipo!=='socio')return res.status(403).json({error:'Esta opción es para Socios.'});
    const { matricula_nueva, especialidad, matricula_organismo } = req.body;
    await validarEspecialidades(especialidad);
    if (!matricula_nueva || !especialidad) return res.status(400).json({ error: 'Faltan datos.' });
    if (splitServices(especialidad).some(e=>RUBROS_MATRICULA_OBLIGATORIA.includes(e)) && !matricula_organismo) {
      return res.status(400).json({ error: `${especialidad} exige matrícula habilitante: indicá qué organismo te la otorgó.` });
    }
    res.json(await sb('solicitudes_matricula', 'POST', { socio_id: req.usuario.id, matricula_nueva, especialidad, matricula_organismo, estado: 'pendiente' }));
  } catch (e) {
    console.error('❌ Error en POST /solicitudes-matricula:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo enviar la solicitud.', detalle: e.message });
  }
});
app.patch('/api/solicitudes-matricula/:id',auth,soloAdmin,async(req,res)=>{
 if(!['aprobada','rechazada'].includes(req.body.estado))return res.status(400).json({error:'Estado inválido.'});
 res.json(await sb('rpc/chamba_license_decision','POST',{p_actor:req.usuario.id,p_id:req.params.id,p_estado:req.body.estado}));
});
app.patch('/api/solicitudes-matricula/:id/visto', auth, async (req, res) => {
  try {
    const sol = await sb(`solicitudes_matricula?id=eq.${req.params.id}&select=socio_id`);
    if (!sol.length || req.usuario.id !== sol[0].socio_id) return res.status(403).json({ error: 'No podés modificar esta solicitud.' });
    await sb(`solicitudes_matricula?id=eq.${req.params.id}`, 'PATCH', { visto: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en PATCH /solicitudes-matricula/visto:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo actualizar.' });
  }
});

// ── CALIFICACIONES ──
app.post('/api/calificaciones',auth,async(req,res)=>jobAction(req,res,'rate',req.body.pedido_id,{estrellas:req.body.estrellas,comentario:req.body.comentario}));

app.get('/api/calificaciones/:socio_id', async (req, res) => res.json(await sb(`calificaciones?socio_id=eq.${req.params.socio_id}&select=id,estrellas,comentario,created_at&order=created_at.desc`)));

// ── FORO (con soporte para respuestas vía parent_id) ──
// ── DISPUTAS ──
// Legacy reports remain readable; new reports use the transactional claim workflow.
app.get('/api/disputas',auth,async(req,res)=>{
 if(req.usuario.tipo==='admin')return res.json(await sbAll('disputas?select=*&order=created_at.desc,id.asc'));
 const jobs=await sbAll(`pedidos?or=(usuario_id.eq.${req.usuario.id},profesional_id.eq.${req.usuario.id})&select=id`);
 const rows=[];for(let i=0;i<jobs.length;i+=100)rows.push(...await sbAll(`disputas?pedido_id=in.(${jobs.slice(i,i+100).map(j=>j.id).join(',')})&select=*&order=created_at.desc,id.asc`));res.json(rows);
});
app.post('/api/disputas',auth,async(req,res)=>res.status(409).json({error:'Abrí Reclamos y saldo para registrar el tipo de reclamo y sus adjuntos.'}));
app.patch('/api/disputas/:id',auth,soloAdmin,async(req,res)=>{
 const motivo=textValue(req.body.resolucion,6000);
 res.json(await sb('rpc/chamba_legacy_report','POST',{p_actor:req.usuario.id,p_id:req.params.id,p_reason:motivo}));
});

// ── FAVORITOS / BLOQUEO DE SOCIOS (siempre desde el punto de vista del cliente) ──
app.post('/api/relaciones-socio', auth, async (req, res) => {
  try {
    const { socio_id, tipo } = req.body;
    if (!socio_id || !['favorito', 'bloqueado'].includes(tipo)) return res.status(400).json({ error: 'Datos inválidos.' });
    const existente = await sb(`relaciones_socio?cliente_id=eq.${req.usuario.id}&socio_id=eq.${socio_id}&select=id`);
    if (existente.length) {
      return res.json(await sb(`relaciones_socio?id=eq.${existente[0].id}`, 'PATCH', { tipo }));
    }
    res.json(await sb('relaciones_socio', 'POST', { cliente_id: req.usuario.id, socio_id, tipo }));
  } catch (e) {
    console.error('❌ Error en POST /relaciones-socio:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudo guardar.' });
  }
});

app.delete('/api/relaciones-socio/:socio_id', auth, async (req, res) => {
  try {
    await sb(`relaciones_socio?cliente_id=eq.${req.usuario.id}&socio_id=eq.${req.params.socio_id}`,'DELETE');
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ Error en DELETE /relaciones-socio:', e.message);
    res.status(500).json({ error: 'No se pudo eliminar.' });
  }
});

app.get('/api/relaciones-socio', auth, async (req, res) => {
  try {
    const rows = await sb(`relaciones_socio?cliente_id=eq.${req.usuario.id}&select=*&order=created_at.desc`);
    const ids = [...new Set(rows.map(r => r.socio_id))];
    const socios = ids.length ? await sb(`usuarios?id=in.(${ids.join(',')})&select=id,nombre,especialidad,promedio_estrellas,trabajos_completados`) : [];
    const mapa = {}; socios.forEach(s => mapa[s.id] = s);
    rows.forEach(r => r.socio = mapa[r.socio_id] || null);
    res.json(rows);
  } catch (e) {
    console.error('❌ Error en GET /relaciones-socio:', e.message, e.supabase?.code || '');
    res.status(500).json({ error: 'No se pudieron cargar tus relaciones con socios.' });
  }
});

app.get('/api/foro', async (req, res) => {
  try { res.json(await sbAll('foro?select=*&order=created_at.asc,id.asc')); }
  catch (e) { console.error('❌ Error en GET /foro:', e.message, e.supabase?.code || ''); res.status(500).json({ error: 'No se pudo cargar el foro.' }); }
});
app.post('/api/foro', auth, async (req, res) => {
  try { res.json(await sb('foro', 'POST', { titulo:req.body.parent_id?'':textValue(req.body.titulo,180),contenido:textValue(req.body.contenido,6000),parent_id:req.body.parent_id||null,autor_id:req.usuario.id,autor_nombre:req.usuario.nombre,autor_tipo:req.usuario.tipo })); }
  catch (e) { console.error('❌ Error en POST /foro:', e.message, e.supabase?.code || ''); res.status(500).json({ error: 'No se pudo publicar.', detalle: e.message }); }
});
app.delete('/api/foro/:id', auth, soloAdmin, async (req, res) => {
  await sb(`foro?id=eq.${req.params.id}`,'DELETE');
  res.json({ ok: true });
});

// Custody / claims: the database performs financial authorization and atomic transitions.
const escrowFields='id,nombre,nombre_usuario,dni,email,telefono,tipo,estado';
async function claimAccess(id,user){
 const [r]=await sb(`reclamos?id=eq.${id}&select=*`);
 if(!r || (user.tipo!=='admin' && ![r.creado_por,r.contra_id].includes(user.id)))throw Object.assign(Error('Reclamo no disponible.'),{status:404});return r;
}
async function reauthenticate(req){
 const [u]=await sb(`usuarios?id=eq.${req.usuario.id}&select=password_hash`);
 if(typeof req.body.password!=='string'||req.body.password.length>200||!await require('bcryptjs').compare(req.body.password,u?.password_hash||''))throw Object.assign(Error('Ingresá tu contraseña para confirmar esta operación.'),{status:403});
}
app.use(['/api/saldo/retirar','/api/saldo/ajustar'],limited(6,15*60000));
app.get('/api/custodia/config',auth,async(req,res)=>{
 const [c]=await sb('chamba_config?select=*');res.json(c);
});
app.get('/api/custodia/me',auth,async(req,res)=>{
 const [u]=await sb(`usuarios?id=eq.${req.usuario.id}&select=id,nombre,tipo,estado,baja_at,saldo_disponible,saldo_bloqueado`);res.json(u);
});
app.get('/api/custodia/trabajos',auth,async(req,res)=>{
 const filter=req.usuario.tipo==='admin'?'':`&or=(usuario_id.eq.${req.usuario.id},profesional_id.eq.${req.usuario.id})`;
 const jobs=await sbAll('pedidos?select=id,usuario_id,profesional_id,servicio,estado,estado_pago,precio_cliente,created_at'+filter+'&order=created_at.desc,id.asc');
 const custody=await sbAll('custodias?select=*'+(req.usuario.tipo==='admin'?'':`&or=(cliente_id.eq.${req.usuario.id},socio_id.eq.${req.usuario.id})`));
 const map=new Map(custody.map(x=>[x.pedido_id,x]));res.json(jobs.map(p=>({...p,custodia:map.get(p.id)||null})));
});
app.get('/api/reclamos',auth,async(req,res)=>{
 const filter=req.usuario.tipo==='admin'?'':`&or=(creado_por.eq.${req.usuario.id},contra_id.eq.${req.usuario.id})`;
 const rows=await sbAll('reclamos?select=*'+filter+'&order=created_at.asc,id.asc');
 if(req.usuario.tipo==='admin'){
 const ids=[...new Set(rows.flatMap(r=>[r.creado_por,r.contra_id]))];
 const people=new Map();for(let i=0;i<ids.length;i+=100){for(const u of await sb(`usuarios?id=in.(${ids.slice(i,i+100).join(',')})&select=${escrowFields}`))people.set(u.id,u);}
 rows.forEach(r=>{r.reportante=people.get(r.creado_por);r.contraparte=people.get(r.contra_id);});
 }res.json(rows);
});
app.get('/api/reclamos/:id',auth,async(req,res)=>{
 const r=await claimAccess(req.params.id,req.usuario);
 const people=await sb(`usuarios?id=in.(${r.creado_por},${r.contra_id})&select=${req.usuario.tipo==='admin'?escrowFields:'id,nombre,nombre_usuario'}`);
 const attachments=await sb(`reclamo_adjuntos?reclamo_id=eq.${r.id}&select=*`);
 for(const f of attachments)f.url=await firmarUrl('identificaciones',f.path,600);
 const [e]=await sb(`custodias?pedido_id=eq.${r.pedido_id}&select=*`);
 const history=await sbAll(`auditoria?reclamo_id=eq.${r.id}&select=accion,created_at,datos&order=created_at.asc,id.asc`);
 res.json({...r,personas:people,adjuntos:attachments,custodia:e||null,historial:history});
});
async function claimWrite(req,res,action){
 if(action==='respond')await claimAccess(req.params.id,req.usuario);
 req.body.descripcion=textValue(req.body.descripcion,6000);
 const files=req.body.adjuntos||[];if(!Array.isArray(files)||files.length>5)throw Object.assign(Error('Podés adjuntar hasta 5 imágenes.'),{status:400});
 for(const f of files){if(!f||!['image/jpeg','image/png','image/webp'].includes(f.mime)||typeof f.data!=='string')throw Object.assign(Error('Adjuntá imágenes JPG, PNG o WebP.'),{status:400});const v=validarArchivo(f.data,f.mime);if(!v.ok)throw Object.assign(Error(v.error),{status:400});}
 if(action==='create' && !uuid(req.body.request_id))throw Object.assign(Error('Falta el identificador de la solicitud. Recargá la página.'),{status:400});
 const uploads=[];let started=false;
 const lookup=action==='create'?`reclamos?creado_por=eq.${req.usuario.id}&request_id=eq.${req.body.request_id}&select=*`:`reclamos?id=eq.${req.params.id}&descargo_at=not.is.null&select=*`;
 try{
 const existing=await sb(lookup);if(existing[0])return res.json(existing[0]);
 const attachments=[];
 for(const f of files){const path=`reclamos/${req.usuario.id}/${crypto.randomUUID()}`;uploads.push(path);await subirArchivo('identificaciones',path,f.data,f.mime);attachments.push({path,nombre:String(f.nombre||'Imagen').slice(0,200),mime:f.mime});}
 started=true;
 res.json(await sb('rpc/chamba_claim','POST',{p_actor:req.usuario.id,p_action:action,p_id:req.params.id||null,p_data:{...pick(req.body,['pedido_id','tipo','categoria','descripcion','request_id']),adjuntos:attachments}}));
 }catch(e){const saved=await recuperarCarga(uploads,lookup,started,e);if(saved)return res.json(saved);throw e;}
}
app.post('/api/reclamos',auth,(req,res)=>claimWrite(req,res,'create'));
app.post('/api/reclamos/:id/descargo',auth,(req,res)=>claimWrite(req,res,'respond'));
for(const [route,action] of [['tomar','take'],['resolver','resolve'],['prorroga','extend']])app.post(`/api/reclamos/:id/${route}`,auth,soloAdmin,async(req,res)=>res.json(await sb('rpc/chamba_claim','POST',{p_actor:req.usuario.id,p_action:action,p_id:req.params.id,p_data:pick(req.body,['motivo','cliente_centavos','horas'])})));
app.post('/api/cuentas/:id/estado',auth,soloAdmin,async(req,res)=>res.json(await sb('rpc/chamba_account','POST',{p_actor:req.usuario.id,p_user:req.params.id,p_state:req.body.estado,p_reason:textValue(req.body.motivo)})));
app.get('/api/saldo',auth,async(req,res)=>{
 const admin=req.usuario.tipo==='admin';
 const rows=await sbAll('libro_contable?select=*'+(admin?'':`&titular_id=eq.${req.usuario.id}`)+'&order=created_at.desc,id.asc');
 const lots=await sbAll('saldo_lotes?select=*'+(admin?'':`&titular_id=eq.${req.usuario.id}`)+'&order=disponible_at.desc,id.asc');
 let people=[];if(admin){const ids=[...new Set(lots.map(l=>l.titular_id))];for(let i=0;i<ids.length;i+=100)people.push(...await sb(`usuarios?id=in.(${ids.slice(i,i+100).join(',')})&select=id,nombre,nombre_usuario`));}
 res.json({simulado:true,movimientos:rows,lotes:lots,titulares:people,comisiones:admin?rows.reduce((s,r)=>s+(r.destino==='comisiones'?Number(r.centavos):0)-(r.origen==='comisiones'?Number(r.centavos):0),0):null,historico:admin?rows.filter(r=>r.destino==='comisiones').reduce((s,r)=>s+Number(r.centavos),0):null});
});
app.post('/api/saldo/retirar',auth,async(req,res)=>{await reauthenticate(req);if(!uuid(req.body.request_id))throw Object.assign(Error('Solicitud inválida.'),{status:400});res.json(await sb('rpc/chamba_withdraw','POST',{p_actor:req.usuario.id,p_data:pick(req.body,['centavos','destino','motivo','request_id'])}));});
app.post('/api/saldo/ajustar',auth,soloAdmin,async(req,res)=>{await reauthenticate(req);if(!uuid(req.body.request_id))throw Object.assign(Error('Solicitud inválida.'),{status:400});res.json(await sb('rpc/chamba_adjust','POST',{p_actor:req.usuario.id,p_data:pick(req.body,['centavos','pedido_id','titular_id','motivo','request_id'])}));});
app.get('/api/notificaciones',auth,async(req,res)=>res.json(await sb(`notificaciones?usuario_id=eq.${req.usuario.id}&select=id,titulo,mensaje,pedido_id,reclamo_id,created_at,leida_at&order=created_at.desc&limit=100`)));
app.post('/api/notificaciones/:id/leida',auth,async(req,res)=>{await sb(`notificaciones?id=eq.${req.params.id}&usuario_id=eq.${req.usuario.id}`,'PATCH',{leida_at:new Date().toISOString()});res.json({ok:true});});
// pg_cron invokes this worker through pg_net. Durable queue survives Render cold starts.
app.post('/api/internal/notificaciones',async(req,res)=>{
 const supplied=req.headers.authorization||'',expected='Bearer '+(process.env.CRON_SECRET||'');
 if(!process.env.CRON_SECRET||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return res.status(401).json({error:'No autorizado.'});
 const notices=await sb('rpc/chamba_outbox_claim','POST',{});
 for(const n of notices){let error=null;try{const [u]=await sb(`usuarios?id=eq.${n.usuario_id}&select=email`);if(!u?.email)throw Error('Destinatario no disponible');await require('./emailService').emailEvento(u.email,n.titulo,n.mensaje,n.id);}catch(e){error='No se pudo entregar el aviso. Se reintentará.';}
 await sb('rpc/chamba_outbox_ack','POST',{p_id:n.id,p_lease:n.lease,p_error:error});}
 res.json({procesados:notices.length});
});

// Sentry: se coloca después de TODAS las rutas, antes de arrancar el servidor
Sentry.setupExpressErrorHandler(app);

app.use((err,req,res,next)=>{console.error('Request failed:',req.method,req.path,err.status||500);if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.status && err.status<500?err.message:'No se pudo completar la operación. Intentá de nuevo.'});});
const PORT = process.env.PORT || 3001;
if(require.main===module){const server=app.listen(PORT,()=>console.log(`Chamba backend en puerto ${PORT}`));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));}
module.exports=app;

