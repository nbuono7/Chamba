# Chamba 🔧
### Plataforma de servicios del hogar con IA integrada

---

## Estructura del proyecto

```
chamba/
├── frontend/         → La página web (HTML, CSS, JS)
│   └── index.html
├── backend/          → El servidor (Node.js)
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── README.md
```

---

## Paso a paso para publicar

### 1. Subir el backend a Railway

1. Entrá a [railway.app](https://railway.app) y creá una cuenta (gratis)
2. Clic en **"New Project"** → **"Deploy from GitHub repo"**
3. Seleccioná este repositorio y la carpeta `backend`
4. En **Variables**, agregá:
   - `ANTHROPIC_API_KEY` = tu API key de Anthropic (sk-ant-...)
5. Railway te va a dar una URL tipo `https://chamba-backend.railway.app`
6. Copiá esa URL

### 2. Conectar el frontend con el backend

1. Abrí el archivo `frontend/index.html`
2. Buscá esta línea:
   ```js
   const BACKEND_URL = 'https://TU-BACKEND.railway.app';
   ```
3. Reemplazá `TU-BACKEND.railway.app` con la URL de Railway

### 3. Publicar el frontend en Vercel

1. Entrá a [vercel.com](https://vercel.com) y creá una cuenta (gratis)
2. Clic en **"New Project"** → conectá tu GitHub
3. Seleccioná este repositorio
4. En **Root Directory**, poné `frontend`
5. Clic en **Deploy**
6. Vercel te da una URL tipo `https://chamba.vercel.app` 🎉

### 4. Actualizar el número de WhatsApp

En `frontend/index.html`, buscá esta línea:
```js
window.open('https://wa.me/5491100000000?text=...
```
Reemplazá `5491100000000` con tu número de WhatsApp (código de país + número, sin + ni espacios).

---

## Variables de entorno (backend)

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | Tu API key de Anthropic |
| `PORT` | Puerto del servidor (Railway lo setea automático) |

---

## Próximas funciones a agregar

- [ ] Sistema de agenda online
- [ ] Perfiles de profesionales
- [ ] Pagos con Mercado Pago
- [ ] Panel de administración
- [ ] Notificaciones por WhatsApp

---

*Desarrollado con ❤️ usando Claude de Anthropic*
