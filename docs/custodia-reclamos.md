# Custodia, reclamos y saldo — implementación de noviembre de 2026

## Antes y después

Antes, el código correcto liberaba inmediatamente el saldo neto del Socio. Los reportes eran texto sin congelamiento de dinero, no había un libro de comisiones ni retiros registrados, y eliminar una cuenta borraba su fila. Los pagos ya eran simulados y siguen siendo simulados.

Ahora el pago crea una custodia por el total, el código inicia una retención y un reclamo financiero la congela. El estado del trabajo sigue separado del estado del dinero. Los nuevos reclamos y saldos tienen una pantalla propia en `/reclamos`, accesible desde ambos paneles y administración. El Hub, Fletes y los archivos originales de marca no cambian. El contacto y chat entre las partes se conservan; una sanción de cuenta sí limita su acceso según las reglas aprobadas.

## Reglas aprobadas

| Situación | Resultado |
| --- | --- |
| Sin código al cumplirse 7 días desde el pago | Todo al saldo del Cliente; comisión cero |
| Código dentro del plazo | Retención de 48 horas corridas desde su registro |
| Termina la retención sin reclamo | Neto al Socio; comisión a ChamBA |
| Reclamo financiero dentro del plazo | Total congelado sin vencimiento automático |
| Resolución administrativa | Reparto bruto indicado por administración, menos una única comisión total del 13%, mínimo $1.000, distribuida proporcionalmente |
| Reclamo de conducta | No modifica el dinero, incluso si el trabajo tiene custodia |
| Baja de cuenta | Conserva datos y acceso limitado a reclamos, descargos y retiros |
| Saldo disponible tras baja | Cada lote tiene 7 días desde la baja o desde su nueva acreditación |
| Vence el retiro | Pasa a Saldos no reclamados, conservando titular y origen; no es ingreso |

Ejemplo: trabajo de $10.000, reparto bruto 45% Cliente y 55% Socio. Comisión única $1.300. Cliente: bruto $4.500, comisión $585, neto $3.915. Socio: bruto $5.500, comisión $715, neto $4.785. Si la resolución administrativa asigna 100% al Cliente, recibe $8.700. La devolución automática por falta de código sigue siendo $10.000.

El aviso anterior decía que sin código el Cliente no podía recuperar dinero. Se reemplaza porque contradice la devolución automática aprobada. Se exige un checkbox y se guarda la versión aceptada y su fecha.

## Datos, permisos y contabilidad

- `chamba_config`: plazos, recordatorios 3/5/6, comisión, mínimo, umbrales visuales y frecuencia de reclamos. La custodia guarda una copia al pagar: cambiar la configuración no altera acuerdos en curso. Los colores del legajo usan la configuración vigente.
- `custodias`: total y comisión en centavos enteros, participantes, estado y fechas con zona horaria. No publica el código.
- `reclamos`, `reclamo_adjuntos`: un reclamo de dinero por trabajo, descripción obligatoria, descargo, vencimiento, resolución y reparto. Hasta 5 JPG/PNG/WebP de 8 MB por presentación. Bucket privado y URLs de 10 minutos, firmadas solo después de validar participación o administración.
- `libro_contable`: transferencias entre cuentas de custodia, disponible, comisiones, retirado simulado y no reclamado. Cada transferencia resta de un origen y suma a un destino. Claves únicas y estados terminales evitan repetir pagos o comisiones.
- `saldo_lotes`: disponibilidad, remanente, fecha de vencimiento y traspaso por titular. Retiros consumen primero los lotes que vencen antes.
- `auditoria`: tomar, responder, resolver, ampliar plazo, sancionar, retirar y ajustar. Libro y auditoría rechazan UPDATE, DELETE y TRUNCATE. El backend no tiene esos permisos. Un propietario de la base sigue teniendo facultades administrativas: no se afirma inmutabilidad frente al dueño de PostgreSQL.
- `notificaciones`: aviso in-app y cola persistente de emails con clave por evento/destinatario, lease y reintentos. La baja conserva su acceso.

