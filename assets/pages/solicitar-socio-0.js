
const BACKEND = 'https://chamba-backend-vurx.onrender.com';
let usuario = null;

const RUBROS_MATRICULA_OBLIGATORIA = {
  'Gas': 'La matrícula de gasista es obligatoria por ley (Decreto 1738/92) y la otorga la distribuidora de gas de tu zona (MetroGAS, Naturgy o Camuzzi), no ENARGAS directamente.',
  'Electricidad': 'Se exige para conexiones nuevas, ampliaciones de potencia y habilitaciones comerciales. La otorga un colegio profesional o ente regulador según tu jurisdicción.',
  'Plomería': 'Si trabajás en CABA, la otorga la Agencia Gubernamental de Control (AGC). Si además hacés trabajos de gas, necesitás la matrícula de gasista por separado.'
};

window.onload = async () => {
  const u = localStorage.getItem('chamba_user');
  if (!u) return window.location.href = '/login';
  usuario = JSON.parse(u);
  if (usuario.tipo === 'admin') return window.location.href = '/admin';
  if (usuario.tipo === 'socio') return window.location.href = '/panel-socio';
  cargarEspecialidades();
};

async function cargarEspecialidades() {
  try {
    const r = await fetch(BACKEND + '/api/especialidades');
    const especialidades = await r.json();
    const select = document.getElementById('f-especialidad');
    if (Array.isArray(especialidades)) {
      select.innerHTML = Chamba.html('<option value="">Elegí una especialidad</option>' +
        especialidades.filter(e => e.activa).map(e => `<option>${Chamba.escape(e.nombre)}</option>`).join(''));
    }
  } catch(e) {}
}

function onCambioEspecialidad() {
  const especialidad = document.getElementById('f-especialidad').value;
  const bloque = document.getElementById('bloque-matricula-obligatoria');
  const texto = document.getElementById('matricula-obligatoria-texto');
  const hint = document.getElementById('f-matricula-hint');
  const verifDesc = document.getElementById('verif-desc');
  const requiereMatricula = !!RUBROS_MATRICULA_OBLIGATORIA[especialidad];
  if (requiereMatricula) {
    bloque.style.display = 'block';
    texto.textContent = RUBROS_MATRICULA_OBLIGATORIA[especialidad];
    hint.textContent = 'Este rubro exige matrícula — completá también el organismo que te la otorgó abajo.';
    verifDesc.innerHTML = Chamba.html('Ya completaste tu matrícula arriba, así que esta parte es <strong>opcional</strong> — un respaldo extra si querés sumarlo.');
  } else {
    bloque.style.display = 'none';
    hint.textContent = 'Si no tenés, dejalo vacío';
    verifDesc.innerHTML = Chamba.html(especialidad
      ? `${Chamba.escape(especialidad)} no exige una matrícula formal, así que esta es tu forma de verificarte: <strong>es obligatorio</strong> completar las dos partes de abajo.`
      : 'Si tu rubro no exige matrícula, esta es la forma de verificarte — completá las dos partes de abajo.');
  }
}

let selectedFacturas = [];
let selectedMonotributo = null;

function leerDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function renderPreview(files, contenedorId) {
  const box = document.getElementById(contenedorId);
  box.innerHTML = Chamba.html('');
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const wrap = document.createElement('div');
    wrap.className = 'photo-thumb-wrap';
    if (file.type.startsWith('image/')) {
      const dataUrl = await leerDataURL(file);
      wrap.innerHTML = Chamba.html(`<img src="${Chamba.escape(dataUrl)}" class="photo-thumb" alt="${Chamba.escape(file.name)}">`);
    } else {
      wrap.innerHTML = Chamba.html(`<div class="photo-thumb-file">📄</div>`);
    }
    box.appendChild(wrap);
  }
}

document.getElementById('verif-facturas').addEventListener('change', (e) => {
  selectedFacturas = Array.from(e.target.files || []).slice(0, 4);
  renderPreview(selectedFacturas, 'preview-facturas');
});
document.getElementById('verif-monotributo').addEventListener('change', (e) => {
  selectedMonotributo = e.target.files[0] || null;
  renderPreview(selectedMonotributo ? [selectedMonotributo] : [], 'preview-monotributo');
});

function leerArchivoComoDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function api(path, method='GET', body=null) { return Chamba.api(BACKEND,path,method,body); }

