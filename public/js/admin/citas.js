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

async function cargarAgenda() {
  const fechaInput = document.getElementById("fechaAgenda");
  const fecha = fechaInput.value || inputFechaLocal(new Date());
  fechaInput.value = fecha;
  const tbody = document.querySelector("#tablaAgenda tbody");
  tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Cargando…</td></tr>`;

  try {
    const citas = await Api.get(`/api/citas/agenda-general?desde=${fecha}&hasta=${fecha}`, { auth: "admin" });
    if (!citas.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay citas para este día.</td></tr>`;
      return;
    }
    tbody.innerHTML = citas
      .map(
        (c) => `<tr>
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
async function cargarBusqueda() {
  const termino = document.getElementById("buscarInput").value.trim();
  const tbody = document.querySelector("#tablaBusqueda tbody");
  if (!termino) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Escribe para buscar.</td></tr>`;
    return;
  }
  tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Buscando…</td></tr>`;
  try {
    const citas = await Api.get(`/api/citas/buscar?q=${encodeURIComponent(termino)}`, { auth: "admin" });
    if (!citas.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Sin resultados.</td></tr>`;
      return;
    }
    tbody.innerHTML = citas
      .map(
        (c) => `<tr>
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

async function cancelarCita(citaId) {
  if (!confirm("¿Confirmas cancelar esta cita? El paciente sera notificado.")) return;
  try {
    await Api.put(`/api/citas/${citaId}/cancelar`, {}, { auth: "admin" });
    mostrarToast("Cita cancelada y paciente notificado.");
    cargarAgenda();
    cargarBusqueda();
  } catch (err) {
    manejarErrorApi(err);
  }
}

async function confirmarCita(citaId) {
  try {
    await Api.put(`/api/citas/${citaId}/confirmar`, {}, { auth: "admin" });
    mostrarToast("Cita confirmada.");
    cargarAgenda();
    cargarBusqueda();
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
    cargarAgenda();
    cargarBusqueda();
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
