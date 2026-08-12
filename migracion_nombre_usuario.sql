-- ============================================================
-- 1. Columnas nuevas en usuarios
-- ============================================================
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nombre_usuario text UNIQUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nombre_usuario_actualizado_at timestamptz;

-- ============================================================
-- 2. Generar un nombre de usuario único para las cuentas que ya existen
--    (a partir del nombre real, en minúsculas, sin espacios ni acentos;
--    si dos personas comparten el mismo nombre, a la segunda le agrega un número)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS unaccent;

WITH base AS (
  SELECT
    id,
    COALESCE(
      NULLIF(regexp_replace(lower(unaccent(nombre)), '[^a-z0-9]', '', 'g'), ''),
      'usuario'
    ) AS base_usuario
  FROM usuarios
  WHERE nombre_usuario IS NULL
),
numerado AS (
  SELECT
    id,
    base_usuario,
    row_number() OVER (PARTITION BY base_usuario ORDER BY id) AS rn
  FROM base
)
UPDATE usuarios u
SET nombre_usuario = CASE WHEN n.rn = 1 THEN n.base_usuario ELSE n.base_usuario || n.rn::text END,
    nombre_usuario_actualizado_at = now()
FROM numerado n
WHERE u.id = n.id;

-- ============================================================
-- 3. (Opcional pero recomendado) Si tu columna "estado" tiene un CHECK
--    constraint con los valores permitidos, agregale 'suspendido'.
--    Si "estado" es simplemente texto libre (sin constraint), no hace falta
--    correr nada acá — vas a saber si hace falta si el paso 4 tira error.
-- ============================================================
-- Ejemplo (el nombre real del constraint puede variar, revisá en Supabase
-- si te tira error en el paso 4):
-- ALTER TABLE usuarios DROP CONSTRAINT usuarios_estado_check;
-- ALTER TABLE usuarios ADD CONSTRAINT usuarios_estado_check
--   CHECK (estado IN ('pendiente','aprobado','rechazado','suspendido'));

-- ============================================================
-- 4. Verificación: confirmá que no haya quedado ninguna cuenta sin usuario,
--    y que todos los nombres de usuario sean únicos
-- ============================================================
SELECT count(*) AS sin_usuario FROM usuarios WHERE nombre_usuario IS NULL;
SELECT nombre_usuario, count(*) FROM usuarios GROUP BY nombre_usuario HAVING count(*) > 1;
