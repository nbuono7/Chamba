
const BACKEND = 'https://chamba-backend-vurx.onrender.com';
let tipoSeleccionado = null;
let emailRegistrado = '';
let timerReenvio = null;

// Rubros con matrícula habilitante exigida por ley/normativa (no es una lista completa de "requisitos",
// es la que determina si desbloqueamos el bloque de matrícula obligatoria en el registro).
const RUBROS_MATRICULA_OBLIGATORIA = {
  'Gas': 'La matrícula de gasista es obligatoria por ley (Decreto 1738/92) y la otorga la distribuidora de gas de tu zona (MetroGAS, Naturgy o Camuzzi), no ENARGAS directamente.',
  'Electricidad': 'Se exige para conexiones nuevas, ampliaciones de potencia y habilitaciones comerciales. La otorga un colegio profesional o ente regulador según tu jurisdicción.',
  'Plomería': 'Si trabajás en CABA, la otorga la Agencia Gubernamental de Control (AGC). Si además hacés trabajos de gas, necesitás la matrícula de gasista por separado.'
};

function onCambioEspecialidad() {
  const especialidad = document.getElementById('f-especialidad').value;
  const bloque = document.getElementById('bloque-matricula-obligatoria');
  const texto = document.getElementById('matricula-obligatoria-texto');
  const hint = document.getElementById('f-matricula-hint');
  if (RUBROS_MATRICULA_OBLIGATORIA[especialidad]) {
    bloque.style.display = 'block';
    texto.textContent = RUBROS_MATRICULA_OBLIGATORIA[especialidad];
    hint.textContent = 'Este rubro exige matrícula — completá también el organismo que te la otorgó abajo.';
  } else {
    bloque.style.display = 'none';
    hint.textContent = 'Si no tenés, dejalo vacío';
  }
}

