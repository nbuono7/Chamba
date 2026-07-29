const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

// Usamos Resend (gratis hasta 3000 emails/mes)
// Si no tenés cuenta en Resend, los emails se saltean sin romper la app
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@chamba.app';

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`[EMAIL SIMULADO] Para: ${to} | Asunto: ${subject}`);
    return;
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `ChamBA <${FROM_EMAIL}>`, to, subject, html })
    });
  } catch(e) { console.error('Error enviando email:', e.message); }
}

// Email: bienvenida al cliente
async function emailBienvenidaCliente(nombre, email) {
  await sendEmail(email, '¡Bienvenido a ChamBA!', `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#1D9E75">¡Hola ${nombre}! 👋</h2>
      <p>Tu cuenta en <strong>ChamBA</strong> fue creada exitosamente.</p>
      <p>Ya podés ingresar y pedir tu primer servicio.</p>
      <a href="https://chamba-vert.vercel.app/login" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Ir a mi panel →</a>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: socio aprobado
async function emailSocioAprobado(nombre, email) {
  await sendEmail(email, '¡Tu solicitud fue aprobada! 🎉', `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#1D9E75">¡Felicitaciones ${nombre}!</h2>
      <p>Tu solicitud para ser socio de <strong>ChamBA</strong> fue <strong>aprobada</strong>.</p>
      <p>Ya podés ingresar a tu panel y ver las tareas que te asignemos.</p>
      <a href="https://chamba-vert.vercel.app/login" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Ir a mi panel →</a>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: socio rechazado
async function emailSocioRechazado(nombre, email) {
  await sendEmail(email, 'Actualización sobre tu solicitud en ChamBA', `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#111">Hola ${nombre}</h2>
      <p>Lamentablemente tu solicitud para unirte a ChamBA no fue aprobada en esta oportunidad.</p>
      <p>Si tenés preguntas, respondé este email y te ayudamos.</p>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: nueva tarea asignada al socio
async function emailNuevaTarea(nombreSocio, emailSocio, servicio, descripcion) {
  await sendEmail(emailSocio, `Nueva tarea asignada: ${servicio}`, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#1D9E75">¡Tenés una nueva tarea! 🔧</h2>
      <p>Hola <strong>${nombreSocio}</strong>, ChamBA te asignó un nuevo trabajo:</p>
      <div style="background:#f4f5f4;border-radius:8px;padding:16px;margin:16px 0">
        <strong>Servicio:</strong> ${servicio}<br/>
        <strong>Descripción:</strong> ${descripcion}
      </div>
      <a href="https://chamba-vert.vercel.app/login" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:8px">Ver en mi panel →</a>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: pedido recibido al cliente
async function emailPedidoRecibido(nombreCliente, emailCliente, servicio) {
  await sendEmail(emailCliente, `Recibimos tu pedido de ${servicio}`, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#1D9E75">¡Pedido recibido! 📋</h2>
      <p>Hola <strong>${nombreCliente}</strong>, recibimos tu pedido de <strong>${servicio}</strong>.</p>
      <p>Nuestro equipo lo va a revisar y te avisamos cuando tengamos un profesional disponible.</p>
      <a href="https://chamba-vert.vercel.app/login" style="display:inline-block;background:#1D9E75;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Ver estado →</a>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: código de verificación (registro) o de inicio de sesión
async function emailCodigoVerificacion(nombre, email, codigo, tipo) {
  const titulo = tipo === 'registro' ? 'Confirmá tu email' : 'Tu código para iniciar sesión';
  const texto = tipo === 'registro'
    ? 'Usá este código para confirmar tu email y activar tu cuenta en ChamBA.'
    : 'Usá este código para iniciar sesión en ChamBA.';
  await sendEmail(email, `${titulo} — Tu código es ${codigo}`, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#1D9E75">Hola ${nombre} 👋</h2>
      <p>${texto}</p>
      <div style="background:#f4f5f4;border-radius:8px;padding:20px;margin:20px 0;text-align:center">
        <span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#111">${codigo}</span>
      </div>
      <p style="color:#888;font-size:13px">Este código vence en 10 minutos. Si no lo pediste vos, ignorá este mensaje.</p>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: nueva oferta (o contraoferta) recibida
async function emailNuevaOferta(nombre, email, servicio, precio, esContraoferta = false) {
  const asunto = esContraoferta ? `Nueva contraoferta para tu trabajo de ${servicio}` : `Nueva oferta para tu trabajo de ${servicio}`;
  await sendEmail(email, asunto, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#E2662D">${esContraoferta ? '💬 Nueva contraoferta' : '📬 Nueva oferta recibida'}</h2>
      <p>Hola <strong>${nombre}</strong>, tenés una ${esContraoferta ? 'contraoferta' : 'nueva oferta'} de <strong>$${Number(precio).toLocaleString('es-AR')}</strong> para tu trabajo de <strong>${servicio}</strong>.</p>
      <a href="https://chamba-vert.vercel.app/login" style="display:inline-block;background:#E2662D;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Ver oferta →</a>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: nuevo mensaje en el chat de un trabajo
async function emailNuevoMensaje(nombre, email, servicio, autorMensaje, contenido) {
  const preview = (contenido || '').slice(0, 120);
  await sendEmail(email, `${autorMensaje} te escribió sobre ${servicio}`, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#E2662D">💬 Nuevo mensaje</h2>
      <p>Hola <strong>${nombre}</strong>, tenés un mensaje nuevo de <strong>${autorMensaje}</strong> sobre el trabajo de <strong>${servicio}</strong>:</p>
      <div style="background:#f4f5f4;border-radius:8px;padding:14px 16px;margin:16px 0;font-style:italic">"${preview}${contenido && contenido.length > 120 ? '…' : ''}"</div>
      <a href="https://chamba-vert.vercel.app/login" style="display:inline-block;background:#E2662D;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:8px">Responder →</a>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

// Email: recordatorio de que el código está por vencer
async function emailCodigoPorVencer(nombre, email, tipo) {
  const contexto = tipo === 'registro' ? 'para confirmar tu email' : 'para iniciar sesión';
  await sendEmail(email, 'Tu código de ChamBA está por vencer', `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
      <h2 style="color:#B84F1F">⏳ Tu código está por vencer</h2>
      <p>Hola ${nombre ? nombre : ''}, el código que te mandamos ${contexto} vence en menos de 2 minutos.</p>
      <p>Si todavía no lo usaste, pedí uno nuevo desde la pantalla donde lo estabas ingresando.</p>
      <p style="color:#888;font-size:12px;margin-top:24px">ChamBA — Profesionales del hogar</p>
    </div>`);
}

module.exports = { emailBienvenidaCliente, emailSocioAprobado, emailSocioRechazado, emailNuevaTarea, emailPedidoRecibido, emailCodigoVerificacion, emailNuevaOferta, emailNuevoMensaje, emailCodigoPorVencer };
