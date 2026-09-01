// Carga el catalogo de procedimientos desde la API para que la landing
// siempre muestre lo que hay realmente configurado en el modulo admin
// (los cambios en el catalogo se reflejan de inmediato).
const ICONOS_PROCEDIMIENTO = {
  "Plan de tratamiento":
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><path d="M8 16l2 2 4-4"/></svg>',
  "Brackets fijos":
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14c2-7 14-7 16 0"/><circle cx="6.5" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="11.6" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="18" cy="12.8" r="1.2" fill="currentColor" stroke="none"/></svg>',
  "Alineadores transparentes":
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9c2-3 14-3 16 0v3c-2 3-14 3-16 0z"/></svg>',
  "Ortopedia dentofacial":
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4c-2 4-2 12 0 16"/><path d="M18 4c2 4 2 12 0 16"/><path d="M9 12h6"/></svg>',
  "Retiro de aparatos":
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 0 5 2.5 5 6 0 3-2 4-2 7 0 2-1 4-3 4s-3-2-3-4c0-3-2-4-2-7 0-3.5 2-6 5-6z"/><path d="M12 13v6M9 17l3 3 3-3"/></svg>',
};
const ICONO_DEFAULT =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

async function cargarServicios() {
  const contenedor = document.getElementById("serviciosGrid");
  try {
    const procedimientos = await Api.get("/api/procedimientos?activos=true");
    contenedor.innerHTML = "";

    procedimientos.forEach((p, i) => {
      const card = document.createElement("div");
      card.className = "service-card reveal";
      card.style.transitionDelay = `${Math.min(i, 5) * 60}ms`;
      card.innerHTML = `
        <div class="icon-badge">${ICONOS_PROCEDIMIENTO[p.nombre] || ICONO_DEFAULT}</div>
        <h3>${p.nombre}</h3>
        <p>${p.descripcion || ""}</p>
        <button class="link" type="button">Agendar valoración →</button>
      `;
      card.querySelector(".link").onclick = () => ChatWidget.open();
      contenedor.appendChild(card);
    });

    const cta = document.createElement("div");
    cta.className = "service-card reveal";
    cta.style.transitionDelay = `${Math.min(procedimientos.length, 5) * 60}ms`;
    cta.style.cssText +=
      "display:flex;flex-direction:column;justify-content:center;background:linear-gradient(150deg,var(--gold-light),var(--gold) 55%,var(--gold-dark));color:var(--cream);";
    cta.innerHTML = `
      <h3 style="color:var(--cream);">¿No sabes cuál necesitas?</h3>
      <p style="color:#F8EFDC;">Cuéntale al asistente qué te preocupa y te orienta.</p>
      <button class="btn btn-primary" style="background:var(--cream);color:var(--gold-dark);align-self:flex-start;box-shadow:0 8px 18px rgba(0,0,0,.18);" type="button">Hablar con el asistente</button>
    `;
    cta.querySelector("button").onclick = () => ChatWidget.open();
    contenedor.appendChild(cta);
    activarRevelado();
  } catch (err) {
    contenedor.innerHTML = '<div class="empty-state">No pudimos cargar los servicios en este momento.</div>';
    console.error(err);
  }
}

// Anima secciones/tarjetas al entrar en el viewport (sensacion mas premium
// que aparecer todo de golpe).
function activarRevelado() {
  const elementos = document.querySelectorAll(".reveal:not(.in)");
  if (!("IntersectionObserver" in window)) {
    elementos.forEach((el) => el.classList.add("in"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  elementos.forEach((el) => observer.observe(el));
}

// Sombra en el header + barra dorada de progreso de lectura al hacer scroll.
function activarNavScroll() {
  const nav = document.querySelector("header.nav");
  const barra = document.getElementById("scrollProgressBar");
  const onScroll = () => {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
    if (barra) {
      const alto = document.documentElement.scrollHeight - window.innerHeight;
      const porcentaje = alto > 0 ? (window.scrollY / alto) * 100 : 0;
      barra.style.width = `${Math.min(porcentaje, 100)}%`;
    }
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

// Cuenta de 0 al numero real cuando la cifra entra en pantalla (sigue
// siendo una interfaz simple, solo le da vida a los datos de la Dra. Lyda).
function activarContadores() {
  const contadores = document.querySelectorAll(".counter");
  if (!contadores.length) return;

  const animar = (el) => {
    const meta = Number(el.dataset.count || 0);
    const prefijo = el.dataset.prefix || "";
    const sufijo = el.dataset.suffix || "";
    const duracion = 1200;
    const inicio = performance.now();

    function paso(ahora) {
      const progreso = Math.min((ahora - inicio) / duracion, 1);
      const facilitado = 1 - Math.pow(1 - progreso, 3); // ease-out cubic
      const valor = Math.round(meta * facilitado);
      el.textContent = `${prefijo}${valor}${sufijo}`;
      if (progreso < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
  };

  if (!("IntersectionObserver" in window)) {
    contadores.forEach(animar);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animar(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );
  contadores.forEach((el) => observer.observe(el));
}

// Pequeño aviso ("1") sobre el boton flotante para invitar a abrir el chat,
// que desaparece apenas el paciente lo abre.
function activarAvisoFab() {
  const dot = document.getElementById("fabDot");
  if (!dot) return;
  const timer = setTimeout(() => dot.classList.add("show"), 4000);
  const original = ChatWidget.open;
  ChatWidget.open = function (...args) {
    clearTimeout(timer);
    dot.classList.remove("show");
    return original.apply(ChatWidget, args);
  };
}

document.addEventListener("DOMContentLoaded", () => {
  cargarServicios();
  activarRevelado();
  activarNavScroll();
  activarContadores();
  activarAvisoFab();
});
