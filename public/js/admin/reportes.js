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

  // Sin este aviso la pantalla se veia con las tablas vacias durante el viaje a
  // la API, dando la impresion de que no habia datos.
  document.getElementById("statGrid").innerHTML =
    '<div class="stat-card"><b>…</b><span>Calculando…</span></div>';
  document.querySelector("#tablaEstado tbody").innerHTML =
    '<tr><td class="empty-state">Cargando…</td></tr>';
  document.querySelector("#tablaOdontologo tbody").innerHTML =
    '<tr><td class="empty-state">Cargando…</td></tr>';

  try {
    const data = await Api.get(`/api/citas/reportes?${query.toString()}`, { auth: "admin" });

    document.getElementById("statGrid").innerHTML = `
      <div class="stat-card"><b>${data.total}</b><span>Total de citas</span></div>
      <div class="stat-card"><b>${data.inasistencias}</b><span>Inasistencias</span></div>
    `;

    const filasEstado = Object.entries(data.porEstado);
    document.querySelector("#tablaEstado tbody").innerHTML = filasEstado.length
      ? filasEstado.map(([estado, cantidad]) => `<tr><td>${NOMBRES_ESTADO[estado] || estado}</td><td>${cantidad}</td></tr>`).join("")
      : `<tr><td class="empty-state">${desde || hasta ? "Sin citas en el rango seleccionado." : "Aun no hay citas registradas."}</td></tr>`;

    const filasOdontologo = Object.entries(data.porOdontologo);
    document.querySelector("#tablaOdontologo tbody").innerHTML = filasOdontologo.length
      ? filasOdontologo.map(([nombre, cantidad]) => `<tr><td>${nombre}</td><td>${cantidad}</td></tr>`).join("")
      : `<tr><td class="empty-state">${desde || hasta ? "Sin citas en el rango seleccionado." : "Aun no hay citas registradas."}</td></tr>`;
  } catch (err) {
    manejarErrorApi(err);
  }
}

document.getElementById("btnFiltrar").onclick = cargarReporte;
cargarReporte();