function selectTipo(tipo) {
  tipoSeleccionado = tipo;
  document.getElementById('tipo-cliente').classList.toggle('selected', tipo === 'cliente');
  document.getElementById('tipo-socio').classList.toggle('selected', tipo === 'socio');
  document.getElementById('form-card').style.display = 'block';
  document.getElementById('socio-fields').classList.toggle('visible', tipo === 'socio');
  document.getElementById('btn-submit').textContent = tipo === 'cliente' ? 'Crear cuenta' : 'Enviar solicitud';
  document.getElementById('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function leerArchivoComoDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let timerChequeoUsuario = null;
let usuarioDisponible = false;

function chequearUsuario() {
  const input = document.getElementById('f-usuario');
  const estado = document.getElementById('usuario-estado');
  const sugerenciasBox = document.getElementById('usuario-sugerencias');
  input.value = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const valor = input.value;
  usuarioDisponible = false;
  sugerenciasBox.innerHTML = Chamba.html('');
  clearTimeout(timerChequeoUsuario);

  if (!valor) {
    estado.textContent = '3 a 20 caracteres: minúsculas, números y guion bajo (_), sin espacios ni acentos.';
    estado.style.color = 'var(--text-soft)';
    return;
  }
  if (valor.length < 3) {
    estado.textContent = 'Muy corto — necesita al menos 3 caracteres.';
    estado.style.color = '#a32d2d';
    return;
  }
  estado.textContent = 'Chequeando disponibilidad...';
  estado.style.color = 'var(--text-soft)';
  timerChequeoUsuario = setTimeout(async () => {
    try {
      const r = await Chamba.response(`${BACKEND}/api/usuarios/chequear-usuario?nombre_usuario=${encodeURIComponent(valor)}`);
      const data = await r.json();
      if (data.disponible) {
        usuarioDisponible = true;
        estado.textContent = '✓ Disponible';
        estado.style.color = '#1a8f5e';
      } else {
        usuarioDisponible = false;
        estado.textContent = data.error || 'Ese usuario ya existe.';
        estado.style.color = '#a32d2d';
        if (Array.isArray(data.sugerencias) && data.sugerencias.length) {
          sugerenciasBox.innerHTML =
            Chamba.html('<span style="font-size:12px;color:var(--text-soft);width:100%">¿Probás con alguna de estas?</span>' +
            data.sugerencias.map(s => `<button type="button" class="chip-sugerencia" ${Chamba.bind("click",function(event){elegirSugerenciaUsuario(`${s}`)})}>${Chamba.escape(s)}</button>`).join(''));
        }
      }
    } catch (e) {
      estado.textContent = 'No pudimos chequear la disponibilidad. Probá de nuevo.';
      estado.style.color = '#a32d2d';
    }
  }, 500);
}

function elegirSugerenciaUsuario(valor) {
  document.getElementById('f-usuario').value = valor;
  chequearUsuario();
}

function validarPassword(pass) {
  if (!pass || pass.length <= 6) return 'La contraseña tiene que tener más de 6 caracteres.';
  if (!/[A-Za-z]/.test(pass)) return 'La contraseña tiene que incluir al menos una letra.';
  if (!/[0-9]/.test(pass)) return 'La contraseña tiene que incluir al menos un número.';
  if (!/[^A-Za-z0-9]/.test(pass)) return 'La contraseña tiene que incluir al menos un símbolo (ej: !@#$%&).';
  return null;
}

function chequearRequisitosPassword() {
  const pass = document.getElementById('f-password').value;
  const marcar = (id, cumple) => {
    const li = document.getElementById(id);
    li.classList.toggle('ok', cumple);
    li.querySelector('.mark').textContent = cumple ? '✓' : '○';
  };
  marcar('req-len', pass.length > 6);
  marcar('req-letra', /[A-Za-z]/.test(pass));
  marcar('req-num', /[0-9]/.test(pass));
  marcar('req-sim', /[^A-Za-z0-9]/.test(pass));
}

async function registrar() {
  const btn = document.getElementById('btn-submit');
  const errorBox = document.getElementById('error-box');
  errorBox.style.display = 'none';

  const nombre = document.getElementById('f-nombre').value.trim();
  const telefono = document.getElementById('f-telefono').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const nombre_usuario = document.getElementById('f-usuario').value.trim();
  const password = document.getElementById('f-password').value;
  const password2 = document.getElementById('f-password2').value;
  const direccion_residencia = document.getElementById('f-direccion').value.trim();

  if (!nombre || !email || !nombre_usuario || !telefono || !password || !direccion_residencia) return showError('Completá todos los campos obligatorios.');
  if (nombre_usuario.length < 3) return showError('El nombre de usuario tiene que tener al menos 3 caracteres.');
  if (!usuarioDisponible) return showError('Elegí un nombre de usuario disponible antes de continuar (mirá el chequeo debajo del campo).');
  const errorPassword = validarPassword(password);
  if (errorPassword) return showError(errorPassword);
  if (password !== password2) return showError('Las contraseñas no coinciden.');

  const body = { nombre, email, nombre_usuario, telefono, tipo: tipoSeleccionado, password, direccion_residencia };

  if (tipoSeleccionado === 'socio') {
    const dni = document.getElementById('f-dni').value.trim();
    const especialidad = document.getElementById('f-especialidad').value;
    const experiencia = document.getElementById('f-experiencia').value.trim();
    const matricula = document.getElementById('f-matricula').value.trim();
    const matricula_organismo = document.getElementById('f-matricula-organismo').value.trim();
    const direccion_trabajo = document.getElementById('f-direccion-trabajo').value.trim();
    if (!dni || !especialidad || !experiencia) return showError('Completá todos los campos obligatorios para socios.');
    if (RUBROS_MATRICULA_OBLIGATORIA[especialidad] && (!matricula || !matricula_organismo)) {
      return showError(`${especialidad} exige matrícula habilitante: completá el número y el organismo que te la otorgó.`);
    }

    const archivoDni = document.getElementById('f-dni-foto').files[0];
    const archivoPerfil = document.getElementById('f-foto-perfil').files[0];
    if (!archivoDni) return showError('Subí una foto de tu DNI (frente).');
    if (!archivoPerfil) return showError('Subí una foto de perfil donde se te vea la cara.');

    const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
    const TAMANO_MAX = 8 * 1024 * 1024; // 8MB
    for (const [archivo, etiqueta] of [[archivoDni, 'La foto de DNI'], [archivoPerfil, 'La foto de perfil']]) {
      if (!TIPOS_PERMITIDOS.includes(archivo.type)) return showError(`${etiqueta} tiene que ser una imagen (JPG, PNG o WEBP).`);
      if (archivo.size > TAMANO_MAX) return showError(`${etiqueta} pesa más de 8MB. Subí una versión más liviana.`);
    }

    let dni_foto, foto_perfil;
    try {
      const [dataUrlDni, dataUrlPerfil] = await Promise.all([leerArchivoComoDataURL(archivoDni), leerArchivoComoDataURL(archivoPerfil)]);
      dni_foto = { data: dataUrlDni.split(',')[1], mime: archivoDni.type };
      foto_perfil = { data: dataUrlPerfil.split(',')[1], mime: archivoPerfil.type };
    } catch (e) {
      return showError('No pudimos leer las fotos. Probá subirlas de nuevo.');
    }

    Object.assign(body, { dni, especialidad, experiencia, matricula, matricula_organismo, direccion_trabajo, dni_foto, foto_perfil });
  }

  btn.disabled = true;
  btn.textContent = 'Registrando...';

  try {
    const r = await Chamba.response(`${BACKEND}/api/usuarios/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return showError(data.error || 'Error al registrar.');

    document.getElementById('form-content').style.display = 'none';
    if(data.aviso)Chamba.notice(data.aviso);
    emailRegistrado = email;
    document.getElementById('verif-email-destino').textContent = email;
    document.getElementById('verificar-box').style.display = 'block';
    iniciarTimerReenvio();
  } catch (e) {
    showError(e.message||'No se pudo conectar al servidor. Intentá de nuevo.');
  } finally {
    btn.disabled = false;
    btn.textContent = tipoSeleccionado === 'cliente' ? 'Crear cuenta' : 'Enviar solicitud';
  }
}

function iniciarTimerReenvio() {
  clearInterval(timerReenvio);
  let restante = 60;
  const timerEl = document.getElementById('verif-reenviar-timer');
  const btn = document.getElementById('btn-reenviar-codigo');
  btn.style.display = 'none';
  timerEl.textContent = `Podés pedir un código nuevo en ${restante}s`;
  timerReenvio = setInterval(() => {
    restante--;
    if (restante <= 0) {
      clearInterval(timerReenvio);
      timerEl.textContent = '';
      btn.style.display = 'inline';
    } else {
      timerEl.textContent = `Podés pedir un código nuevo en ${restante}s`;
    }
  }, 1000);
}

async function confirmarCodigoRegistro() {
  const codigo = document.getElementById('verif-codigo').value.trim();
  const errorBox = document.getElementById('verif-error-box');
  errorBox.style.display = 'none';
  if (!codigo) { errorBox.textContent = 'Ingresá el código que te mandamos.'; errorBox.style.display = 'block'; return; }
  const btn = document.getElementById('btn-verif');
  btn.disabled = true; btn.textContent = 'Confirmando...';
  try {
    const r = await Chamba.response(`${BACKEND}/api/verificar-codigo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailRegistrado, codigo, tipo: 'registro' })
    });
    const data = await r.json();
    if (!r.ok) { errorBox.textContent = data.error || 'Código incorrecto.'; errorBox.style.display = 'block'; return; }
    clearInterval(timerReenvio);
    document.getElementById('verificar-box').style.display = 'none';
    const box = document.getElementById('success-box');
    box.style.display = 'block';
    if (tipoSeleccionado === 'cliente') {
      document.getElementById('success-title').textContent = '¡Bienvenido a ChamBA!';
      document.getElementById('success-msg').textContent = 'Confirmamos tu email. Ya podés iniciar sesión y pedir servicios.';
    } else {
      document.getElementById('success-title').textContent = '¡Email confirmado!';
      document.getElementById('success-msg').textContent = 'Ahora nuestro equipo va a revisar tu solicitud y te avisamos por email en las próximas 48hs.';
    }
  } catch (e) {
    errorBox.textContent = 'No se pudo conectar al servidor. Intentá de nuevo.'; errorBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar';
  }
}