Todas las tablas nuevas tienen RLS sin acceso de navegador. Las funciones son `SECURITY INVOKER` con `search_path=''` y ejecución restringida a `service_role`. La API valida la sesión vigente en cada petición. Un token anterior a una sanción deja de servir; el nuevo login obtiene alcance limitado. Los retiros y ajustes exigen contraseña además de la sesión y tienen límite de intentos.

Las transacciones financieras toman un mismo advisory lock antes de los locks de filas. Es una decisión deliberada para el volumen inicial: evita ordenaciones contradictorias entre cuenta, reclamo y trabajo. El reloj se lee después de adquirir ese lock. Antes del vencimiento se acepta el código/reclamo; desde el vencimiento se rechaza aunque cron todavía no haya corrido. Un reclamo válido que se confirma primero deja la custodia en disputa; cron nunca la libera. Esta serialización requiere evaluar capacidad antes de un crecimiento importante.

## Compatibilidad e incidencias anteriores

No existen fechas de pago fiables en los trabajos anteriores. No se generan plazos retroactivos. Los trabajos pagados sin fila en `custodias` conservan su cierre anterior; una liberación posterior a esta migración registra un lote y su movimiento como `liberacion_anterior`. La interfaz los identifica como anteriores y pide revisión administrativa ante incidencias. Los reportes antiguos permanecen en `disputas`, no se transforman en reclamos financieros. Cerrarlos registra auditoría y no mueve fondos.

Los saldos disponibles existentes se incorporan con asientos `apertura_historica`: no son comisiones nuevas. Los saldos bloqueados anteriores se conservan. No se afirma conciliación histórica completa sin revisar las operaciones anteriores.

Al dar de baja: se cancelan solicitudes propias sin pagar y se rechazan ofertas pendientes del Socio. Los trabajos ya pagados mantienen custodia y plazos; administración recibe un aviso para revisarlos. La sanción no devuelve, incauta ni libera por sí sola. Un trabajo pendiente de código termina en devolución al Cliente si se vence el plazo; uno con reclamo financiero queda congelado. Para nueva contratación se crea una nueva solicitud; no se reinicia una que ya tiene movimientos de custodia.

Los ajustes de comisión son asientos nuevos que devuelven una parte de una comisión a uno de los participantes. Requieren motivo, contraseña, saldo suficiente y no pueden superar lo cobrado para ese trabajo. No se editan importes históricos.

## Tareas automáticas y correos

`supabase/operations/enable-custody-cron.sql` programa `chamba_tick()` cada minuto en Supabase. Funciona aunque no haya una página abierta y aunque Render esté dormido. Los plazos legales del flujo son exactos; el procesamiento visible puede demorarse hasta la siguiente ejecución o recuperarse después de una interrupción.

Otro cron llama al worker autenticado de Render solo si hay avisos pendientes. `CRON_SECRET` en Render debe coincidir con `chamba_cron_secret` en Vault; no se guarda el valor en GitHub. La cola `pg_net` no queda legible para roles del navegador. Cada ejecución procesa hasta 5 correos y reserva 5 minutos para su lease. Resend recibe una clave estable por notificación. Se reintenta con espera creciente; la entrega es al menos una vez, no una promesa de email exactamente una vez fuera de la ventana de idempotencia del proveedor. In-app no duplica el evento.

No se crea un servicio de cron de pago en Render. Hay que supervisar consumo/cuotas de Supabase, Render y Resend. El cron HTTP se activa solo tras configurar el secreto y verificar el backend. Estado de cola y errores son independientes de que cron haya conseguido iniciar una solicitud HTTP.

