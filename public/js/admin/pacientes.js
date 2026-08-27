requireAdminAuth();
montarSidebar("pacientes");

async function buscarHistorial() {
  const cedula = document.getElementById("cedulaInput").value.trim();
  const contenedor = document.getElementById("resultadoPaciente");
  if (!cedula) return;
  contenedor.innerHTML = '<div class="empty-state">Buscando…</div>';

  try {
    const paciente = await Api.get(`/api/pacientes/${encodeURIComponent(cedula)}/historial`, { auth: "admin" });
    if (!paciente.citas.length) {
      contenedor.innerHTML = `<div class="empty-state">${paciente.nombre} no tiene citas registradas.</div>`;
      return;
    }
    contenedor.innerHTML = `
      <p style="margin-bottom:14px;"><b>${paciente.nombre}</b> · CC ${paciente.cedula} ${paciente.telefono ? `· ${paciente.telefono}` : ""}</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Fecha y hora</th><th>Procedimiento</th><th>Odontólogo</th><th>Estado</th></tr></thead>
          <tbody>
            ${paciente.citas
              .map(
                (c) => `<tr>
                  <td>${formatoFecha(c.fechaHora)}</td>
                  <td>${c.procedimiento.nombre}</td>
                  <td>${c.odontologo.nombre}</td>
                  <td>${pillEstado(c.estado)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    if (err.status === 404) {
      contenedor.innerHTML = '<div class="empty-state">No se encontró ningún paciente con esa cédula.</div>';
    } else {
      manejarErrorApi(err);
    }
  }
}

document.getElementById("btnBuscar").onclick = buscarHistorial;
document.getElementById("cedulaInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarHistorial();
});
