// Widget de chat de la landing publica. Todo el "cerebro" (NLP, disponibilidad,
// creacion de citas) vive en el backend (/api/chatbot/*); este script solo
// pinta la conversacion con un ritmo natural (indicador de "escribiendo...",
// mensajes escalonados) y reenvia lo que el paciente escribe o hace clic.
const ChatWidget = (function () {
  let conversacionId = null;
  let bodyEl, overlayEl, inputEl, sendBtnEl;
  let enviando = false;

  function iconosOverlay() {
    overlayEl = document.getElementById("modalOverlay");
    bodyEl = document.getElementById("phoneBody");
    inputEl = document.getElementById("chatInput");
    sendBtnEl = document.getElementById("sendBtn");
  }

  function scrollDown() {
    requestAnimationFrame(() => {
      bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: "smooth" });
    });
  }

  function horaActual() {
    return new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  }

  function pintarBot(texto) {
    const fila = document.createElement("div");
    fila.className = "msg-row from-bot";
    const burbuja = document.createElement("div");
    burbuja.className = "msg bot";
    burbuja.innerHTML = texto.replace(/\n/g, "<br>").replace(/\*(.+?)\*/g, "<b>$1</b>");
    const hora = document.createElement("span");
    hora.className = "msg-time";
    hora.textContent = horaActual();
    fila.appendChild(burbuja);
    fila.appendChild(hora);
    bodyEl.appendChild(fila);
    scrollDown();
  }

  function pintarUsuario(texto) {
    const fila = document.createElement("div");
    fila.className = "msg-row from-user";
    const burbuja = document.createElement("div");
    burbuja.className = "msg user";
    burbuja.textContent = texto;
    const hora = document.createElement("span");
    hora.className = "msg-time";
    hora.textContent = horaActual();
    fila.appendChild(burbuja);
    fila.appendChild(hora);
    bodyEl.appendChild(fila);
    scrollDown();
  }

  function pintarOpciones(opciones) {
    const wrap = document.createElement("div");
    wrap.className = "quick-replies";
    opciones.forEach((opcion) => {
      const btn = document.createElement("button");
      btn.className = "qr-btn";
      btn.type = "button";
      btn.textContent = opcion;
      btn.onclick = () => {
        wrap.remove();
        enviarMensaje(opcion);
      };
      wrap.appendChild(btn);
    });
    bodyEl.appendChild(wrap);
    scrollDown();
  }

  function pintarTarjeta(datos) {
    const d = document.createElement("div");
    d.className = "card-cita";
    const estadoClase = (datos.estado || "").toLowerCase().replace(/\s+/g, "_");
    let filas = "";
    if (datos.paciente) filas += `<div class="row"><span>Paciente</span><b>${datos.paciente}</b></div>`;
    if (datos.cedula) filas += `<div class="row"><span>Cédula</span><b>${datos.cedula}</b></div>`;
    if (datos.procedimiento) filas += `<div class="row"><span>Procedimiento</span><b>${datos.procedimiento}</b></div>`;
    if (datos.fechaHora) filas += `<div class="row"><span>Fecha y hora</span><b>${datos.fechaHora}</b></div>`;
    if (datos.estado) filas += `<div class="row"><span>Estado</span><span class="status-pill ${estadoClase}">${datos.estado}</span></div>`;
    d.innerHTML = filas;
    bodyEl.appendChild(d);
    scrollDown();
  }

  function mostrarTyping() {
    quitarTyping();
    const d = document.createElement("div");
    d.className = "msg typing";
    d.id = "typingIndicator";
    d.innerHTML = "<span></span><span></span><span></span>";
    bodyEl.appendChild(d);
    scrollDown();
  }

  function quitarTyping() {
    const el = document.getElementById("typingIndicator");
    if (el) el.remove();
  }

  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Calcula una pausa de "escritura" proporcional a lo largo del mensaje,
  // como haria una persona real escribiendo, acotada a un rango agradable.
  function tiempoDeEscritura(texto) {
    const base = 380;
    const porCaracter = Math.min((texto || "").length * 9, 900);
    return Math.max(base, Math.min(base + porCaracter, 1500));
  }

  // Pinta cada bloque de la respuesta con una pausa de "escribiendo..." entre
  // uno y otro, para que una respuesta con varios mensajes se sienta como una
  // conversacion real y no como un volcado instantaneo de texto.
  async function pintarRespuestasConRitmo(respuestas) {
    for (let i = 0; i < respuestas.length; i++) {
      const r = respuestas[i];
      if (r.texto) {
        mostrarTyping();
        await esperar(tiempoDeEscritura(r.texto));
        quitarTyping();
        pintarBot(r.texto);
        recordarProcedimiento((r.texto.match(/\*[^*]+\*/g) || []).join(" "));
        if (pideFechaHora(r.texto)) crearSelector();
      }
      if (r.tarjeta) {
        await esperar(220);
        pintarTarjeta(r.tarjeta);
      }
      if (r.opciones && r.opciones.length) {
        await esperar(180);
        pintarOpciones(r.opciones);
      }
    }
  }

  async function enviarMensaje(texto) {
    if (!texto || !texto.trim() || enviando) return;
    enviando = true;
    sendBtnEl.disabled = true;
    recordarProcedimiento(texto);
    pintarUsuario(texto);
    mostrarTyping();

    try {
      const data = await Api.post("/api/chatbot/mensaje", { conversacionId, mensaje: texto });
      conversacionId = data.conversacionId;
      quitarTyping();
      await pintarRespuestasConRitmo(data.respuestas);
    } catch (err) {
      quitarTyping();
      pintarBot("Uy, tuve un problema procesando tu mensaje. ¿Puedes intentar de nuevo? 🙏");
      console.error(err);
    } finally {
      enviando = false;
      sendBtnEl.disabled = false;
      inputEl && inputEl.focus();
    }
  }

  async function open() {
    iconosOverlay();
    cargarCatalogo();
    overlayEl.classList.add("open");
    if (!conversacionId) {
      bodyEl.innerHTML = "";
      mostrarTyping();
      try {
        const data = await Api.post("/api/chatbot/iniciar", {});
        conversacionId = data.conversacionId;
        quitarTyping();
        await esperar(320);
        await pintarRespuestasConRitmo(data.respuestas);
      } catch (err) {
        quitarTyping();
        pintarBot("No pude conectar con el asistente. Intenta de nuevo en unos segundos.");
        console.error(err);
      }
    }
    setTimeout(() => inputEl && inputEl.focus(), 200);
  }

  // Cierra el chat "succionandolo" hacia el boton flotante: calcula a donde
  // tiene que viajar (centro del boton) y anima el telefono encogiendose y
  // deslizandose hasta ahi, en vez de simplemente desaparecer de golpe.
  function close() {
    if (!overlayEl || !overlayEl.classList.contains("open") || overlayEl.classList.contains("closing")) return;

    const phone = overlayEl.querySelector(".phone");
    const fab = document.getElementById("fabBtn");

    if (!phone || !fab || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      overlayEl.classList.remove("open", "closing");
      return;
    }

    const rectPhone = phone.getBoundingClientRect();
    const rectFab = fab.getBoundingClientRect();
    const dx = rectFab.left + rectFab.width / 2 - (rectPhone.left + rectPhone.width / 2);
    const dy = rectFab.top + rectFab.height / 2 - (rectPhone.top + rectPhone.height / 2);

    phone.style.setProperty("--suck-x", `${dx}px`);
    phone.style.setProperty("--suck-y", `${dy}px`);
    overlayEl.classList.add("closing");
    phone.classList.add("sucking");

    let resuelto = false;
    const finalizar = () => {
      if (resuelto) return;
      resuelto = true;
      overlayEl.classList.remove("open", "closing");
      phone.classList.remove("sucking");
      phone.style.removeProperty("--suck-x");
      phone.style.removeProperty("--suck-y");
      fab.classList.add("receiving");
      setTimeout(() => fab.classList.remove("receiving"), 500);
    };

    // El telefono anima tres propiedades a la vez (transform, opacity,
    // border-radius) con distinta duracion/retraso; solo debemos finalizar
    // cuando termina la mas larga (opacity), si no, el reseteo de clases
    // corta la animacion a la mitad y se ve un salto brusco.
    const onTransitionEnd = (e) => {
      if (e.target !== phone || e.propertyName !== "opacity") return;
      phone.removeEventListener("transitionend", onTransitionEnd);
      finalizar();
    };
    phone.addEventListener("transitionend", onTransitionEnd);
    setTimeout(finalizar, 750); // red de seguridad si transitionend no dispara
  }

  function bindInput() {
    document.addEventListener("DOMContentLoaded", () => {
      iconosOverlay();
      sendBtnEl.addEventListener("click", () => {
        const texto = inputEl.value.trim();
        if (!texto) return;
        inputEl.value = "";
        enviarMensaje(texto);
      });
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          sendBtnEl.click();
        }
      });
      overlayEl.addEventListener("click", (e) => {
        if (e.target === overlayEl) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlayEl.classList.contains("open")) close();
      });
    });
  }

  // ---- Selector de fecha y hora ----
  // Aparece justo despues de que el bot pregunta "¿que dia y hora prefieres?"
  // (al agendar y al reprogramar). Muestra los dias del mes y, al elegir uno, las
  // horas realmente libres (GET /api/citas/disponibilidad). Al elegir una hora
  // solo envia un mensaje de texto al chat con el formato que el bot ya entiende,
  // asi que escribir el dia y la hora a mano sigue funcionando igual.
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  let catalogo = null;
  let procActual = null;
  let selectorEl = null;

  function normalizar(texto) {
    return (texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  async function cargarCatalogo() {
    if (catalogo) return;
    try {
      catalogo = await Api.get("/api/procedimientos");
    } catch (err) {
      catalogo = null; // el selector funciona igual, asumiendo 30 min
    }
  }

  // Recuerda de que procedimiento se esta hablando para calcular la duracion.
  function recordarProcedimiento(texto) {
    if (!catalogo) return;
    const t = normalizar(texto);
    let mejor = null;
    catalogo.forEach((p) => {
      const n = normalizar(p.nombre);
      if (t.includes(n) && (!mejor || n.length > normalizar(mejor.nombre).length)) mejor = p;
    });
    if (mejor) procActual = mejor;
  }

  function pideFechaHora(texto) {
    return /dia y hora (prefieres|la quieres mover)/.test(normalizar(texto));
  }

  function claveFecha(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function etiquetaHora(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "p. m." : "a. m."}`;
  }

  function crearSelector() {
    if (selectorEl) selectorEl.remove();
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const est = { mes: new Date(hoy.getFullYear(), hoy.getMonth(), 1), dia: null, dias: null, error: false, bloqueado: false, peticion: 0 };

    const el = document.createElement("div");
    el.className = "picker";
    el.innerHTML = `
      <button type="button" class="pk-head" aria-expanded="true">
        <span class="pk-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></span>
        <span class="pk-ttl"><b class="pk-titulo">Elige día y hora</b><small class="pk-sub"></small></span>
        <svg class="pk-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="pk-body">
        <div class="pk-mes"><button type="button" class="pk-nav" data-nav="-1" aria-label="Mes anterior">‹</button><strong></strong><button type="button" class="pk-nav" data-nav="1" aria-label="Mes siguiente">›</button></div>
        <div class="pk-grid"></div>
        <div class="pk-leyenda"><span>Varias horas</span><span class="l2">Pocas horas</span><span class="l3">Sin cupo</span></div>
        <div class="pk-estado" hidden></div>
        <div class="pk-horas" hidden></div>
      </div>`;

    const q = (sel) => el.querySelector(sel);
    const head = q(".pk-head");
    const grid = q(".pk-grid");
    const estadoEl = q(".pk-estado");
    const horasEl = q(".pk-horas");
    q(".pk-sub").textContent = procActual ? `${procActual.nombre} · ${procActual.duracionMin} min` : "Horas disponibles";

    function pintarHoras() {
      if (!est.dia) {
        horasEl.hidden = true;
        return;
      }
      const clave = claveFecha(est.dia);
      const lista = (est.dias && est.dias[clave]) || [];
      // Todas las horas del dia: las que no estan libres se muestran tachadas.
      const todas = (est.horario && est.horario[clave]) || lista;
      const titulo = `${DIAS[est.dia.getDay()]} ${est.dia.getDate()} de ${MESES[est.dia.getMonth()]}`;
      const franja = (nombre, horas) =>
        horas.length
          ? `<div class="pk-franja"><h4>${nombre}</h4><div class="pk-slots">${horas
              .map((h) =>
                lista.includes(h)
                  ? `<button type="button" class="pk-slot" data-h="${h}">${etiquetaHora(h)}</button>`
                  : `<button type="button" class="pk-slot" disabled aria-label="${etiquetaHora(h)}, ocupada">${etiquetaHora(h)}</button>`
              )
              .join("")}</div></div>`
          : "";
      horasEl.hidden = false;
      horasEl.innerHTML =
        `<div class="pk-horas-head"><strong>${titulo}</strong><span>${lista.length} ${lista.length === 1 ? "hora libre" : "horas libres"}</span></div>` +
        franja("Mañana", todas.filter((h) => h < "12:00")) +
        franja("Tarde", todas.filter((h) => h >= "12:00"));
      horasEl.querySelectorAll(".pk-slot:not(:disabled)").forEach((b) => {
        b.onclick = () => elegirHora(b.dataset.h);
      });
      setTimeout(() => horasEl.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    }

    function pintarMes() {
      const y = est.mes.getFullYear();
      const mo = est.mes.getMonth();
      q(".pk-mes strong").textContent = `${MESES[mo]} ${y}`;
      q('[data-nav="-1"]').disabled = y === hoy.getFullYear() && mo === hoy.getMonth();
      q('[data-nav="1"]').disabled = (y - hoy.getFullYear()) * 12 + mo - hoy.getMonth() >= 2;
      estadoEl.hidden = !(est.error || !est.dias);
      estadoEl.textContent = est.error
        ? "No pude cargar los horarios. Escribe el día y la hora en el chat (ej: jueves 3:00 p.m.)."
        : "Cargando horarios…";
      grid.innerHTML = ["D", "L", "M", "M", "J", "V", "S"].map((x) => `<div class="pk-dow">${x}</div>`).join("");
      for (let i = new Date(y, mo, 1).getDay(); i > 0; i--) grid.appendChild(document.createElement("div"));
      const total = new Date(y, mo + 1, 0).getDate();
      for (let n = 1; n <= total; n++) {
        const d = new Date(y, mo, n);
        const horas = (est.dias && est.dias[claveFecha(d)]) || [];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pk-dia";
        b.textContent = n;
        if (!horas.length) b.disabled = true;
        else {
          const punto = document.createElement("i");
          if (horas.length <= 3) punto.className = "poco";
          b.appendChild(punto);
        }
        if (d.getTime() === hoy.getTime()) b.classList.add("hoy");
        if (est.dia && claveFecha(est.dia) === claveFecha(d)) b.classList.add("sel");
        b.setAttribute("aria-label", `${DIAS[d.getDay()]} ${n} de ${MESES[mo]}, ${horas.length ? horas.length + " horas libres" : "no disponible"}`);
        b.onclick = () => {
          est.dia = d;
          pintarMes();
          pintarHoras();
        };
        grid.appendChild(b);
      }
    }

    async function cargarMes() {
      const mi = ++est.peticion;
      est.dias = null;
      est.error = false;
      pintarMes();
      const desde = est.mes.getTime() < hoy.getTime() ? hoy : est.mes;
      const hasta = new Date(est.mes.getFullYear(), est.mes.getMonth() + 1, 0);
      let url = `/api/citas/disponibilidad?desde=${claveFecha(desde)}&hasta=${claveFecha(hasta)}`;
      if (procActual) url += `&procedimientoId=${procActual.id}`;
      try {
        const data = await Api.get(url);
        if (mi !== est.peticion) return;
        est.dias = data.dias;
        est.horario = data.horario;
      } catch (err) {
        if (mi !== est.peticion) return;
        est.dias = {};
        est.error = true;
        console.error(err);
      }
      pintarMes();
      pintarHoras();
    }

    // Una vez elegida la hora el selector queda bloqueado: el bot ya paso al
    // paso de confirmacion y un segundo mensaje de fecha lo confundiria.
    function elegirHora(hhmm) {
      if (enviando || est.bloqueado) return;
      est.bloqueado = true;
      const d = est.dia;
      const texto = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} · ${etiquetaHora(hhmm)}`;
      q(".pk-titulo").textContent = texto;
      q(".pk-sub").textContent = "Horario enviado";
      el.classList.add("cerrado", "bloqueado");
      head.setAttribute("aria-expanded", "false");
      head.disabled = true;
      enviarMensaje(texto);
    }

    head.onclick = () => {
      if (est.bloqueado) return;
      const cerrado = el.classList.toggle("cerrado");
      head.setAttribute("aria-expanded", String(!cerrado));
    };
    el.querySelectorAll(".pk-nav").forEach((b) => {
      b.onclick = () => {
        est.mes = new Date(est.mes.getFullYear(), est.mes.getMonth() + Number(b.dataset.nav), 1);
        est.dia = null;
        horasEl.hidden = true;
        cargarMes();
      };
    });

    bodyEl.appendChild(el);
    selectorEl = el;
    scrollDown();
    cargarMes();
  }

  bindInput();

  return { open, close };
})();
