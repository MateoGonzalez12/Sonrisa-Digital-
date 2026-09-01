const asyncHandler = require("../../utils/asyncHandler");
const service = require("./citas.service");
const notificaciones = require("../notificaciones/notificaciones.service");
const { formatFechaHora } = require("../../utils/fechas");

const crear = asyncHandler(async (req, res) => {
  const cita = await service.crearCita({ ...req.body, origen: req.body.origen || "web" });
  res.status(201).json(cita);
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
  listar, crear, obtener, buscar, agendaGeneral, reportes, reprogramar, cancelar, confirmar };
