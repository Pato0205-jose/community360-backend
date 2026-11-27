(() => {
  const MAX_FILAS_TABLA = 20;
  const token = localStorage.getItem('token');

  // ---------------------------------------------------------
  // AUTENTICACIÓN Y CIERRE DE SESIÓN
  // ---------------------------------------------------------
  function cerrarSesion() {
    localStorage.removeItem('token');
    localStorage.removeItem('admin');
    window.location.replace('/login.html');
  }

  if (!token) {
    cerrarSesion();
    return;
  }

  document.getElementById('logoutBtn').addEventListener('click', cerrarSesion);

  try {
    const adminGuardado = JSON.parse(localStorage.getItem('admin') || 'null');
    if (adminGuardado) {
      document.getElementById('adminNombre').textContent = adminGuardado.nombre || 'Administrador';
      document.getElementById('adminEmail').textContent = adminGuardado.email || '';
    }
  } catch {
    // Ignorar si localStorage contiene datos inválidos
  }

  // ---------------------------------------------------------
  // ESTADO EN MEMORIA Y REFERENCIAS DEL DOM
  // ---------------------------------------------------------
  let interacciones = [];
  let alertas = [];
  let conteoCanales = {};
  let conteoToxicidadCanal = {};
  let chartPaises = null;
  let chartSentimiento = null;
  let chartCanales = null;
  let chartRetencion = null;
  let chartEconomiaEventos = null;
  let chartHorariosPico = null;
  let chartRadarTemas = null;
  let chartToxicidadCanal = null;
  let analisisCargado = false;
  let moderacionCargada = false;
  let world = null;

  const kpiUsuariosEl = document.getElementById('kpiUsuarios');
  const kpiInteraccionesEl = document.getElementById('kpiInteracciones');
  const kpiSentimientoEl = document.getElementById('kpiSentimiento');
  const kpiSentimientoBadgeEl = document.getElementById('kpiSentimientoBadge');
  const kpiArtistasEl = document.getElementById('kpiArtistas');
  const kpiEventosEl = document.getElementById('kpiEventos');
  const kpiComisionesEl = document.getElementById('kpiComisiones');
  const topContribuidoresListaEl = document.getElementById('topContribuidoresLista');
  const tablaBodyEl = document.getElementById('tablaInteraccionesBody');
  const tablaContadorEl = document.getElementById('tablaContador');
  const tablaAlertasBodyEl = document.getElementById('tablaAlertasBody');
  const alertasContadorEl = document.getElementById('alertasContador');
  const dashboardErrorEl = document.getElementById('dashboardError');
  const wsDotEl = document.getElementById('wsDot');
  const wsTextEl = document.getElementById('wsText');
  const toastContainerEl = document.getElementById('toastContainer');
  const listaPaisesEl = document.getElementById('lista-paises');
  const paisesContadorEl = document.getElementById('paisesContador');
  const btnResetGloboEl = document.getElementById('btnResetGlobo');
  const vistaTituloEl = document.getElementById('vistaTitulo');

  // ---------------------------------------------------------
  // NAVEGACIÓN POR PESTAÑAS (SIDEBAR TABS)
  // ---------------------------------------------------------
  const tabButtons = document.querySelectorAll('.nav-tab-btn[data-tab]');
  const tabPanels = document.querySelectorAll('[data-tab-panel]');

  const CLASES_TAB_ACTIVO = [
    'bg-sky-500/20',
    'border-sky-400/40',
    'text-white',
    'shadow-[0_0_15px_rgba(56,189,248,0.2)]',
  ];
  const CLASES_TAB_INACTIVO = [
    'bg-transparent',
    'border-transparent',
    'text-slate-300',
    'hover:bg-white/10',
    'hover:text-white',
  ];

  function cambiarTab(tabId) {
    tabPanels.forEach((panel) => {
      const esActivo = panel.dataset.tabPanel === tabId;
      panel.classList.toggle('hidden', !esActivo);
    });

    tabButtons.forEach((btn) => {
      const esActivo = btn.dataset.tab === tabId;
      if (esActivo) {
        btn.classList.remove(...CLASES_TAB_INACTIVO);
        btn.classList.add(...CLASES_TAB_ACTIVO);
        if (vistaTituloEl && btn.dataset.title) {
          vistaTituloEl.textContent = btn.dataset.title;
        }
      } else {
        btn.classList.remove(...CLASES_TAB_ACTIVO);
        btn.classList.add(...CLASES_TAB_INACTIVO);
      }
    });

    // Reajustar tamaño del Globo 3D y gráficas al cambiar de pestaña
    requestAnimationFrame(() => {
      if (tabId === 'resumen') {
        if (world) {
          const container = document.getElementById('globeViz');
          if (container && container.clientWidth > 0) {
            world.width(container.clientWidth).height(container.clientHeight || 384);
          }
        }
        if (chartPaises) chartPaises.resize();
        if (chartSentimiento) chartSentimiento.resize();
        if (chartCanales) chartCanales.resize();
      }

      if (tabId === 'comunidad') {
        if (!analisisCargado) {
          cargarAnalisis();
        }
        if (chartRetencion) chartRetencion.resize();
        if (chartEconomiaEventos) chartEconomiaEventos.resize();
        if (chartHorariosPico) chartHorariosPico.resize();
      }

      if (tabId === 'moderacion') {
        if (!moderacionCargada) {
          cargarModeracion();
        }
        if (chartRadarTemas) chartRadarTemas.resize();
        if (chartToxicidadCanal) chartToxicidadCanal.resize();
      }
    });
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => cambiarTab(btn.dataset.tab));
  });

  const PALETA_NEON = [
    '#38bdf8', // sky neon
    '#a855f7', // purple neon
    '#34d399', // emerald neon
    '#f472b6', // pink neon
    '#22d3ee', // cyan neon
    '#fbbf24', // amber neon
    '#818cf8', // indigo neon
    '#fb7185', // rose neon
  ];

  // Configuración global de Chart.js para modo oscuro
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#f8fafc';
    Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
  }

  // ---------------------------------------------------------
  // UTILIDADES
  // ---------------------------------------------------------
  function mostrarError(mensaje) {
    dashboardErrorEl.textContent = mensaje;
    dashboardErrorEl.classList.remove('hidden');
  }

  function mostrarToast(mensaje, tipo = 'info') {
    const colores =
      tipo === 'success'
        ? 'border-emerald-400/40 bg-emerald-950/90 text-emerald-200 shadow-[0_0_15px_rgba(52,211,153,0.25)]'
        : tipo === 'danger'
          ? 'border-rose-400/40 bg-rose-950/90 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
          : 'border-sky-400/40 bg-slate-900/95 text-sky-200';

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto rounded-xl border px-4 py-3 text-xs sm:text-sm font-medium backdrop-blur-md transition-opacity duration-300 ${colores}`;
    toast.textContent = mensaje;

    toastContainerEl.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escaparHtml(valor) {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatearFecha(isoString) {
    if (!isoString) return '-';
    const fecha = new Date(isoString);
    if (Number.isNaN(fecha.getTime())) return String(isoString);
    return fecha.toLocaleString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatearHoraCorta(isoString) {
    if (!isoString) return '';
    const fecha = new Date(isoString);
    if (Number.isNaN(fecha.getTime())) return String(isoString).slice(0, 10);
    return fecha.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
    });
  }

  function obtenerIdInteraccion(item) {
    return item?.id_interaccion || item?.id || '';
  }

  function badgeSentimiento(valor) {
    const num = Number(valor);
    if (Number.isNaN(num)) {
      return '<span class="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-slate-300">0.00</span>';
    }
    const texto = num > 0 ? `+${num.toFixed(2)}` : num.toFixed(2);
    if (num >= 0.2) {
      return `<span class="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">${texto}</span>`;
    }
    if (num <= -0.2) {
      return `<span class="inline-flex items-center rounded-full bg-rose-500/15 border border-rose-400/30 px-2.5 py-0.5 text-xs font-semibold text-rose-300">${texto}</span>`;
    }
    return `<span class="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-400/30 px-2.5 py-0.5 text-xs font-semibold text-amber-300">${texto}</span>`;
  }

  // ---------------------------------------------------------
  // INICIALIZACIÓN DEL GLOBO 3D (GLOBE.GL)
  // ---------------------------------------------------------
  function inicializarGlobo() {
    const container = document.getElementById('globeViz');
    if (!container || typeof Globe !== 'function') return;

    try {
      world = Globe()(container)
        .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
        .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
        .backgroundColor('rgba(0,0,0,0)')
        .showAtmosphere(true)
        .atmosphereColor('#38bdf8')
        .atmosphereAltitude(0.18)
        .ringsData([])
        .ringLat('lat')
        .ringLng('lng')
        .ringColor(() => '#00ff00')
        .ringAltitude(0.015)
        .ringMaxRadius(5)
        .ringPropagationSpeed(3)
        .ringRepeatPeriod(700)
        .width(container.clientWidth)
        .height(container.clientHeight || 384);

      const controls = world.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8;

      // Enfocar inicialmente hacia Latinoamérica
      world.pointOfView({ lat: 14, lng: -85, altitude: 2.1 });

      // Botón para regresar a la vista global con auto-rotación
      if (btnResetGloboEl) {
        btnResetGloboEl.addEventListener('click', () => {
          if (!world) return;
          world.controls().autoRotate = true;
          world.pointOfView({ lat: 14, lng: -85, altitude: 2.1 }, 1200);
          if (listaPaisesEl) {
            listaPaisesEl.querySelectorAll('button').forEach((b) => {
              b.classList.remove('bg-blue-500/20', 'border-blue-500');
              b.classList.add('border-transparent');
            });
          }
        });
      }

      // Mantener el globo ajustado al tamaño del contenedor
      const ajustarTamano = () => {
        if (world && container.clientWidth > 0) {
          world.width(container.clientWidth).height(container.clientHeight || 384);
        }
      };
      window.addEventListener('resize', ajustarTamano);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(ajustarTamano).observe(container);
      }
    } catch (error) {
      console.error('Error al inicializar Globe.gl:', error);
    }
  }

  function renderListaPaises(usuariosPorPais) {
    if (!listaPaisesEl) return;

    const paisesValidos = usuariosPorPais.filter(
      (p) => typeof p.lat === 'number' && typeof p.lng === 'number' && !Number.isNaN(p.lat) && !Number.isNaN(p.lng)
    );

    if (paisesContadorEl) {
      paisesContadorEl.textContent = `${paisesValidos.length} países`;
    }

    if (paisesValidos.length === 0) {
      listaPaisesEl.innerHTML =
        '<p class="text-xs text-slate-400 text-center py-8">Sin datos geográficos disponibles.</p>';
      return;
    }

    const maxCantidad = Math.max(...paisesValidos.map((p) => p.cantidad || 0), 1);
    listaPaisesEl.innerHTML = '';

    paisesValidos.forEach((pais) => {
      const esDestacado = (pais.cantidad || 0) >= maxCantidad * 0.5;
      const colorPunto = esDestacado ? 'bg-[#ff5722]' : 'bg-[#eab308]';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'w-full flex items-center justify-between text-left bg-white/5 hover:bg-blue-500/20 hover:border-blue-500 transition-all cursor-pointer p-3 rounded-lg border border-transparent';

      btn.innerHTML = `
        <span class="flex items-center gap-2.5 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full shrink-0 ${colorPunto}"></span>
          <span class="text-sm font-medium text-white truncate">${escaparHtml(pais.pais)}</span>
        </span>
        <span class="ml-3 shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-sky-300">
          ${Number(pais.cantidad || 0).toLocaleString('es-MX')}
        </span>
      `;

      btn.addEventListener('click', () => {
        // Resaltar el país seleccionado
        listaPaisesEl.querySelectorAll('button').forEach((b) => {
          b.classList.remove('bg-blue-500/20', 'border-blue-500');
          b.classList.add('border-transparent');
        });
        btn.classList.remove('border-transparent');
        btn.classList.add('bg-blue-500/20', 'border-blue-500');

        // Rotar la cámara del globo hacia las coordenadas del país
        if (world) {
          world.controls().autoRotate = false;
          world.pointOfView({ lat: pais.lat, lng: pais.lng, altitude: 1.2 }, 1500);
        }
      });

      listaPaisesEl.appendChild(btn);
    });
  }

  function actualizarGloboPaises(usuariosPorPais) {
    if (!world) return;

    const datosValidos = usuariosPorPais.filter(
      (p) => typeof p.lat === 'number' && typeof p.lng === 'number' && !Number.isNaN(p.lat) && !Number.isNaN(p.lng)
    );

    const maxCantidad = Math.max(...datosValidos.map((p) => p.cantidad || 0), 1);

    world
      .pointsData(datosValidos)
      .pointLat('lat')
      .pointLng('lng')
      .pointAltitude((d) => 0.08 + ((d.cantidad || 0) / maxCantidad) * 0.45)
      .pointRadius(1.15)
      .pointColor((d) => ((d.cantidad || 0) >= maxCantidad * 0.5 ? '#ff5722' : '#eab308'))
      .pointLabel(
        (d) => `
          <div style="background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(255, 87, 34, 0.55); border-radius: 10px; padding: 8px 12px; color: #f8fafc; font-family: sans-serif; font-size: 12px;">
            <strong style="color: #fb923c;">${escaparHtml(d.pais)}</strong><br/>
            Usuarios: <strong>${Number(d.cantidad || 0).toLocaleString('es-MX')}</strong>
          </div>
        `
      );
  }

  // ---------------------------------------------------------
  // ACTUALIZACIÓN DE KPIs
  // ---------------------------------------------------------
  function actualizarKPIsInteracciones() {
    const total = interacciones.length;
    kpiInteraccionesEl.textContent = total.toLocaleString('es-MX');

    if (total === 0) {
      kpiSentimientoEl.textContent = '0.00';
      kpiSentimientoBadgeEl.textContent = 'Sin datos';
      kpiSentimientoBadgeEl.className =
        'rounded-lg bg-white/10 border border-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-300';
      return;
    }

    const suma = interacciones.reduce((acc, item) => {
      const val = Number(item.sentimiento);
      return acc + (Number.isNaN(val) ? 0 : val);
    }, 0);
    const promedio = suma / total;

    kpiSentimientoEl.textContent = promedio > 0 ? `+${promedio.toFixed(2)}` : promedio.toFixed(2);

    if (promedio >= 0.2) {
      kpiSentimientoBadgeEl.textContent = 'Positivo';
      kpiSentimientoBadgeEl.className =
        'rounded-lg bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-1 text-[11px] font-medium text-emerald-300';
    } else if (promedio <= -0.2) {
      kpiSentimientoBadgeEl.textContent = 'Negativo';
      kpiSentimientoBadgeEl.className =
        'rounded-lg bg-rose-500/15 border border-rose-400/30 px-2.5 py-1 text-[11px] font-medium text-rose-300';
    } else {
      kpiSentimientoBadgeEl.textContent = 'Neutral';
      kpiSentimientoBadgeEl.className =
        'rounded-lg bg-amber-500/15 border border-amber-400/30 px-2.5 py-1 text-[11px] font-medium text-amber-300';
    }
  }

  // ---------------------------------------------------------
  // 3 INSTANCIAS DE CHART.JS (MODO OSCURO NEÓN)
  // ---------------------------------------------------------

  // 1. Gráfica de Barras Horizontales: Usuarios por País
  function renderGraficaPaises(usuariosPorPais) {
    const ctx = document.getElementById('chartPaises').getContext('2d');
    const labels = usuariosPorPais.map((item) => item.pais);
    const valores = usuariosPorPais.map((item) => item.cantidad ?? item.total ?? 0);

    if (chartPaises) {
      chartPaises.destroy();
    }

    chartPaises = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Usuarios',
            data: valores,
            backgroundColor: labels.map((_, i) => `${PALETA_NEON[i % PALETA_NEON.length]}cc`),
            hoverBackgroundColor: labels.map((_, i) => PALETA_NEON[i % PALETA_NEON.length]),
            borderColor: labels.map((_, i) => PALETA_NEON[i % PALETA_NEON.length]),
            borderWidth: 1,
            borderRadius: 8,
            barPercentage: 0.72,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(56, 189, 248, 0.5)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed.x ?? 0).toLocaleString('es-MX');
                return ` Usuarios: ${valor}`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#ffffff', precision: 0 },
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            border: { display: false },
          },
          y: {
            ticks: { color: '#ffffff' },
            grid: { display: false },
            border: { display: false },
          },
        },
      },
    });
  }

  // 2. Gráfica de Línea Curva (Tensión 0.4): Tendencia Temporal del Sentimiento
  function renderGraficaSentimiento() {
    // Tomar las últimas 20 y ordenar cronológicamente de izquierda (antigua) a derecha (reciente)
    const serie = [...interacciones.slice(0, MAX_FILAS_TABLA)].reverse();
    const labels = serie.map((item, idx) => formatearHoraCorta(item.timestamp) || `#${idx + 1}`);
    const valores = serie.map((item) => {
      const n = Number(item.sentimiento);
      return Number.isNaN(n) ? 0 : Number(n.toFixed(2));
    });

    if (chartSentimiento) {
      chartSentimiento.data.labels = labels;
      chartSentimiento.data.datasets[0].data = valores;
      chartSentimiento.update();
      return;
    }

    const canvas = document.getElementById('chartSentimiento');
    const ctx = canvas.getContext('2d');
    const gradiente = ctx.createLinearGradient(0, 0, 0, 280);
    gradiente.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
    gradiente.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    chartSentimiento = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Sentimiento',
            data: valores,
            tension: 0.4,
            fill: true,
            backgroundColor: gradiente,
            borderColor: '#38bdf8',
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#34d399',
            pointBorderColor: '#0f172a',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(56, 189, 248, 0.5)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const val = Number(context.parsed.y ?? 0);
                const signo = val > 0 ? '+' : '';
                return ` Sentimiento: ${signo}${val.toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#ffffff', maxTicksLimit: 8 },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            min: -1,
            max: 1,
            ticks: { color: '#ffffff', stepSize: 0.5 },
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            border: { display: false },
          },
        },
      },
    });
  }

  // 3. Gráfica de Dona con borde oscuro: Interacciones por Canal
  function renderGraficaCanales() {
    const entradas = Object.entries(conteoCanales)
      .filter(([, cantidad]) => cantidad > 0)
      .sort((a, b) => b[1] - a[1]);

    const labels = entradas.map(([canal]) => canal);
    const valores = entradas.map(([, cantidad]) => cantidad);

    if (chartCanales) {
      chartCanales.data.labels = labels;
      chartCanales.data.datasets[0].data = valores;
      chartCanales.data.datasets[0].backgroundColor = labels.map(
        (_, i) => PALETA_NEON[i % PALETA_NEON.length]
      );
      chartCanales.update();
      return;
    }

    const ctx = document.getElementById('chartCanales').getContext('2d');
    chartCanales = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: valores,
            backgroundColor: labels.map((_, i) => PALETA_NEON[i % PALETA_NEON.length]),
            borderColor: '#0f172a',
            borderWidth: 3,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#ffffff',
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(168, 85, 247, 0.5)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed ?? 0);
                const total = context.dataset.data.reduce((a, b) => a + Number(b || 0), 0);
                const pct = total > 0 ? ((valor / total) * 100).toFixed(1) : '0.0';
                return ` ${context.label}: ${valor.toLocaleString('es-MX')} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ---------------------------------------------------------
  // TABLA MINIMALISTA DE INTERACCIONES (SOLO LECTURA)
  // ---------------------------------------------------------
  function crearFilaHtml(item, esNueva = false) {
    const id = obtenerIdInteraccion(item);
    const clasesAnimacion = esNueva
      ? 'bg-green-500/20 animate-pulse transition-colors duration-700 hover:bg-white/10'
      : 'transition-colors duration-200 hover:bg-white/10';

    const textoSeguro = item.texto
      ? escaparHtml(item.texto)
      : '<span class="italic text-slate-500">(Sin texto)</span>';

    return `
      <tr data-id="${escaparHtml(id)}" class="${clasesAnimacion}">
        <td class="py-3.5 px-6 whitespace-nowrap text-xs text-slate-200">
          <div>${escaparHtml(formatearFecha(item.timestamp))}</div>
          <div class="text-[11px] text-slate-400 font-mono mt-0.5">${escaparHtml(id)}</div>
        </td>
        <td class="py-3.5 px-6 whitespace-nowrap font-mono text-xs text-sky-300 font-medium">
          ${escaparHtml(item.id_usuario || '-')}
        </td>
        <td class="py-3.5 px-6 whitespace-nowrap">
          <span class="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-100">
            ${escaparHtml(item.canal || 'N/A')}
          </span>
        </td>
        <td class="py-3.5 px-6 text-slate-200 max-w-md">
          <p class="line-clamp-2 leading-relaxed">${textoSeguro}</p>
        </td>
        <td class="py-3.5 px-6 whitespace-nowrap text-right">
          ${badgeSentimiento(item.sentimiento)}
        </td>
      </tr>
    `;
  }

  function actualizarContadorTabla() {
    const visibles = Math.min(interacciones.length, MAX_FILAS_TABLA);
    tablaContadorEl.textContent = `${visibles} de ${interacciones.length} registros mostrados`;
  }

  function renderTablaInteracciones() {
    const recientes = interacciones.slice(0, MAX_FILAS_TABLA);
    actualizarContadorTabla();

    if (recientes.length === 0) {
      tablaBodyEl.innerHTML = `
        <tr data-placeholder="true">
          <td colspan="5" class="py-10 px-6 text-center text-slate-400">
            No hay interacciones registradas por el momento.
          </td>
        </tr>
      `;
      return;
    }

    tablaBodyEl.innerHTML = recientes.map((item) => crearFilaHtml(item, false)).join('');
  }

  // ---------------------------------------------------------
  // CARGA INICIAL DE DATOS DESDE LA API REST
  // ---------------------------------------------------------
  async function fetchProtegido(url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      cerrarSesion();
      throw new Error('Sesión expirada');
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Error HTTP ${res.status} al consultar ${url}`);
    }

    return res.json();
  }

  async function cargarDashboard() {
    inicializarGlobo();

    try {
      const [statsData, interaccionesData] = await Promise.all([
        fetchProtegido('/api/stats'),
        fetchProtegido('/api/interacciones'),
      ]);

      // 1. KPI Total Usuarios, Gráfica Horizontal y Globo 3D (Turso)
      const totalUsuarios = Number(statsData.total_usuarios ?? 0);
      kpiUsuariosEl.textContent = totalUsuarios.toLocaleString('es-MX');

      const paises = Array.isArray(statsData.usuarios_por_pais) ? statsData.usuarios_por_pais : [];
      renderGraficaPaises(paises);
      actualizarGloboPaises(paises);
      renderListaPaises(paises);

      // 2. Interacciones (Firestore)
      interacciones = Array.isArray(interaccionesData.interacciones)
        ? interaccionesData.interacciones
        : [];

      // 3. Conteo de canales (desde /api/stats.por_canal o calculado como respaldo)
      conteoCanales = {};
      if (Array.isArray(statsData.por_canal) && statsData.por_canal.length > 0) {
        for (const item of statsData.por_canal) {
          const nombreCanal = item.canal || 'Sin canal';
          conteoCanales[nombreCanal] = Number(item.cantidad ?? 0);
        }
      } else {
        for (const item of interacciones) {
          const nombreCanal = item.canal || 'Sin canal';
          conteoCanales[nombreCanal] = (conteoCanales[nombreCanal] || 0) + 1;
        }
      }

      actualizarKPIsInteracciones();
      renderGraficaSentimiento();
      renderGraficaCanales();
      renderTablaInteracciones();

      // Alimentar Horarios Pico, Toxicidad por Canal y Actividad Reciente directamente con /api/interacciones
      procesarMetricasDesdeInteracciones();
    } catch (error) {
      if (error.message !== 'Sesión expirada') {
        console.error('Error al cargar el dashboard:', error);
        mostrarError(`No se pudieron cargar los datos del dashboard: ${error.message}`);
      }
    }
  }

  function calcularHorariosPicoLocal(lista) {
    const conteoHoras = Array.from({ length: 24 }, (_, hora) => ({
      hora,
      etiqueta: `${String(hora).padStart(2, '0')}:00`,
      cantidad: 0,
    }));

    for (const item of lista) {
      if (!item?.timestamp) continue;
      const fecha = new Date(item.timestamp);
      if (!Number.isNaN(fecha.getTime())) {
        conteoHoras[fecha.getHours()].cantidad++;
      }
    }

    return conteoHoras;
  }

  function procesarMetricasDesdeInteracciones() {
    // 1. Horarios Pico desde timestamps de Firestore
    const horariosPico = calcularHorariosPicoLocal(interacciones);
    renderGraficaHorariosPico(horariosPico);

    // 2. Toxicidad por Canal (sentimiento < 0 agrupado por canal)
    conteoToxicidadCanal = {};
    for (const item of interacciones) {
      const sent = Number(item.sentimiento);
      if (!Number.isNaN(sent) && sent < 0) {
        const canal = item.canal || 'Sin canal';
        conteoToxicidadCanal[canal] = (conteoToxicidadCanal[canal] || 0) + 1;
      }
    }
    renderGraficaToxicidadCanal();

    // 3. Actividad Reciente (últimos 5 usuarios y su canal)
    renderActividadReciente(interacciones.slice(0, 5));
  }

  // ---------------------------------------------------------
  // ANÁLISIS DE COMUNIDAD Y RETENCIÓN (TAB 2)
  // ---------------------------------------------------------
  function renderGraficaRetencion(porEstatus) {
    const canvas = document.getElementById('chartRetencion');
    if (!canvas) return;

    const datos =
      Array.isArray(porEstatus) && porEstatus.length > 0
        ? porEstatus
        : [{ estatus: 'Sin datos', cantidad: 0 }];

    const etiquetasMap = {
      activo: 'Activos',
      en_riesgo: 'En Riesgo',
      inactivo: 'Inactivos',
      suspendido: 'Suspendidos',
    };

    const coloresMap = {
      activo: '#34d399',     // verde neón
      en_riesgo: '#fb923c',  // naranja neón
      inactivo: '#f43f5e',   // rojo/rosa neón
      suspendido: '#ef4444', // rojo intenso
    };

    const labels = datos.map((item) => {
      const clave = String(item.estatus || '').toLowerCase();
      return etiquetasMap[clave] || item.estatus || 'Desconocido';
    });
    const valores = datos.map((item) => Number(item.cantidad ?? 0));
    const colores = datos.map((item, idx) => {
      const clave = String(item.estatus || '').toLowerCase();
      return coloresMap[clave] || PALETA_NEON[idx % PALETA_NEON.length];
    });

    if (chartRetencion) {
      chartRetencion.destroy();
    }

    chartRetencion = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: valores,
            backgroundColor: colores,
            borderColor: '#0f172a',
            borderWidth: 3,
            hoverOffset: 10,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#ffffff',
              padding: 18,
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(251, 146, 60, 0.5)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed ?? 0);
                const total = context.dataset.data.reduce((a, b) => a + Number(b || 0), 0);
                const pct = total > 0 ? ((valor / total) * 100).toFixed(1) : '0.0';
                return ` ${context.label}: ${valor.toLocaleString('es-MX')} usuarios (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  function renderGraficaEconomiaEventos(eventosAsistidos, comisionesCompradas) {
    const canvas = document.getElementById('chartEconomiaEventos');
    if (!canvas) return;

    if (chartEconomiaEventos) {
      chartEconomiaEventos.destroy();
    }

    chartEconomiaEventos = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Eventos Asistidos', 'Comisiones Compradas'],
        datasets: [
          {
            label: 'Total',
            data: [eventosAsistidos, comisionesCompradas],
            backgroundColor: ['rgba(56, 189, 248, 0.8)', 'rgba(245, 158, 11, 0.85)'],
            hoverBackgroundColor: ['#38bdf8', '#f59e0b'],
            borderColor: ['#38bdf8', '#fbbf24'],
            borderWidth: 1.5,
            borderRadius: 10,
            maxBarThickness: 90,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(56, 189, 248, 0.5)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed.y ?? 0).toLocaleString('es-MX');
                return ` Total: ${valor}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#ffffff' },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#ffffff', precision: 0 },
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            border: { display: false },
          },
        },
      },
    });
  }

  function renderActividadReciente(ultimas) {
    if (!topContribuidoresListaEl) return;

    if (!Array.isArray(ultimas) || ultimas.length === 0) {
      topContribuidoresListaEl.innerHTML =
        '<p class="text-xs text-slate-400 text-center py-8">Sin actividad reciente.</p>';
      return;
    }

    topContribuidoresListaEl.innerHTML = ultimas
      .map((item, idx) => {
        const usuario = item.id_usuario || 'Usuario';
        const canal = item.canal || 'Sin canal';
        const hora = formatearFecha(item.timestamp);
        return `
          <div class="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition px-4 py-3">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-8 h-8 rounded-lg border border-sky-400/30 bg-sky-500/15 text-sky-300 flex items-center justify-center text-xs font-bold shrink-0">
                #${idx + 1}
              </span>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-white font-mono truncate">${escaparHtml(usuario)}</p>
                <p class="text-[11px] text-slate-400 truncate">${escaparHtml(hora)}</p>
              </div>
            </div>
            <span class="shrink-0 rounded-lg bg-white/10 border border-white/15 px-3 py-1 text-xs font-semibold text-sky-200">
              ${escaparHtml(canal)}
            </span>
          </div>
        `;
      })
      .join('');
  }

  function renderGraficaHorariosPico(horariosPico) {
    const canvas = document.getElementById('chartHorariosPico');
    if (!canvas) return;

    const baseHoras =
      Array.isArray(horariosPico) && horariosPico.length > 0
        ? horariosPico
        : Array.from({ length: 24 }, (_, hora) => ({
            hora,
            etiqueta: `${String(hora).padStart(2, '0')}:00`,
            cantidad: 0,
          }));

    const labels = baseHoras.map((h) => h.etiqueta ?? `${String(h.hora).padStart(2, '0')}:00`);
    const valores = baseHoras.map((h) => Number(h.cantidad ?? 0));

    if (chartHorariosPico) {
      chartHorariosPico.destroy();
    }

    const ctx = canvas.getContext('2d');
    const gradiente = ctx.createLinearGradient(0, 0, 0, 280);
    gradiente.addColorStop(0, 'rgba(168, 85, 247, 0.42)');
    gradiente.addColorStop(0.6, 'rgba(56, 189, 248, 0.18)');
    gradiente.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    chartHorariosPico = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Mensajes',
            data: valores,
            tension: 0.4,
            fill: true,
            backgroundColor: gradiente,
            borderColor: '#a855f7',
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#38bdf8',
            pointBorderColor: '#0f172a',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(168, 85, 247, 0.5)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed.y ?? 0).toLocaleString('es-MX');
                return ` Mensajes: ${valor}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#ffffff', maxTicksLimit: 12 },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#ffffff', precision: 0 },
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            border: { display: false },
          },
        },
      },
    });
  }

  async function cargarAnalisis() {
    try {
      const data = await fetchProtegido('/api/analisis');
      console.log('[API] /api/analisis:', data);

      const totalArtistas = Number(data.total_artistas ?? 0);
      const totalEventos = Number(data.totales?.eventos_asistidos ?? 0);
      const totalComisiones = Number(data.totales?.comisiones_compradas ?? 0);
      const porEstatus = Array.isArray(data.por_estatus) ? data.por_estatus : [];

      if (kpiArtistasEl) kpiArtistasEl.textContent = totalArtistas.toLocaleString('es-MX');
      if (kpiEventosEl) kpiEventosEl.textContent = totalEventos.toLocaleString('es-MX');
      if (kpiComisionesEl) kpiComisionesEl.textContent = totalComisiones.toLocaleString('es-MX');

      renderGraficaRetencion(porEstatus);
      renderGraficaEconomiaEventos(totalEventos, totalComisiones);
      analisisCargado = true;
    } catch (error) {
      if (error.message !== 'Sesión expirada') {
        console.error('Error al cargar el análisis de comunidad:', error);
        if (kpiArtistasEl) kpiArtistasEl.textContent = '0';
        if (kpiEventosEl) kpiEventosEl.textContent = '0';
        if (kpiComisionesEl) kpiComisionesEl.textContent = '0';
      }
    }
  }

  // ---------------------------------------------------------
  // MODERACIÓN Y TENDENCIAS (TAB 3)
  // ---------------------------------------------------------
  function renderGraficaRadarTemas(tendencias) {
    const canvas = document.getElementById('chartRadarTemas');
    if (!canvas) return;

    const datos =
      Array.isArray(tendencias) && tendencias.length > 0
        ? tendencias
        : [{ etiqueta: 'Sin etiquetas', cantidad: 0 }];

    const labels = datos.map((t) => t.etiqueta);
    const valores = datos.map((t) => Number(t.cantidad ?? 0));

    if (chartRadarTemas) {
      chartRadarTemas.destroy();
    }

    chartRadarTemas = new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            label: 'Menciones',
            data: valores,
            backgroundColor: 'rgba(244, 114, 182, 0.25)',
            borderColor: '#f472b6',
            borderWidth: 2.5,
            pointBackgroundColor: '#38bdf8',
            pointBorderColor: '#0f172a',
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(244, 114, 182, 0.5)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed.r ?? 0).toLocaleString('es-MX');
                return ` Menciones: ${valor}`;
              },
            },
          },
        },
        scales: {
          r: {
            beginAtZero: true,
            angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            pointLabels: {
              color: '#ffffff',
              font: { size: 12, weight: '600' },
            },
            ticks: {
              color: '#cbd5e1',
              backdropColor: 'transparent',
              precision: 0,
            },
          },
        },
      },
    });
  }

  function actualizarContadorAlertas() {
    if (alertasContadorEl) {
      alertasContadorEl.textContent = alertas.length.toLocaleString('es-MX');
    }
  }

  function crearFilaAlertaHtml(item, esNueva = false) {
    const id = obtenerIdInteraccion(item);
    const clasesFila = esNueva
      ? 'bg-rose-500/25 animate-pulse transition-colors duration-700 hover:bg-white/10'
      : 'transition-colors duration-200 hover:bg-white/10';

    const textoSeguro = item.texto
      ? escaparHtml(item.texto)
      : '<span class="italic text-slate-500">(Sin texto)</span>';

    return `
      <tr data-alerta-id="${escaparHtml(id)}" class="${clasesFila}">
        <td class="py-3.5 px-6 whitespace-nowrap text-xs text-slate-200">
          <div>${escaparHtml(formatearFecha(item.timestamp))}</div>
          <div class="text-[11px] text-slate-400 font-mono mt-0.5">${escaparHtml(id)}</div>
        </td>
        <td class="py-3.5 px-6 whitespace-nowrap font-mono text-xs text-rose-300 font-medium">
          ${escaparHtml(item.id_usuario || '-')}
        </td>
        <td class="py-3.5 px-6 text-slate-200 max-w-xl">
          <p class="leading-relaxed">${textoSeguro}</p>
        </td>
        <td class="py-3.5 px-6 whitespace-nowrap text-right">
          ${badgeSentimiento(item.sentimiento)}
        </td>
        <td class="py-3.5 px-6 whitespace-nowrap text-right">
          <button
            type="button"
            data-delete-id="${escaparHtml(id)}"
            class="btn-eliminar-alerta rounded-lg border border-rose-500/50 bg-rose-500/15 hover:bg-rose-500/30 hover:shadow-[0_0_12px_rgba(244,63,94,0.4)] px-3 py-1.5 text-xs font-semibold text-rose-200 transition cursor-pointer disabled:opacity-50"
          >
            Eliminar
          </button>
        </td>
      </tr>
    `;
  }

  function renderTablaAlertas() {
    if (!tablaAlertasBodyEl) return;
    actualizarContadorAlertas();

    if (alertas.length === 0) {
      tablaAlertasBodyEl.innerHTML = `
        <tr data-alerta-placeholder="true">
          <td colspan="5" class="py-10 px-4 text-center text-slate-400">
            No hay alertas de sentimiento negativo.
          </td>
        </tr>
      `;
      return;
    }

    tablaAlertasBodyEl.innerHTML = alertas.map((item) => crearFilaAlertaHtml(item, false)).join('');
  }

  // Delegación de eventos para el botón rojo "Eliminar" en la tabla de alertas
  if (tablaAlertasBodyEl) {
    tablaAlertasBodyEl.addEventListener('click', async (event) => {
      const btn = event.target.closest('.btn-eliminar-alerta');
      if (!btn) return;

      const id = btn.dataset.deleteId;
      if (!id) return;

      btn.disabled = true;
      btn.textContent = 'Eliminando...';

      try {
        const res = await fetch(`/api/interacciones/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.status === 401) {
          cerrarSesion();
          return;
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Error HTTP ${res.status}`);
        }
      } catch (error) {
        console.error('Error al eliminar alerta:', error);
        mostrarToast(`No se pudo eliminar (${id}): ${error.message}`, 'danger');
        btn.disabled = false;
        btn.textContent = 'Eliminar';
      }
    });
  }

  function renderGraficaToxicidadCanal() {
    const canvas = document.getElementById('chartToxicidadCanal');
    if (!canvas) return;

    const entradas = Object.entries(conteoToxicidadCanal)
      .filter(([, cantidad]) => cantidad > 0)
      .sort((a, b) => b[1] - a[1]);

    const labels = entradas.length > 0 ? entradas.map(([canal]) => canal) : ['Sin alertas'];
    const valores = entradas.length > 0 ? entradas.map(([, cantidad]) => cantidad) : [0];

    if (chartToxicidadCanal) {
      chartToxicidadCanal.data.labels = labels;
      chartToxicidadCanal.data.datasets[0].data = valores;
      chartToxicidadCanal.update();
      return;
    }

    chartToxicidadCanal = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Mensajes negativos',
            data: valores,
            backgroundColor: 'rgba(244, 63, 94, 0.78)',
            hoverBackgroundColor: '#fb7185',
            borderColor: '#f43f5e',
            borderWidth: 1.5,
            borderRadius: 8,
            barPercentage: 0.7,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            borderColor: 'rgba(244, 63, 94, 0.55)',
            borderWidth: 1,
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label: (context) => {
                const valor = Number(context.parsed.x ?? 0).toLocaleString('es-MX');
                return ` Negativos: ${valor}`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#ffffff', precision: 0 },
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            border: { display: false },
          },
          y: {
            ticks: { color: '#ffffff' },
            grid: { display: false },
            border: { display: false },
          },
        },
      },
    });
  }

  async function cargarModeracion() {
    try {
      const data = await fetchProtegido('/api/moderacion');
      console.log('[API] /api/moderacion:', data);

      const tendencias = Array.isArray(data.tendencias) ? data.tendencias : [];
      alertas = Array.isArray(data.alertas) ? data.alertas : [];

      // Si el backend trajo el histórico completo de toxicidad por canal, usarlo; si no, mantener el calculado de /api/interacciones
      if (Array.isArray(data.toxicidad_por_canal) && data.toxicidad_por_canal.length > 0) {
        conteoToxicidadCanal = {};
        for (const item of data.toxicidad_por_canal) {
          conteoToxicidadCanal[item.canal || 'Sin canal'] = Number(item.cantidad ?? 0);
        }
        renderGraficaToxicidadCanal();
      } else if (alertas.length > 0 && Object.keys(conteoToxicidadCanal).length === 0) {
        for (const item of alertas) {
          const canal = item.canal || 'Sin canal';
          conteoToxicidadCanal[canal] = (conteoToxicidadCanal[canal] || 0) + 1;
        }
        renderGraficaToxicidadCanal();
      }

      renderGraficaRadarTemas(tendencias);
      renderTablaAlertas();
      moderacionCargada = true;
    } catch (error) {
      if (error.message !== 'Sesión expirada') {
        console.error('Error al cargar moderación:', error);
        // Respaldo total desde /api/interacciones si el endpoint no respondió
        const conteoTags = {};
        alertas = [];
        for (const item of interacciones) {
          if (Array.isArray(item.etiquetas)) {
            for (const t of item.etiquetas) {
              const tag = String(t || '').trim().toLowerCase();
              if (tag) conteoTags[tag] = (conteoTags[tag] || 0) + 1;
            }
          }
          if (Number(item.sentimiento) < 0) alertas.push(item);
        }
        const top5 = Object.entries(conteoTags)
          .map(([etiqueta, cantidad]) => ({ etiqueta, cantidad }))
          .sort((a, b) => b.cantidad - a.cantidad)
          .slice(0, 5);

        renderGraficaRadarTemas(top5);
        renderTablaAlertas();
      }
    }
  }

  // ---------------------------------------------------------
  // WEBSOCKETS EN TIEMPO REAL (SOCKET.IO)
  // ---------------------------------------------------------
  const socket = io();

  socket.on('connect', () => {
    wsDotEl.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.95)]';
    wsTextEl.textContent = 'En vivo';
  });

  socket.on('disconnect', () => {
    wsDotEl.className = 'w-2 h-2 rounded-full bg-rose-400 animate-pulse';
    wsTextEl.textContent = 'Desconectado';
  });

  socket.on('nueva_interaccion', (nueva) => {
    if (!nueva) return;
    const nuevoId = obtenerIdInteraccion(nueva);

    // Evitar duplicados si ya existía en memoria
    const yaExistia = interacciones.some((item) => obtenerIdInteraccion(item) === nuevoId);
    if (!yaExistia) {
      interacciones.unshift(nueva);
      const canal = nueva.canal || 'Sin canal';
      conteoCanales[canal] = (conteoCanales[canal] || 0) + 1;
    }

    // 1. Actualizar KPIs, gráficas (Dona + Sentimiento + Horarios Pico + Actividad Reciente)
    actualizarKPIsInteracciones();
    renderGraficaCanales();
    renderGraficaSentimiento();
    renderGraficaHorariosPico(calcularHorariosPicoLocal(interacciones));
    renderActividadReciente(interacciones.slice(0, 5));
    actualizarContadorTabla();

    // 2. Insertar la nueva fila con insertAdjacentHTML y parpadeo temporal
    const placeholder = tablaBodyEl.querySelector('tr[data-placeholder="true"]');
    if (placeholder) placeholder.remove();

    const filaDuplicada = tablaBodyEl.querySelector(`tr[data-id="${CSS.escape(nuevoId)}"]`);
    if (filaDuplicada) filaDuplicada.remove();

    tablaBodyEl.insertAdjacentHTML('afterbegin', crearFilaHtml(nueva, true));

    // Quitar el efecto de parpadeo verde después de 2.5 segundos
    const nuevaFilaEl = tablaBodyEl.firstElementChild;
    if (nuevaFilaEl) {
      setTimeout(() => {
        nuevaFilaEl.classList.remove('bg-green-500/20', 'animate-pulse');
      }, 2500);
    }

    // Mantener el límite visual de filas en la tabla
    while (tablaBodyEl.children.length > MAX_FILAS_TABLA) {
      tablaBodyEl.lastElementChild.remove();
    }

    // 3. Destello infalible en la Tierra 3D (usa coordenadas reales o aleatorias sobre América)
    console.log('[WebSocket] nueva_interaccion recibida:', nueva);
    if (world) {
      const lat =
        nueva.latitud != null && !Number.isNaN(Number(nueva.latitud))
          ? Number(nueva.latitud)
          : Math.random() * 60 - 30;
      const lng =
        nueva.longitud != null && !Number.isNaN(Number(nueva.longitud))
          ? Number(nueva.longitud)
          : Math.random() * 80 - 100;

      const currentRings = world.ringsData() || [];
      const newRing = { lat, lng };
      world.ringsData([...currentRings, newRing]);

      setTimeout(() => {
        if (!world) return;
        world.ringsData((world.ringsData() || []).filter((r) => r !== newRing));
      }, 2000);
    }

    // 4. Si el sentimiento es negativo (< 0), inyectar alerta en tiempo real en Moderación
    const sentimientoVal = Number(nueva.sentimiento);
    if (!Number.isNaN(sentimientoVal) && sentimientoVal < 0) {
      const alertaExistia = alertas.some((item) => obtenerIdInteraccion(item) === nuevoId);
      if (!alertaExistia) {
        alertas.unshift(nueva);
        const canalNeg = nueva.canal || 'Sin canal';
        conteoToxicidadCanal[canalNeg] = (conteoToxicidadCanal[canalNeg] || 0) + 1;
        renderGraficaToxicidadCanal();
      }
      actualizarContadorAlertas();

      if (tablaAlertasBodyEl) {
        const placeholderAlerta = tablaAlertasBodyEl.querySelector('tr[data-alerta-placeholder="true"]');
        if (placeholderAlerta) placeholderAlerta.remove();

        const filaAlertaDuplicada = tablaAlertasBodyEl.querySelector(
          `tr[data-alerta-id="${CSS.escape(nuevoId)}"]`
        );
        if (filaAlertaDuplicada) filaAlertaDuplicada.remove();

        tablaAlertasBodyEl.insertAdjacentHTML('afterbegin', crearFilaAlertaHtml(nueva, true));

        const nuevaAlertaEl = tablaAlertasBodyEl.firstElementChild;
        if (nuevaAlertaEl) {
          setTimeout(() => {
            nuevaAlertaEl.classList.remove('bg-rose-500/25', 'animate-pulse');
          }, 3000);
        }
      }

      mostrarToast(`Alerta negativa (${nuevoId}): sentimiento ${sentimientoVal.toFixed(2)}`, 'danger');
    } else {
      mostrarToast(`Nueva interacción (${nuevoId}) en ${nueva.canal || 'canal'}`, 'success');
    }
  });

  socket.on('interaccion_eliminada', (payload) => {
    const idEliminado = payload?.id_interaccion || payload?.id;
    if (!idEliminado) return;

    const eliminada = interacciones.find((item) => obtenerIdInteraccion(item) === idEliminado);
    if (eliminada) {
      const canal = eliminada.canal || 'Sin canal';
      if (conteoCanales[canal] > 0) {
        conteoCanales[canal]--;
      }
      interacciones = interacciones.filter((item) => obtenerIdInteraccion(item) !== idEliminado);
    }

    // Eliminar también de la tabla de alertas usando .remove() en el DOM
    const alertaEliminada = alertas.find((item) => obtenerIdInteraccion(item) === idEliminado);
    if (alertaEliminada) {
      const canalNeg = alertaEliminada.canal || 'Sin canal';
      if (conteoToxicidadCanal[canalNeg] > 0) {
        conteoToxicidadCanal[canalNeg]--;
      }
      if (moderacionCargada) {
        renderGraficaToxicidadCanal();
      }
    }
    alertas = alertas.filter((item) => obtenerIdInteraccion(item) !== idEliminado);
    actualizarContadorAlertas();

    if (tablaAlertasBodyEl) {
      const filaAlerta = tablaAlertasBodyEl.querySelector(
        `tr[data-alerta-id="${CSS.escape(idEliminado)}"]`
      );
      if (filaAlerta) {
        filaAlerta.remove();
      }
      if (tablaAlertasBodyEl.children.length === 0) {
        renderTablaAlertas();
      }
    }

    // Quitar la fila de la tabla general y recalcular gráficas
    renderTablaInteracciones();
    actualizarKPIsInteracciones();
    renderGraficaCanales();
    renderGraficaSentimiento();
    renderGraficaHorariosPico(calcularHorariosPicoLocal(interacciones));
    renderActividadReciente(interacciones.slice(0, 5));
    renderGraficaToxicidadCanal();

    mostrarToast(`Interacción eliminada (${idEliminado})`, 'danger');
  });

  // Cargar las 3 vistas con sus datos históricos acumulados al iniciar el dashboard
  Promise.allSettled([cargarDashboard(), cargarAnalisis(), cargarModeracion()]);
})();
