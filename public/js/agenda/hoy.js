requireStaffAuth();
document.getElementById("nombreStaff").textContent = nombreStaffSesion();
document.getElementById("avatarStaff").textContent = inicialesDe(nombreStaffSesion());

async function cargarHoy() {
  const contenedor = document.getElementById("listaHoy");
  try {
    const citas = await Api.get("/api/agenda-movil/hoy", { auth: "staff" });
    if (!citas.length) {
      contenedor.innerHTML = '<div class="empty-state">No tienes citas programadas para hoy. 🎉</div>';
      return;
    }
    contenedor.innerHTML = citas
      .map(
        (c) => `<div class="appt-card" onclick='mostrarDetalleCita(${JSON.stringify(c)})'>
          <div class="hora">${new Date(c.fechaHora).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</div>
          <div class="nombre">${c.paciente.nombre}</div>
          <div class="proc">${c.procedimiento.nombre} · ${c.estado}</div>
        </div>`
      )
      .join("");
  } catch (err) {
    manejarErrorApiStaff(err);
    contenedor.innerHTML = '<div class="empty-state">No se pudo cargar tu agenda.</div>';
  }
}

cargarHoy();
