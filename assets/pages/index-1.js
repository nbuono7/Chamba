
  const BACKEND_URL = 'https://chamba-backend-vurx.onrender.com';

  let selectedService = '';
  let photoBase64List = [];
  let usuarioLogueado = null;

  // Chequear si hay usuario logueado al cargar la página
  window.addEventListener('DOMContentLoaded', () => {
    const u = localStorage.getItem('chamba_user');
    if (u) {
      usuarioLogueado = JSON.parse(u);
      // Cambiar nav: mostrar nombre y panel
      const navLinks = document.querySelector('.nav-links');
      if (navLinks) {
        navLinks.innerHTML = Chamba.html(`
          <a href="#servicios" class="nav-link-desktop">Servicios</a>
          <a href="#como-funciona" class="nav-link-desktop">Cómo funciona</a>
          <a href="#ia" class="nav-link-desktop">IA</a>
          <a href="${Chamba.escape(usuarioLogueado.tipo === 'socio' ? '/panel-socio' : '/panel-cliente')}" class="nav-cta">Mi panel</a>
        `);
      }
    } else {
      // Mostrar bloqueo en la sección de IA
      mostrarBloqueIA();
    }
  });

  function mostrarBloqueIA() {
    const formBody = document.querySelector('.app-form-body');
    if (!formBody) return;
    formBody.innerHTML = Chamba.html(`
      <div style="text-align:center;padding:32px 16px">
        <div style="font-size:48px;margin-bottom:16px">🔒</div>
        <div style="font-size:18px;font-weight:600;margin-bottom:8px">Registrate para usar la IA</div>
        <div style="font-size:14px;color:var(--text-mid);margin-bottom:24px;line-height:1.6">
          El diagnóstico con IA está disponible para usuarios registrados en ChamBA. Es gratis y tarda menos de 1 minuto.
        </div>
        <a href="/registro" style="display:inline-block;background:var(--teal);color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:500;font-size:15px;margin-bottom:12px">Crear cuenta gratis</a>
        <br>
        <a href="/login" style="font-size:14px;color:var(--teal);text-decoration:none">Ya tengo cuenta → Ingresar</a>
      </div>
    `);
  }

  function irAServicio(service) {
    if (!window.hubCatalog || !window.hubCatalog.has(service)) return;
    sessionStorage.setItem('chamba_request_draft',JSON.stringify({servicio:service,descripcion:''}));
    if (!usuarioLogueado) {
      window.location.href = '/registro';
      return;
    }
    document.getElementById('app-section').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => selectService(service), 500);
  }

  function selectService(service, btn) {
    if (!window.hubCatalog || !window.hubCatalog.has(service)) return;
    selectedService = service;
    document.querySelectorAll('.service-mini-btn').forEach(b => b.classList.remove('selected'));
    const elegido = btn || [...document.querySelectorAll('.service-mini-btn')].find(b => b.dataset.service === service);
    if (elegido) elegido.classList.add('selected');
  }

  function goHome() {
    setScreen('screen-home');
    document.getElementById('result-content').innerHTML = Chamba.html('');
    selectedPhotoFiles = [];
    photoBase64List = [];
    const preview = document.getElementById('photo-preview');
    if (preview) preview.innerHTML = Chamba.html('');
  }

  function setScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  let selectedPhotoFiles = [];

  function leerArchivoComoDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function handlePhotos(event) {
    const files = Array.from(event.target.files || []);
    const MAX_FOTOS = 4;
    const TAMANO_MAX = 8 * 1024 * 1024; // 8MB
    for (const file of files) {
      if (selectedPhotoFiles.length >= MAX_FOTOS) { alert(`Máximo ${MAX_FOTOS} fotos.`); break; }
      if (file.size > TAMANO_MAX) { alert(`"${file.name}" pesa más de 8MB. Probá con otra foto.`); continue; }
      selectedPhotoFiles.push(file);
    }
    event.target.value = ''; // permite volver a elegir el mismo archivo si lo saca y lo quiere subir de nuevo
    renderPhotoPreview();
  }

  async function renderPhotoPreview() {
    const preview = document.getElementById('photo-preview');
    preview.innerHTML = Chamba.html('');
    photoBase64List = [];
    for (let i = 0; i < selectedPhotoFiles.length; i++) {
      const idx = i;
      const dataUrl = await leerArchivoComoDataURL(selectedPhotoFiles[idx]);
      photoBase64List.push(dataUrl.split(',')[1]);
      const wrap = document.createElement('div');
      wrap.className = 'photo-thumb-wrap';
      wrap.innerHTML = Chamba.html(`<img src="${Chamba.escape(dataUrl)}" class="photo-thumb" alt="Foto ${Chamba.escape(idx + 1)}">`);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'photo-remove';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Sacar esta foto');
      removeBtn.onclick = () => { selectedPhotoFiles.splice(idx, 1); renderPhotoPreview(); };
      wrap.appendChild(removeBtn);
      preview.appendChild(wrap);
    }
  }

  async function analyzeWithAI() {
    if (!usuarioLogueado) { window.location.href = '/login'; return; }
    const desc = document.getElementById('problem-desc').value.trim();
    if (!selectedService && !desc && photoBase64List.length === 0) {
      alert('Por favor elegí un servicio o describí el problema.');
      return;
    }
    setScreen('screen-result');
    document.getElementById('thinking').style.display = 'flex';
    document.getElementById('result-content').innerHTML = Chamba.html('');
    try {
      const result=await Chamba.api(BACKEND_URL,'/api/analizar','POST',{servicio:selectedService||'No especificado',descripcion:desc,fotos:photoBase64List});
      await showResult(result);
    } catch (err) {
      document.getElementById('thinking').style.display = 'none';
      document.getElementById('result-content').innerHTML =
        Chamba.html(`<div class="error-box" role="alert"><strong>Error:</strong> ${Chamba.escape(err.message || 'No se pudo conectar. Verificá tu conexión.')}</div>`);
    }
  }

  async function showResult(r) {
    await Chamba.saveDraftPhotos(photoBase64List.map((data,i)=>'data:'+selectedPhotoFiles[i].type+';base64,'+data));
    sessionStorage.setItem('chamba_request_draft',JSON.stringify({servicio:selectedService,descripcion:document.getElementById('problem-desc').value,diagnostico:r}));
    document.getElementById('thinking').style.display = 'none';
    const urgClass = r.urgencia === 'Alta' ? 'urgencia-alta' : r.urgencia === 'Media' ? 'urgencia-media' : 'urgencia-baja';
    document.getElementById('result-content').innerHTML = Chamba.html(`
      <div class="result-card green">
        <div class="card-label">Profesional recomendado</div>
        <div class="pro-name">${Chamba.escape(r.profesional)}</div>
        <span class="urgencia-badge ${Chamba.escape(urgClass)}">Urgencia ${Chamba.escape(r.urgencia)}</span>
      </div>
      <div class="result-card">
        <div class="card-label">Diagnóstico</div>
        <div class="card-content">${Chamba.escape(r.diagnostico)}</div>
      </div>
      <div class="result-card">
        <div class="card-label">Costo estimado</div>
        <div class="price-range">$${Chamba.escape(Number(r.precio_min).toLocaleString('es-AR'))} – $${Chamba.escape(Number(r.precio_max).toLocaleString('es-AR'))}</div>
        <div class="price-note">Estimación orientativa. El precio final puede variar.</div>
      </div>
      <div class="result-card">
        <div class="card-label">Mientras esperás</div>
        <div class="card-content">${Chamba.escape(r.recomendacion)}</div>
      </div>
      ${r.puede_solo ? `<div class="result-card" style="border-color:#F0955F;background:#FBE9DC;">
        <div class="card-label" style="color:var(--teal-deeper)">¿Lo podés resolver vos?</div>
        <div class="card-content" style="color:var(--teal-deeper)">Puede que puedas solucionarlo sin un profesional. Si tenés dudas, igual te recomendamos consultar.</div>
      </div>` : ''}
      <a href="/panel-cliente" data-panel-link style="display:flex;align-items:center;justify-content:center;gap:8px;background:var(--teal);color:#fff;padding:13px;border-radius:10px;text-decoration:none;font-weight:500;font-size:15px;margin-top:4px">
        📋 Ir a mi panel para pedir el servicio
      </a>
    `);
  }
