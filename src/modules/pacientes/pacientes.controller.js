const asyncHandler = require("../../utils/asyncHandler");
const service = require("./pacientes.service");

const listar = asyncHandler(async (req, res) => {
  res.json(await service.listarPacientes({ limite: Number(req.query.limite) || 50 }));
});

const buscar = asyncHandler(async (req, res) => {
  const resultados = await service.buscarPacientes(req.query.q);
  res.json(resultados);
});

const historial = asyncHandler(async (req, res) => {
  const paciente = await service.historialPorCedula(req.params.cedula);
  res.json(paciente);
});

module.exports = {
  listar, buscar, historial };
