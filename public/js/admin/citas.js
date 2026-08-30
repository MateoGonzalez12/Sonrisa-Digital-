requireAdminAuth();
montarSidebar("citas");

let citaIdEnEdicion = null;

function inputFechaLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function botonesAccion(cita, esResultadoBusqueda) {
  const botones = [];
  if (cita.estado !== "CANCELADA" && cita.estado !== "COMPLETADA") {
    botones.push(`<button class="btn btn-ghost btn-sm" onclick="abrirReprogramar(${cita.id})">Reprogramar</button>`);
    botones.push(`<button class="btn btn-danger btn-sm" onclick="cancelarCita(${cita.id})">Cancelar</button>`);
    if (cita.estado === "PENDIENTE") {
      botones.push(`<button class="btn btn-primary btn-sm" onclick="confirmarCita(${cita.id})">Confirmar</button>`);
    }
  }
  return `<div class="row-actions">${botones.join("")}</div>`;
}

async function cargarAgenda({ silencioso = false } = {}) {
  const fechaInput = document.getElementById("fechaAgenda");
  const fecha = fechaInput.value || inputFechaLocal(new Date());
  fechaInput.value = fecha;
  const tbody = document.querySelector("#tablaAgenda tbody");
  // Al recargar tras una accion se conserva lo que ya se ve; el placeholder
  // solo aparece en la primera carga o al cambiar de dia.
  if (!silencioso) tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Cargando…</td></tr>`;

  try {
    const citas = await Api.get(`/api/citas/agenda-general?desde=${fecha}&hasta=${fecha}`, { auth: "admin" });
    if (!citas.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay citas para este día.</td></tr>`;
      return;
    }
    tbody.innerHTML = citas
      .map(
        (c) => `<tr id="agenda-cita-${c.id}">
          <td>${new Date(c.fechaHora).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</td>
          <td>${c.paciente.nombre}</td>
          <td>${c.procedimiento.nombre}</td>
          <td>${c.odontologo.nombre}</td>
          <td>${pillEstado(c.estado)}</td>
          <td>${botonesAccion(c)}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    manejarErrorApi(err);
  }
}

let timeoutBusqueda = null;
// Sin termino de busqueda se muestran todas las citas (proximas primero). Antes
// la tabla decia "Escribe para buscar", lo que hacia parecer que no habia citas
// registradas cuando si las habia.
async function cargarBusqueda({ silencioso = false } = {}) {
  const termino = document.getElementById("buscarInput").value.trim();
  const tbody = document.querySelector("#tablaBusqueda tbody");
  const titulo = document.getElementById("tituloListado");

  if (!silencioso) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${termino ? "Buscando…" : "Cargando citas…"}</td></tr>`;
  }
  if (titulo) {
    titulo.textContent = termino ? "Resultados de la busqueda" : "Todas las citas";
  }

  try {
    const citas = termino
      ? await Api.get(`/api/citas/buscar?q=${encodeURIComponent(termino)}`, { auth: "admin" })
      : await Api.get("/api/citas/lista", { auth: "admin" });

    if (!citas.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${
        termino ? "Sin resultados para esa busqueda." : "Aun no hay citas registradas."
      }</td></tr>`;
      return;
    }
    tbody.innerHTML = citas
      .map(
        (c) => `<tr id="busqueda-cita-${c.id}">
          <td>${c.paciente.nombre}</td>
          <td>${c.paciente.cedula}</td>
          <td>${c.procedimiento.nombre}</td>
          <td>${formatoFecha(c.fechaHora)}</td>
          <td>${pillEstado(c.estado)}</td>
          <td>${botonesAccion(c, true)}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    manejarErrorApi(err);
  }
}

function abrirReprogramar(citaId) {
  citaIdEnEdicion = citaId;
  document.getElementById("errorReprogramar").style.display = "none";
  document.getElementById("nuevaFechaHora").value = "";
  document.getElementById("modalReprogramar").classList.add("open");
}

// Tras cancelar/confirmar, el endpoint devuelve la cita ya actualizada. Se
// repinta unicamente esa fila en lugar de recargar la tabla entera: recargar
// vaciaba el tbody y lo volvia a llenar tras el viaje a la API, lo que producia
// el parpadeo de toda la pantalla.
function refrescarFila(cita) {
  for (const prefijo of ["agenda", "busqueda"]) {
    const fila = document.getElementById(`${prefijo}-cita-${cita.id}`);
    if (!fila) continue;
    const celdas = fila.children;
    // El estado y las acciones son siempre las dos ultimas columnas en ambas tablas.
    celdas[celdas.length - 2].innerHTML = pillEstado(cita.estado);
    celdas[celdas.length - 1].innerHTML = botonesAccion(cita);
  }
}

async function cancelarCita(citaId) {
  if (!confirm("¿Confirmas cancelar esta cita? El paciente sera notificado.")) return;
  try {
    const cita = await Api.put(`/api/citas/${citaId}/cancelar`, {}, { auth: "admin" });
    refrescarFila(cita);
    mostrarToast("Cita cancelada y paciente notificado.");
  } catch (err) {
    manejarErrorApi(err);
  }
}

async function confirmarCita(citaId) {
  try {
    const cita = await Api.put(`/api/citas/${citaId}/confirmar`, {}, { auth: "admin" });
    refrescarFila(cita);
    mostrarToast("Cita confirmada.");
  } catch (err) {
    manejarErrorApi(err);
  }
}

document.getElementById("btnHoy").onclick = () => {
  document.getElementById("fechaAgenda").value = inputFechaLocal(new Date());
  cargarAgenda();
};
document.getElementById("fechaAgenda").addEventListener("change", cargarAgenda);
document.getElementById("buscarInput").addEventListener("input", () => {
  clearTimeout(timeoutBusqueda);
  timeoutBusqueda = setTimeout(cargarBusqueda, 350);
});
document.getElementById("cancelarModal").onclick = () => document.getElementById("modalReprogramar").classList.remove("open");
document.getElementById("formReprogramar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("errorReprogramar");
  errorBox.style.display = "none";
  const valor = document.getElementById("nuevaFechaHora").value;
  if (!valor) return;
  try {
    await Api.put(`/api/citas/${citaIdEnEdicion}/reprogramar`, { fechaHora: new Date(valor).toISOString() }, { auth: "admin" });
    document.getElementById("modalReprogramar").classList.remove("open");
    mostrarToast("Cita reprogramada y paciente notificado.");
    // Cambia la fecha: la cita puede salir del dia mostrado, asi que se recarga
    // la tabla, pero en modo silencioso para no parpadear.
    cargarAgenda({ silencioso: true });
    cargarBusqueda({ silencioso: true });
  } catch (err) {
    if (err.status === 409) {
      errorBox.textContent = "Ese horario ya no esta disponible para el odontologo.";
    } else {
      errorBox.textContent = err.message;
    }
    errorBox.style.display = "block";
  }
});

document.getElementById("fechaAgenda").value = inputFechaLocal(new Date());
cargarAgenda();
cargarBusqueda();