async function enviar() {
  const errorBox = document.getElementById('error-box');
  errorBox.style.display = 'none';

  const dni = document.getElementById('f-dni').value.trim();
  const especialidad = document.getElementById('f-especialidad').value;
  const experiencia = document.getElementById('f-experiencia').value.trim();
  const matricula = document.getElementById('f-matricula').value.trim();
  const matricula_organismo = document.getElementById('f-matricula-organismo').value.trim();
  const direccion_trabajo = document.getElementById('f-direccion-trabajo').value.trim();

  if (!dni || !especialidad || !experiencia) return showError('Completá DNI, especialidad y años de experiencia.');
  if (RUBROS_MATRICULA_OBLIGATORIA[especialidad] && (!matricula || !matricula_organismo)) {
    return showError(`${especialidad} exige matrícula habilitante: completá el número y el organismo que te la otorgó.`);
  }
  const archivoDni = document.getElementById('f-dni-foto').files[0];
  const archivoPerfil = document.getElementById('f-foto-perfil').files[0];
  if (!archivoDni) return showError('Subí una foto de tu DNI (frente).');
  if (!archivoPerfil) return showError('Subí una foto de perfil donde se te vea la cara.');

  const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
  const TAMANO_MAX = 8 * 1024 * 1024;
  for (const [archivo, etiqueta] of [[archivoDni, 'La foto de DNI'], [archivoPerfil, 'La foto de perfil']]) {
    if (!TIPOS_PERMITIDOS.includes(archivo.type)) return showError(`${etiqueta} tiene que ser una imagen (JPG, PNG o WEBP).`);
    if (archivo.size > TAMANO_MAX) return showError(`${etiqueta} pesa más de 8MB. Subí una versión más liviana.`);
  }

  const btn = document.getElementById('btn-submit');

  const requiereMatricula = !!RUBROS_MATRICULA_OBLIGATORIA[especialidad];
  const tieneFacturas = selectedFacturas.length > 0;
  const tieneMonotributo = !!selectedMonotributo;
  if (!requiereMatricula && (!tieneFacturas || !tieneMonotributo)) {
    return showError(`${especialidad} no exige matrícula, así que necesitamos verificarte de otra forma: subí tus últimas 3 facturas y tu comprobante de monotributo, en "Verificación de identidad".`);
  }
  if ((tieneFacturas && !tieneMonotributo) || (!tieneFacturas && tieneMonotributo)) {
    return showError('Si vas a verificarte con monotributo, completá las dos partes: las facturas y el comprobante de monotributo.');
  }

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  let dni_foto, foto_perfil;
  try {
    const [dataUrlDni, dataUrlPerfil] = await Promise.all([leerArchivoComoDataURL(archivoDni), leerArchivoComoDataURL(archivoPerfil)]);
    dni_foto = { data: dataUrlDni.split(',')[1], mime: archivoDni.type };
    foto_perfil = { data: dataUrlPerfil.split(',')[1], mime: archivoPerfil.type };
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Enviar solicitud';
    return showError('No pudimos leer las fotos. Probá subirlas de nuevo.');
  }

  const r = await api('/api/usuarios/solicitar-socio', 'POST', { dni, especialidad, experiencia, matricula, matricula_organismo, direccion_trabajo, dni_foto, foto_perfil });
  if (r.error) {
    btn.disabled = false; btn.textContent = 'Enviar solicitud';
    return showError(r.error);
  }

  // La solicitud de Socio ya se envió — si además cargaron monotributo+facturas, lo mandamos
  // como segundo paso. Si este paso falla, no revertimos lo anterior: solo avisamos aparte.
  if (tieneMonotributo && tieneFacturas) {
    try {
      const dataUrlMono = await leerDataURL(selectedMonotributo);
      const facturasData = await Promise.all(selectedFacturas.map(async f => ({ data: (await leerDataURL(f)).split(',')[1], mime: f.type })));
      const rVerif = await api('/api/verificaciones-identidad', 'POST', {
        monotributo: { data: dataUrlMono.split(',')[1], mime: selectedMonotributo.type },
        facturas: facturasData
      });
      if (rVerif.error) console.error('No se pudo enviar la verificación de identidad:', rVerif.error);
    } catch (e) { console.error('Error enviando verificación de identidad:', e); }
  }

  usuario = { ...usuario, tipo: 'socio', estado: 'pendiente' };
  localStorage.setItem('chamba_user', JSON.stringify(usuario));
  document.getElementById('form-card').style.display = 'none';
  document.getElementById('verif-card').style.display = 'none';
  document.getElementById('link-volver').style.display = 'none';
  document.getElementById('success-box').style.display = 'block';
  setTimeout(() => { window.location.href = '/panel-socio#mi-perfil'; }, 1400);
}

async function onBuscarDireccion(input,boxId){
 const box=document.getElementById(boxId);box.textContent='Buscando…';
 const results=await Chamba.api(BACKEND,'/api/geocodificar-buscar?q='+encodeURIComponent(input.value));
 box.replaceChildren();
 if(!results.length){box.textContent='No encontramos direcciones. Probá con calle, número y ciudad.';return;}
 for(const item of results){const button=document.createElement('button');button.type='button';button.className='address-search';button.textContent=item.display_name;button.addEventListener('click',()=>{input.value=item.display_name;box.replaceChildren();});box.append(button);}
}
