requireStaffAuth();
document.getElementById("nombreStaff").textContent = nombreStaffSesion();
document.getElementById("avatarStaff").textContent = inicialesDe(nombreStaffSesion());

const NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

async function cargarSemana() {
  const contenedor = document.getElementById("listaSemana");
  try {
    const dias = await Api.get("/api/agenda-movil/semana", { auth: "staff" });
    contenedor.innerHTML = dias
      .map((d) => {
        const fecha = new Date(d.fecha);
        const encabezado = `${NOMBRES_DIA[fecha.getDay()]} ${fecha.getDate()}`;
        const citasHtml = d.citas.length
          ? d.citas
              .map(
                (c) => `<div class="appt-card" onclick='mostrarDetalleCita(${JSON.stringify(c)})'>
                  <div class="hora">${new Date(c.fechaHora).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</div>
                  <div class="nombre">${c.paciente.nombre}</div>
                  <div class="proc">${c.procedimiento.nombre} · ${c.estado}</div>
                </div>`
              )
              .join("")
          : '<div class="empty-state" style="padding:10px 0;">Sin citas</div>';
        return `<div class="day-block"><h4>${encabezado}</h4>${citasHtml}</div>`;
      })
      .join("");
  } catch (err) {
    manejarErrorApiStaff(err);
    contenedor.innerHTML = '<div class="empty-state">No se pudo cargar tu agenda semanal.</div>';
  }
}

cargarSemana();