Fuentes de la integración, revisadas al implementar: [Cron](https://supabase.com/docs/guides/cron), [programación con Vault y pg_net](https://supabase.com/docs/guides/functions/schedule-functions), [changelog](https://supabase.com/changelog).

## Validación y activación

`npm run build` ejecuta sintaxis, referencias HTML y todas las pruebas; produce solo archivos públicos. `tests/escrow.test.cjs` aplica ambas migraciones en PostgreSQL/PGlite y verifica código, plazo, reclamo 47h59, congelamiento prolongado, reparto completo y parcial, mínimo, bajas, lotes, retiros, ajustes, permisos, auditoría y outbox. `tests/security.test.cjs` verifica alcance limitado, acceso al legajo, actor de sesión, reautenticación y baja lógica. `tests/claims-ui.test.cjs` verifica XSS, reparto visual y aceptación obligatoria.

PGlite ejecuta SQL PostgreSQL pero no sustituye una prueba multi conexión en el proyecto de destino. La suite de la migración anterior se mantiene separada para comprobar compatibilidad de ese paso; la suite nueva aplica toda la cadena.

Antes de activar en producción:

1. Verificar respaldo/restauración y estado actual de migraciones. Probar con cuentas sintéticas en un entorno aislado, incluyendo navegador móvil y dos sesiones concurrentes. No usar datos reales como fixtures.
2. Coordinar una ventana sin nuevas escrituras: el servidor anterior modifica saldos directamente y no debe convivir con el nuevo flujo. Aplicar primero `20261031002149_harden_marketplace.sql` y luego `20261108211735_escrow_claims_accounts.sql` una sola vez. Verificar saldos de apertura y permisos.
3. Publicar backend y frontend de esta misma revisión; comprobar login, contacto, aceptación de oferta, código, reclamo y retiro simulado. No basta publicar solo Vercel.
4. Habilitar pg_cron/pg_net, configurar el secreto en Render y Vault, ejecutar el SQL de programación y revisar sus primeras ejecuciones y entregas de prueba. Nunca imprimir claves en logs o documentos.
5. Revisar advisors, funciones, RLS, comisiones y suma de movimientos. El aviso informativo RLS sin políticas es intencional para tablas exclusivas del backend.

No hacer rollback al servidor anterior después de recibir pagos en el flujo nuevo: desconoce las custodias. Ante problemas, detener nuevas operaciones y corregir hacia adelante conservando registros. Desactivar cron por sí solo no cancela obligaciones ni cambia plazos.

## Prueba manual guiada

Usar Cliente, Socio y Admin sintéticos; no cambiar el reloj ni la configuración de producción para acelerar pruebas.

1. Pago → comprobar aviso, checkbox, fecha de 7 días y cartel persistente para ambas partes.
2. Código → verificar retención 48 horas y saldo disponible todavía sin crédito. Sin reclamo → neto al Socio y comisión en SALDO.
3. Repetir con resoluciones 100/0, 0/100 y 45/55; comparar bruto, comisión y neto. Repetir una solicitud: no debe duplicar movimientos.
4. Reclamar a 47h59. Dejar vencer el plazo original y pasar días: cambia el color, nunca el dinero. Intentar con un tercero y fuera del plazo: rechazar.
5. Código antes y después del límite: antes inicia retención; después se rechaza y el total se devuelve al Cliente sin comisión.
6. Denuncia de conducta y baja: no tocar custodia, bloquear operaciones normales, permitir descargo y retiro. Liberar después una disputa a esa cuenta: iniciar un nuevo lote de 7 días.
7. Vencer lote → no reclamado con titular y origen; retiro fuera de plazo bloqueado. Admin: retirar con saldo suficiente e insuficiente; verificar auditoría y contraseña.
8. Adjuntar imagen válida e inválida; comprobar que un tercero no recibe URLs privadas. Simular caída del proveedor de email, reintento y respuesta perdida.

Pendientes operativos de lanzamiento: pasarela real y sus costos, política de restitución posterior de no reclamados, revisión del texto de términos antes de mover dinero real. No se conecta ninguna pasarela en esta implementación.
