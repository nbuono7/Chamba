
const BACKEND = 'https://chamba-backend-vurx.onrender.com';
let emailLogin = '';
let adminChallenge = null;
let timerReenvioLogin = null;

function mostrarPaso(paso) {
  if(paso!=='codigo')adminChallenge=null;
  document.getElementById('error-box').style.display = 'none';
  document.getElementById('paso-email').style.display = paso === 'email' ? 'block' : 'none';
  document.getElementById('paso-codigo').style.display = paso === 'codigo' ? 'block' : 'none';
  document.getElementById('paso-password').style.display = paso === 'password' ? 'block' : 'none';
  document.getElementById('paso-olvide').style.display = paso === 'olvide' ? 'block' : 'none';
  document.getElementById('paso-olvide-enviado').style.display = paso === 'olvide-enviado' ? 'block' : 'none';
  clearInterval(timerReenvioLogin);
  if (paso === 'password') document.getElementById('f-email-pass').value = document.getElementById('f-email').value.trim();
  if (paso === 'olvide') document.getElementById('f-email-olvide').value = document.getElementById('f-email-pass').value.trim();
}

async function pedirResetPassword() {
  const btn = document.getElementById('btn-pedir-reset');
  const errorBox = document.getElementById('error-box');
  errorBox.style.display = 'none';
  const identificador = document.getElementById('f-email-olvide').value.trim();
  if (!identificador) return showError('Ingresá tu usuario o email.');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const r = await Chamba.response(`${BACKEND}/api/usuarios/olvide-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificador })
    });
    if (!r.ok) { const data = await r.json().catch(() => ({})); return showError(data.error || 'No se pudo enviar el link.'); }
    mostrarPaso('olvide-enviado');
  } catch(e) { showError(e.message||'No se pudo conectar. Intentá de nuevo.'); }
  finally { btn.disabled = false; btn.textContent = 'Enviar link de recuperación'; }
}

function togglePass() {
  const input = document.getElementById('f-pass');
  const btn = document.getElementById('pass-toggle-btn');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  btn.textContent = visible ? '👁️' : '🙈';
}

async function pedirCodigo() {
  const btn = document.getElementById('btn-siguiente');
  const errorBox = document.getElementById('error-box');
  errorBox.style.display = 'none';
  const identificador = document.getElementById('f-email').value.trim();
  if (!identificador) return showError('Ingresá tu usuario o email.');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const r = await Chamba.response(`${BACKEND}/api/enviar-codigo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificador, tipo: 'login' })
    });
    const data = await r.json();
    if (!r.ok) return showError(data.error || 'No se pudo enviar el código.');
    emailLogin = data.email; // el backend devuelve el email real, aunque hayas puesto tu nombre de usuario
    document.getElementById('codigo-email-destino').textContent = data.email;
    mostrarPaso('codigo');
    iniciarTimerReenvioLogin();
  } catch(e) { showError(e.message||'No se pudo conectar. Intentá de nuevo.'); }
  finally { btn.disabled = false; btn.textContent = 'Siguiente'; }
}

function iniciarTimerReenvioLogin() {
  clearInterval(timerReenvioLogin);
  let restante = 60;
  const timerEl = document.getElementById('codigo-reenviar-timer');
  const btn = document.getElementById('btn-reenviar-codigo');
  btn.style.display = 'none';
  timerEl.textContent = `Podés pedir un código nuevo en ${restante}s`;
  timerReenvioLogin = setInterval(() => {
    restante--;
    if (restante <= 0) {
      clearInterval(timerReenvioLogin);
      timerEl.textContent = '';
      btn.style.display = 'inline';
    } else {
      timerEl.textContent = `Podés pedir un código nuevo en ${restante}s`;
    }
  }, 1000);
}

async function reenviarCodigoLogin() {
  if(adminChallenge){mostrarPaso('password');return showError('Volvé a ingresar tu contraseña para recibir un código nuevo.');}
  const btn = document.getElementById('btn-reenviar-codigo');
  btn.disabled = true;
  try {
    await Chamba.response(`${BACKEND}/api/enviar-codigo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificador: emailLogin, tipo: 'login' })
    });
    iniciarTimerReenvioLogin();
  } finally { btn.disabled = false; }
}

async function confirmarCodigoLogin() {
  const btn = document.getElementById('btn-confirmar-codigo');
  const errorBox = document.getElementById('error-box');
  errorBox.style.display = 'none';
  const codigo = document.getElementById('f-codigo').value.trim();
  if (!codigo) return showError('Ingresá el código que te mandamos.');
  btn.disabled = true; btn.textContent = 'Verificando...';
  try {
    const r = await Chamba.response(`${BACKEND}/api/verificar-codigo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailLogin, codigo, tipo: 'login', challenge:adminChallenge })
    });
    const data = await r.json();
    if (!r.ok) return showError(data.error || 'Código incorrecto.');
    clearInterval(timerReenvioLogin);
    if(data.requires_mfa){
      adminChallenge=data.challenge;emailLogin=data.email;
      document.getElementById('f-pass').value='';
      document.getElementById('f-codigo').value='';
      document.getElementById('codigo-email-destino').textContent=data.email;
      mostrarPaso('codigo');iniciarTimerReenvioLogin();return;
    }
    localStorage.setItem('chamba_user', JSON.stringify(data.usuario));
    localStorage.setItem('chamba_token', data.token);
    const destino = ['baja','suspendido'].includes(data.usuario.estado) ? '/reclamos' : data.usuario.tipo === 'socio' ? '/panel-socio' : data.usuario.tipo === 'admin' ? '/admin' : '/panel-cliente';
    window.location.href = destino;
  } catch(e) { showError(e.message||'No se pudo conectar. Intentá de nuevo.'); }
  finally { btn.disabled = false; btn.textContent = 'Ingresar'; }
}

async function doLogin() {
  const btn = document.getElementById('btn-login');
  const errorBox = document.getElementById('error-box');
  errorBox.style.display = 'none';
  const identificador = document.getElementById('f-email-pass').value.trim();
  const password = document.getElementById('f-pass').value;
  if (!identificador || !password) return showError('Completá todos los campos.');
  btn.disabled = true; btn.textContent = 'Ingresando...';
  try {
    const r = await Chamba.response(`${BACKEND}/api/usuarios/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificador, password })
    });
    const data = await r.json();
    if (!r.ok) return showError(data.error || 'Error al ingresar.');
    if(data.requires_mfa){
      adminChallenge=data.challenge;emailLogin=data.email;
      document.getElementById('f-pass').value='';
      document.getElementById('f-codigo').value='';
      document.getElementById('codigo-email-destino').textContent=data.email;
      mostrarPaso('codigo');iniciarTimerReenvioLogin();return;
    }
    localStorage.setItem('chamba_user', JSON.stringify(data.usuario));
    localStorage.setItem('chamba_token', data.token);
    const destino = ['baja','suspendido'].includes(data.usuario.estado) ? '/reclamos' : data.usuario.tipo === 'socio' ? '/panel-socio' : data.usuario.tipo === 'admin' ? '/admin' : '/panel-cliente';
    window.location.href = destino;
  } catch(e) { showError(e.message||'No se pudo conectar. Intentá de nuevo.'); }
  finally { btn.disabled = false; btn.textContent = 'Ingresar'; }
}

function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg; box.style.display = 'block';
}
