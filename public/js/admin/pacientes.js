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

// La pantalla arrancaba en blanco pidiendo una cedula, lo que se leia como
// "no hay pacientes". Ahora muestra el listado y se abre el historial con un
// clic, sin tener que saber la cedula de memoria.
async function cargarListado() {
  const contenedor = document.getElementById("listadoPacientes");
  if (!contenedor) return;
  contenedor.innerHTML = '<div class="empty-state">Cargando pacientes…</div>';
  try {
    const pacientes = await Api.get("/api/pacientes/lista", { auth: "admin" });
    if (!pacientes.length) {
      contenedor.innerHTML = '<div class="empty-state">Aun no hay pacientes registrados.</div>';
      return;
    }
    contenedor.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Paciente</th><th>Cédula</th><th>Teléfono</th><th>Citas</th></tr></thead>
          <tbody>
            ${pacientes
              .map(
                (p) => `<tr style="cursor:pointer" onclick="verHistorialDe('${p.cedula}')">
                  <td>${p.nombre}</td>
                  <td>${p.cedula}</td>
                  <td>${p.telefono || "—"}</td>
                  <td>${p.totalCitas}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    manejarErrorApi(err);
  }
}

function verHistorialDe(cedula) {
  document.getElementById("cedulaInput").value = cedula;
  buscarHistorial();
}

document.getElementById("btnBuscar").onclick = buscarHistorial;
document.getElementById("cedulaInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarHistorial();
});

cargarListado();
