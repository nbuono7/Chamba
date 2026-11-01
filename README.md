# ChamBA

Plataforma de servicios que conecta Clientes y Socios. Los pagos y saldos siguen siendo simulados por decisión del producto. Los SVG originales del diseñador se conservan sin recolorear.

## Arquitectura

- Vercel sirve las páginas HTML y `assets/`. `npm run build` genera `public-dist/` sin publicar servidor, SQL, pruebas ni dependencias.
- Render ejecuta Express (`server.js`) con Node 24. El frontend consume la API por HTTPS.
- Supabase guarda datos y archivos privados. Las tablas usan RLS sin políticas públicas; únicamente el backend utiliza la clave secreta. Nunca colocar esa clave en el navegador.
- Las decisiones sobre pedidos, negociación, códigos, calificaciones y saldos simulados son funciones transaccionales versionadas en `supabase/migrations/`.
- Resend envía correos. Anthropic brinda la estimación opcional. Publicar un pedido no exige utilizar IA.

## Desarrollo y pruebas

```sh
npm ci
npm run check
npm test
npm run build
npm start
```

Las pruebas usan datos sintéticos, Express aislado, jsdom y PostgreSQL local vía PGlite; no envían correos, mensajes ni cambios a producción. PGlite prueba SQL real, pero sus solicitudes se serializan: no reemplaza una prueba de concurrencia con conexiones PostgreSQL independientes. jsdom prueba DOM e interacciones, pero no calcula diseño visual.

## Configuración del servidor

Usar las variables del servicio Render, sin subir archivos `.env` al repositorio:

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_SECRET_KEY` | Clave exclusiva del servidor |
| `JWT_SECRET` | Secreto aleatorio de firma de sesiones |
| `RESEND_API_KEY`, `FROM_EMAIL` | Envíos desde un dominio verificado |
| `ANTHROPIC_API_KEY` | Diagnóstico opcional |
| `ANTHROPIC_MODEL` | Opcional; mantiene `claude-sonnet-5` por defecto |
| `SENTRY_DSN` | Monitoreo opcional, sin cuerpos HTTP ni datos de cuenta |
| `NODE_ENV` | `production` en Render |
| `PORT` | Lo asigna Render |

Render: build `npm ci --include=dev && npm run check && npm test`; start `npm start`; health check `/health`. No cambiar el plan ni activar servicios de pago automáticamente. La cola de geocodificación y los límites en memoria están diseñados para una instancia. Antes de escalar réplicas, compartir límites/caché o contratar un proveedor de geocodificación compatible. El catálogo tolera el arranque frío del plan gratuito.

## Reglas preservadas y aclaraciones

- Catálogo administrable: desactivar un rubro oculta nuevas solicitudes; no elimina trabajos históricos. Fletes usa el camión original.
- Comisión: 13%, mínimo $1.000. Se aceptan propuestas enteras superiores a $1.000 para evitar un neto nulo o negativo; no se cambia la comisión.
- El Socio puede aceptar el precio de una contraoferta; el Cliente confirma el trabajo y se habilita el chat en la etapa simulada habitual.
- Solo el Cliente recibe el código de finalización. Repetir aceptación o finalización no duplica saldos.
- Al reasignar se compensa el saldo simulado bloqueado. La nueva asignación tiene otra conversación; el nuevo Socio no recibe los mensajes del anterior.
- Los Socios conservan la opción de contratar servicios como Clientes.
- Sesiones: se verifica estado y rol actual en cada operación; suspender, cambiar contraseña o cambiar rol revoca tokens anteriores. Duración máxima de nuevos tokens: siete días.
- Las búsquedas de direcciones requieren pulsar Buscar o Enter. Nominatim se consulta en una cola de una solicitud cada 1,1 segundos, con caché y atribución.
- Registro guarda cuenta y ubicaciones juntas después de subir documentos. Si falla, limpia los archivos recién subidos. Un error de email permite pedir otro código; nunca se informa que fue enviado cuando el proveedor lo rechazó.

## Despliegue coordinado

1. Confirmar que `main` no cambió respecto de la base revisada y que las pruebas pasan.
2. Verificar copia de seguridad recuperable y compatibilidad del esquema, sin exportar datos personales al repositorio.
3. Aplicar la migración con Supabase; no ejecutar los archivos de fixtures `tests/schema.sql` y `tests/constraints.sql` en producción.
4. Desplegar API y frontend de la misma revisión. La migración debe existir antes de que la API nueva reciba tráfico. Las claves y datos reales no se usan en CI.
5. Verificar `/health`, catálogo y recorrido aislado Cliente→Socio→chat→código→reseña. Confirmar correo, IA y comportamiento móvil en un entorno de pruebas.

No volver al servidor antiguo después de activar las transacciones nuevas: volvería a abrir los defectos de autorización y doble saldo. Para revertir, conservar las columnas añadidas y publicar una corrección compatible; una reversión de datos requiere copia verificada y revisión de los movimientos posteriores.

## Pendientes que requieren validación operativa

- Prueba visual a 320–430 px, zoom 200%, teclado y dispositivos táctiles reales.
- Entrega real de correo y diagnóstico real de IA con cuentas aisladas; carga/concurrencia multi conexión.
- Verificación de backups y ensayo de restauración. No se afirma recuperación garantizada sin esa prueba.
- Política de retención/eliminación de DNI y comprobantes: definir plazo, responsable y canal de solicitud antes de automatizar borrados. No eliminar documentos existentes por una política inventada.
- Paginación visible y carga incremental del historial a gran escala. Se quitaron las solicitudes de ofertas por cada pedido y se recorren páginas de base de datos para no truncar registros; esto todavía no es una interfaz de historial paginado.
- Cookies HttpOnly exigirían un cambio coordinado de dominio/autenticación/CSRF. Se conserva la arquitectura actual con datos escapados, sanitización y CSP; no afirmar que localStorage se volvió HttpOnly.
