const asyncHandler = require("../../utils/asyncHandler");
const service = require("./citas.service");
const notificaciones = require("../notificaciones/notificaciones.service");
const { formatFechaHora, parsearFecha } = require("../../utils/fechas");
const { horasLibresPorDia } = require("./disponibilidad.service");
const { AppError } = require("../../middlewares/errorHandler");
const prisma = require("../../db/prisma");

const crear = asyncHandler(async (req, res) => {
  const cita = await service.crearCita({ ...req.body, origen: req.body.origen || "web" });
  res.status(201).json(cita);
});

// Publico (lo usa el selector de fecha y hora del chatbot): solo expone horas
// libres por dia, sin datos de pacientes ni de otras citas.
const disponibilidad = asyncHandler(async (req, res) => {
  const { desde, hasta, procedimientoId } = req.query;
  const formato = /^\d{4}-\d{2}-\d{2}$/;
  if (!formato.test(desde || "") || !formato.test(hasta || "")) {
    throw new AppError("Indica desde y hasta con formato AAAA-MM-DD.", 400);
  }
  const inicio = parsearFecha(desde);
  const fin = parsearFecha(hasta);
  const dias = Math.round((fin - inicio) / 86400000);
  if (Number.isNaN(dias) || dias < 0 || dias > 62) {
    throw new AppError("El rango de fechas no es valido (maximo 62 dias).", 400);
  }

  let duracionMin = 30;
  if (procedimientoId) {
    const procedimiento = await prisma.procedimiento.findFirst({
      where: { id: Number(procedimientoId), activo: true },
    });
    if (procedimiento) duracionMin = procedimiento.duracionMin;
  }

  const odontologo = await service.obtenerOdontologoPorDefecto();
  const { libres, horario } = await horasLibresPorDia({ odontologoId: odontologo.id, desde: inicio, hasta: fin, duracionMin });
  res.json({ duracionMin, dias: libres, horario });
});

const obtener = asyncHandler(async (req, res) => {
  res.json(await service.obtenerCita(req.params.id));
});

const buscar = asyncHandler(async (req, res) => {
  res.json(await service.buscarPorPaciente(req.query.q));
});

const agendaGeneral = asyncHandler(async (req, res) => {
  res.json(await service.agendaGeneral({ desde: req.query.desde, hasta: req.query.hasta }));
});

const reportes = asyncHandler(async (req, res) => {
  res.json(await service.reporteBasico({ desde: req.query.desde, hasta: req.query.hasta }));
});

// Reprogramar/cancelar desde el modulo admin, notificando al paciente
// cuando corresponde.
const reprogramar = asyncHandler(async (req, res) => {
  const cita = await service.reprogramarCita(req.params.id, req.body.fechaHora);
  await notificaciones.notificarCambioAlPaciente(
    cita,
    `fue reprogramada para el ${formatFechaHora(cita.fechaHora)}.`
  );
  res.json(cita);
});

const listar = asyncHandler(async (req, res) => {
  res.json(await service.listarCitas({ limite: Number(req.query.limite) || 100 }));
});

const cancelar = asyncHandler(async (req, res) => {
  const cita = await service.cancelarCita(req.params.id);
  await notificaciones.notificarCambioAlPaciente(cita, "fue cancelada por el consultorio.");
  res.json(cita);
});

const confirmar = asyncHandler(async (req, res) => {
  res.json(await service.confirmarCita(req.params.id));
});

module.exports = {
  listar, crear, disponibilidad, obtener, buscar, agendaGeneral, reportes, reprogramar, cancelar, confirmar };
