requireAdminAuth();
montarSidebar("dashboard");

async function cargar() {
  try {
    const data = await Api.get("/api/admin/resumen", { auth: "admin" });

    document.getElementById("statGrid").innerHTML = `
      <div class="stat-card"><b>${data.citasHoy}</b><span>Citas hoy</span></div>
      <div class="stat-card"><b>${data.pendientes}</b><span>Pendientes por confirmar</span></div>
      <div class="stat-card"><b>${data.confirmadas}</b><span>Confirmadas</span></div>
    `;

    const cuerpoProximas = data.proximas.length
      ? data.proximas
          .map(
            (c) => `<tr>
              <td>${c.paciente.nombre}</td>
              <td>${c.procedimiento.nombre}</td>
              <td>${c.odontologo.nombre}</td>
              <td>${formatoFecha(c.fechaHora)}</td>
              <td>${pillEstado(c.estado)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="empty-state">No hay citas próximas.</td></tr>`;
    document.querySelector("#tablaProximas tbody").innerHTML = cuerpoProximas;

    const cuerpoMensajes = data.mensajesRecientes.length
      ? data.mensajesRecientes
          .map(
            (m) => `<tr>
              <td>${m.telefono}</td>
              <td>${m.tipo}</td>
              <td>${m.contenido.length > 60 ? m.contenido.slice(0, 60) + "…" : m.contenido}</td>
              <td>${formatoFecha(m.createdAt)}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="empty-state">Aún no se han enviado mensajes.</td></tr>`;
    document.querySelector("#tablaMensajes tbody").innerHTML = cuerpoMensajes;
  } catch (err) {
    manejarErrorApi(err);
  }
}

cargar();
