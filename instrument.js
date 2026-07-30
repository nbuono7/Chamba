const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1, // 10% de las peticiones, para no gastar la cuota gratis de más
  });
  console.log('✅ Sentry inicializado');
} else {
  console.log('⚠️  SENTRY_DSN no configurado — el monitoreo de errores está desactivado.');
}
