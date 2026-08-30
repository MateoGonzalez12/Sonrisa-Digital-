/* Aviso dentro de la agenda para activar las notificaciones.
 *
 * En iPhone el flujo tiene dos pasos obligatorios y en este orden:
 *   1. Agregar la agenda a la pantalla de inicio (Compartir -> Anadir).
 *   2. Ya dentro del acceso directo, conceder el permiso.
 * Si se intenta al reves, iOS ni siquiera muestra el dialogo de permiso.
 */

(function () {
  const aviso = document.getElementById("avisoMovil");
  const texto = document.getElementById("avisoTexto");
  const accion = document.getElementById("avisoAccion");
  const cerrar = document.getElementById("avisoCerrar");
  if (!aviso) return;

  const CLAVE_OCULTO = "sonrisa_aviso_push_oculto";

  function ocultar() {
    aviso.style.display = "none";
  }

  function mostrar(mensaje, etiquetaBoton, alPulsar) {
    texto.innerHTML = mensaje;
    if (etiquetaBoton) {
      accion.style.display = "";
      accion.textContent = etiquetaBoton;
      accion.onclick = alPulsar;
    } else {
      accion.style.display = "none";
    }
    aviso.style.display = "";
  }

  cerrar.addEventListener("click", () => {
    try {
      sessionStorage.setItem(CLAVE_OCULTO, "1");
    } catch (e) {
      /* modo privado: no pasa nada, solo no se recuerda */
    }
    ocultar();
  });

  async function evaluar() {
    try {
      if (sessionStorage.getItem(CLAVE_OCULTO)) return;
    } catch (e) {
      /* sigue adelante */
    }

    const estado = await Movil.estadoNotificaciones();

    if (estado === "activo" || estado === "no-soportado") {
      ocultar();
      return;
    }

    if (estado === "requiere-instalacion") {
      mostrar(
        "Para recibir avisos de tus citas, agrega la agenda a tu pantalla de inicio: " +
          "toca <b>Compartir</b> y luego <b>Anadir a pantalla de inicio</b>.",
        null
      );
      return;
    }

    if (estado === "bloqueado") {
      mostrar(
        "Las notificaciones estan bloqueadas. Actívalas desde <b>Ajustes &rsaquo; Notificaciones</b> " +
          "y vuelve a abrir la agenda.",
        null
      );
      return;
    }

    mostrar("Recibe un aviso en tu celular cuando te agenden una cita.", "Activar", async () => {
      accion.disabled = true;
      accion.textContent = "Activando…";
      try {
        await Movil.activarNotificaciones();
        await Movil.probarNotificacion();
        mostrar("Listo. Te acabamos de enviar una notificación de prueba.", null);
        setTimeout(ocultar, 6000);
      } catch (err) {
        mostrar(err.message || "No se pudieron activar las notificaciones.", null);
      } finally {
        accion.disabled = false;
      }
    });
  }

  evaluar();
})();
