# Refuerzo administrativo y verificación

Administración exige contraseña y luego código por email. La contraseña válida emite un desafío firmado de diez minutos, sin acceso a la API. El hash del código está ligado a ese desafío y la base lo consume una sola vez, con cinco intentos como máximo. La sesión administrativa dura una hora y las sesiones anteriores sin segundo paso se rechazan. Cambiar de estado o versión de sesión invalida el acceso. Cliente y Socio mantienen sus métodos de ingreso.

El desafío solo vive en memoria de la pantalla; recargar o pedir otro código requiere volver a ingresar la contraseña. La recuperación de contraseña mantiene su flujo de email. Esto protege contra una contraseña filtrada por separado; no sustituye una llave física ni protege una casilla de email comprometida. La casilla administrativa debe tener su propia autenticación de dos factores.

Validación: `npm run build` pasa 76 pruebas; `npm audit --omit=dev` reporta cero vulnerabilidades conocidas al 10 de noviembre de 2026.

`CHAMBA_PG_TOOLS=/ruta/a/herramientas node scripts/verify-concurrency.mjs` ejecuta PostgreSQL aislado con datos sintéticos. Instalar `embedded-postgres@18.6.0-beta.19` en esa carpeta temporal. Ocho conexiones compiten por aceptación, finalización, liquidación, retiros y consumo de un código. Verifica una sola custodia/comisión, ausencia de sobregiro y un solo consumo del código. Copia el clúster detenido, lo restaura y compara cantidades y huellas de todas las filas públicas. Probado en PostgreSQL 18.6; producción usa 17.

La restauración sintética no acredita recuperación del proyecto Supabase de producción ni de sus objetos Storage. La copia privada dentro de la misma base protege frente a una migración incorrecta, pero no frente a pérdida del proyecto completo. El respaldo independiente del proveedor y la recuperación de Storage requieren verificación adicional antes de operar con dinero real.
