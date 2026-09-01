/* Activacion de Face ID desde la agenda.
 *
 * Se registra estando ya autenticado con el PIN: asi el sistema garantiza que
 * quien asocia su rostro es quien conoce el PIN de esa persona. A partir de
 * entonces el PIN queda como metodo de respaldo.
 */

(function () {
  const caja = document.getElementById("avisoBiometria");
  const texto = document.getElementById("bioTexto");
  const accion = document.getElementById("bioAccion");
  const cerrar = document.getElementById("bioCerrar");
  if (!caja) return;

  const CLAVE_OCULTO = "sonrisa_aviso_bio_oculto";

  function ocultar() {
    caja.style.display = "none";
  }

  function mostrar(mensaje, etiqueta, alPulsar) {
    texto.innerHTML = mensaje;
    if (etiqueta) {
      accion.style.display = "";
      accion.textContent = etiqueta;
      accion.onclick = alPulsar;
    } else {
      accion.style.display = "none";
    }
    caja.style.display = "";
  }

  cerrar.addEventListener("click", () => {
    try {
      localStorage.setItem(CLAVE_OCULTO, "1");
    } catch (e) {
      /* modo privado */
    }
    ocultar();
  });

  async function evaluar() {
    try {
      if (localStorage.getItem(CLAVE_OCULTO)) return;
    } catch (e) {
      /* sigue adelante */
    }

    if (!(await Movil.hayBiometriaEnEsteDispositivo())) return;

    // Si ya hay una credencial registrada no se vuelve a ofrecer.
    try {
      const credenciales = await Api.get("/api/auth/staff/webauthn/credenciales", { auth: "staff" });
      if (credenciales.length > 0) return;
    } catch (err) {
      return; // sin sesion valida o sin red: no es momento de ofrecerlo
    }

    mostrar("Entra más rápido con Face ID en vez de escribir tu PIN.", "Activar Face ID", async () => {
      accion.disabled = true;
      accion.textContent = "Registrando…";
      try {
        await Movil.registrarBiometria(Movil.esIOS() ? "iPhone" : "Este dispositivo");
        mostrar("Face ID activado. La próxima vez entras con tu rostro.", null);
        setTimeout(ocultar, 6000);
      } catch (err) {
        if (err.name === "NotAllowedError") {
          ocultar(); // la persona cancelo: no insistir en esta sesion
        } else {
          mostrar(err.message || "No se pudo activar Face ID.", null);
        }
      } finally {
        accion.disabled = false;
      }
    });
  }

  evaluar();
})();
