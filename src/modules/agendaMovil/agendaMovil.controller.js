const asyncHandler = require("../../utils/asyncHandler");
const { AppError } = require("../../middlewares/errorHandler");
const citasService = require("../citas/citas.service");

// KAN-133: el detalle no expone informacion del paciente mas alla de lo
// necesario para atenderlo (nombre, cedula, procedimiento y horario).
function proyectarCitaParaStaff(cita) {
  return {
    id: cita.id,
    paciente: { nombre: cita.paciente.nombre, cedula: cita.paciente.cedula },
    procedimiento: { nombre: cita.procedimiento.nombre, duracionMin: cita.procedimiento.duracionMin },
    fechaHora: cita.fechaHora,
    estado: cita.estado,
  };
}

// RF-27: citas del dia (KAN-128/129 - solo las del odontologo autenticado).
const citasDelDia = asyncHandler(async (req, res) => {
  const fecha = req.query.fecha ? new Date(req.query.fecha) : new Date();
  const citas = await citasService.agendaDelDia(req.usuario.id, fecha);
  res.json(citas.map(proyectarCitaParaStaff));
});

// RF-28: agenda semanal (KAN-130/131).
const citasDeLaSemana = asyncHandler(async (req, res) => {
  const fecha = req.query.fecha ? new Date(req.query.fecha) : new Date();
  const dias = await citasService.agendaDeLaSemana(req.usuario.id, fecha);
  res.json(dias.map((d) => ({ fecha: d.fecha, citas: d.citas.map(proyectarCitaParaStaff) })));
});

// RF-29: detalle de una cita puntual, validando que pertenezca al staff autenticado.
const detalleCita = asyncHandler(async (req, res) => {
  const cita = await citasService.obtenerCita(req.params.id);
  if (cita.odontologoId !== req.usuario.id) {
    throw new AppError("No tienes permiso para ver esta cita", 403);
  }
  res.json(proyectarCitaParaStaff(cita));
});

module.exports = { citasDelDia, citasDeLaSemana, detalleCita };
