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

module.exports = { emailBienvenidaCliente, emailSocioAprobado, emailSocioRechazado, emailNuevaTarea, emailPedidoRecibido };
