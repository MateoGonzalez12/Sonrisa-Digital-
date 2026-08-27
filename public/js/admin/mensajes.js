requireAdminAuth();
montarSidebar("mensajes");

async function cargar() {
  const tbody = document.querySelector("#tablaMensajes tbody");
  try {
    const mensajes = await Api.get("/api/notificaciones", { auth: "admin" });
    if (!mensajes.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Aún no se han enviado mensajes.</td></tr>';
      return;
    }
    tbody.innerHTML = mensajes
      .map(
        (m) => `<tr>
          <td>${formatoFecha(m.createdAt)}</td>
          <td>${m.direccion === "SALIENTE" ? "Enviado" : "Recibido"}</td>
          <td>${m.telefono}</td>
          <td>${m.tipo}</td>
          <td>${m.contenido}</td>
        </tr>`
      )
      .join("");
  } catch (err) {
    manejarErrorApi(err);
  }
}

cargar();
