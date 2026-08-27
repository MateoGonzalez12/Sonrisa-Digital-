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

  bindInput();

  return { open, close };
})();
