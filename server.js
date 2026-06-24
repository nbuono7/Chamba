const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({ status: 'Chamba API funcionando ✅' });
});

app.post('/api/analizar', async (req, res) => {
  const { servicio, descripcion, fotos } = req.body;

  if (!servicio && !descripcion && (!fotos || fotos.length === 0)) {
    return res.status(400).json({ error: 'Falta información del problema.' });
  }

  const userContent = [];

  if (fotos && fotos.length > 0) {
    fotos.forEach(b64 => {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: b64 }
      });
    });
  }

  userContent.push({
    type: 'text',
    text: `Sos el asistente de Chamba, una empresa argentina de servicios del hogar. 
El cliente necesita ayuda con: "${servicio}".
Descripción del problema: ${descripcion || '(el cliente subió fotos, analízalas)'}

Respondé SOLO en JSON con esta estructura exacta, sin backticks ni texto extra:
{
  "profesional": "qué tipo de profesional necesita",
  "urgencia": "Alta / Media / Baja",
  "diagnostico": "diagnóstico breve del problema en 2-3 oraciones",
  "precio_min": número en pesos argentinos,
  "precio_max": número en pesos argentinos,
  "recomendacion": "consejo práctico mientras espera al profesional",
  "puede_solo": true o false
}`
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const text = data.content.map(i => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al analizar. Intentá de nuevo.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Chamba backend corriendo en puerto ${PORT}`));