async function reenviarCodigoRegistro() {
  const btn = document.getElementById('btn-reenviar-codigo');
  btn.disabled = true;
  try {
    await Chamba.response(`${BACKEND}/api/enviar-codigo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailRegistrado, tipo: 'registro' })
    });
    iniciarTimerReenvio();
  } finally {
    btn.disabled = false;
  }
}

// ── Sugerencias de dirección (autocompletar, como Google Maps/PedidosYa) ──
const _timersBusqueda = {};
let _sugerenciasCache = [];

function onBuscarDireccion(input, boxId) {
  clearTimeout(_timersBusqueda[boxId]);
  const box = document.getElementById(boxId);
  const texto = input.value;
  if (!texto || texto.trim().length < 3) { box.classList.remove('open'); return; }
  _timersBusqueda[boxId] = setTimeout(async () => {
    try {
      const r = await Chamba.response(`${BACKEND}/api/geocodificar-buscar?q=${encodeURIComponent(texto)}`);
      const data = await r.json();
      _sugerenciasCache = Array.isArray(data) ? data : [];
      if (!_sugerenciasCache.length) {
        box.innerHTML = Chamba.html('<div class="sugerencia-item" style="color:var(--text-soft)">No encontramos direcciones. Probá con calle, número y ciudad.</div>');
        box.classList.add('open');
        return;
      }
      box.innerHTML = Chamba.html(_sugerenciasCache.map((s, i) => `<div class="sugerencia-item" ${Chamba.bind("click",function(event){elegirSugerencia(`${input.id}`,`${boxId}`,(i))})}><span>📍</span><span>${Chamba.escape(s.display_name)}</span></div>`).join(''));
      box.classList.add('open');
    } catch(e) {}
  }, 400);
}

function elegirSugerencia(inputId, boxId, i) {
  const s = _sugerenciasCache[i];
  if (!s) return;
  document.getElementById(inputId).value = s.display_name;
  document.getElementById(boxId).classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.form-group[style*="position:relative"]')) document.querySelectorAll('.sugerencias-box').forEach(b => b.classList.remove('open'));
});

function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  document.getElementById('btn-submit').disabled = false;
}

(async () => {
  try {
    const r = await Chamba.response(BACKEND + '/api/especialidades');
    const especialidades = await r.json();
    const select = document.getElementById('f-especialidad');
    if (Array.isArray(especialidades)) {
      select.innerHTML = Chamba.html('<option value="">Elegí una especialidad</option>' +
        especialidades.filter(e => e.activa).map(e => `<option>${Chamba.escape(e.nombre)}</option>`).join(''));
    }
  } catch(e) {}
})();
