
const BACKEND = 'https://chamba-backend-vurx.onrender.com';
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

window.onload = () => {
  if (!token) {
    document.getElementById('form-card').innerHTML = Chamba.html(`
      <div class="title">Link inválido</div>
      <div class="sub">Este link no tiene la información necesaria para restablecer tu contraseña. Pedí uno nuevo desde la pantalla de inicio de sesión.</div>
      <a class="btn-link" href="/login">Volver a iniciar sesión</a>`);
  }
};

function togglePass(id, btn) {
  const input = document.getElementById(id);
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  btn.textContent = visible ? '👁️' : '🙈';
}

function chequearRequisitos() {
  const pass = document.getElementById('f-pass1').value;
  marcar('req-len', pass.length > 6);
  marcar('req-letra', /[A-Za-z]/.test(pass));
  marcar('req-num', /[0-9]/.test(pass));
  marcar('req-sim', /[^A-Za-z0-9]/.test(pass));
}

function marcar(id, cumple) {
  const li = document.getElementById(id);
  li.classList.toggle('ok', cumple);
  li.querySelector('.mark').textContent = cumple ? '✓' : '○';
}

function validarPassword(pass) {
  if (!pass || pass.length <= 6) return 'La contraseña tiene que tener más de 6 caracteres.';
  if (!/[A-Za-z]/.test(pass)) return 'La contraseña tiene que incluir al menos una letra.';
  if (!/[0-9]/.test(pass)) return 'La contraseña tiene que incluir al menos un número.';
  if (!/[^A-Za-z0-9]/.test(pass)) return 'La contraseña tiene que incluir al menos un símbolo (ej: !@#$%&).';
  return null;
}

function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = msg;
  box.style.display = 'block';
}

async function enviar() {
  document.getElementById('error-box').style.display = 'none';
  const pass1 = document.getElementById('f-pass1').value;
  const pass2 = document.getElementById('f-pass2').value;

  const errorFuerza = validarPassword(pass1);
  if (errorFuerza) return showError(errorFuerza);
  if (pass1 !== pass2) return showError('Las dos contraseñas no coinciden.');

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  try {
    const r = await Chamba.response(`${BACKEND}/api/usuarios/restablecer-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pass1 })
    });
    const data = await r.json();
    if (!r.ok) {
      btn.disabled = false; btn.textContent = 'Cambiar contraseña';
      return showError(data.error || 'No se pudo cambiar la contraseña.');
    }
    document.getElementById('form-card').style.display = 'none';
    document.getElementById('success-box').style.display = 'block';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Cambiar contraseña';
    showError(e.message||'No se pudo conectar. Intentá de nuevo.');
  }
}
