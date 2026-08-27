requireAdminAuth();
montarSidebar("reportes");

const NOMBRES_ESTADO = {
  PENDIENTE: "Pendientes",
  CONFIRMADA: "Confirmadas",
  CANCELADA: "Canceladas",
  COMPLETADA: "Completadas",
  NO_ASISTIO: "No asistió",
};

async function cargarReporte() {
  const desde = document.getElementById("desde").value;
  const hasta = document.getElementById("hasta").value;
  const query = new URLSearchParams();
  if (desde) query.set("desde", desde);
  if (hasta) query.set("hasta", hasta);

  try {
    const data = await Api.get(`/api/citas/reportes?${query.toString()}`, { auth: "admin" });

    document.getElementById("statGrid").innerHTML = `
      <div class="stat-card"><b>${data.total}</b><span>Total de citas</span></div>
      <div class="stat-card"><b>${data.inasistencias}</b><span>Inasistencias</span></div>
    `;

    const filasEstado = Object.entries(data.porEstado);
    document.querySelector("#tablaEstado tbody").innerHTML = filasEstado.length
      ? filasEstado.map(([estado, cantidad]) => `<tr><td>${NOMBRES_ESTADO[estado] || estado}</td><td>${cantidad}</td></tr>`).join("")
      : '<tr><td class="empty-state">Sin datos en el rango seleccionado.</td></tr>';

    const filasOdontologo = Object.entries(data.porOdontologo);
    document.querySelector("#tablaOdontologo tbody").innerHTML = filasOdontologo.length
      ? filasOdontologo.map(([nombre, cantidad]) => `<tr><td>${nombre}</td><td>${cantidad}</td></tr>`).join("")
      : '<tr><td class="empty-state">Sin datos en el rango seleccionado.</td></tr>';
  } catch (err) {
    manejarErrorApi(err);
  }
}

document.getElementById("btnFiltrar").onclick = cargarReporte;
cargarReporte();
