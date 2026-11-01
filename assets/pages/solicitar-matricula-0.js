
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
  if (usuario.tipo === 'cliente') return window.location.href = '/panel-cliente';
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
  if (RUBROS_MATRICULA_OBLIGATORIA[especialidad]) {
    bloque.style.display = 'block';
    texto.textContent = RUBROS_MATRICULA_OBLIGATORIA[especialidad];
  } else {
    bloque.style.display = 'none';
  }
}

function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function api(path, method='GET', body=null) { return Chamba.api(BACKEND,path,method,body); }

async function enviar() {
  document.getElementById('error-box').style.display = 'none';
  const especialidad = document.getElementById('f-especialidad').value;
  const matricula_nueva = document.getElementById('f-matricula').value.trim();
  const matricula_organismo = document.getElementById('f-matricula-organismo').value.trim();

  if (!especialidad) return showError('Elegí a qué especialidad corresponde esta matrícula.');
  if (!matricula_nueva) return showError('Ingresá el número o código de matrícula.');
  if (RUBROS_MATRICULA_OBLIGATORIA[especialidad] && !matricula_organismo) {
    return showError(`${especialidad} exige matrícula habilitante: contanos qué organismo te la otorgó.`);
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  const r = await api('/api/solicitudes-matricula', 'POST', { matricula_nueva, especialidad, matricula_organismo });
  if (r.error) {
    btn.disabled = false; btn.textContent = 'Enviar solicitud';
    return showError(r.error);
  }

  document.getElementById('form-card').style.display = 'none';
  document.getElementById('link-volver').style.display = 'none';
  document.getElementById('success-box').style.display = 'block';
  setTimeout(() => { window.location.href = '/panel-socio#mi-perfil'; }, 1400);
}
