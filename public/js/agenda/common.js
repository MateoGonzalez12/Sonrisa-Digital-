// Utilidades compartidas por la agenda movil (odontologos/auxiliares).
function requireStaffAuth() {
  if (!Api.getToken("staff")) {
    location.href = "/agenda/login.html";
    throw new Error("No autenticado");
  }
}

function nombreStaffSesion() {
  try {
    const token = Api.getToken("staff");
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.nombre || "Personal";
  } catch (e) {
    return "Personal";
  }
}

function inicialesDe(nombre) {
  return nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function cerrarSesionStaff() {
  Api.clearToken("staff");
  location.href = "/agenda/login.html";
}

function manejarErrorApiStaff(err) {
  console.error(err);
  if (err.status === 401 || err.status === 403) {
    cerrarSesionStaff();
  }
}

function mostrarDetalleCita(cita) {
  alert(
    `Paciente: ${cita.paciente.nombre}\n` +
      `Cédula: ${cita.paciente.cedula}\n` +
      `Procedimiento: ${cita.procedimiento.nombre} (${cita.procedimiento.duracionMin} min)\n` +
      `Hora: ${new Date(cita.fechaHora).toLocaleString("es-CO", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}\n` +
      `Estado: ${cita.estado}`
  );
}
