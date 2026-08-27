const asyncHandler = require("../../utils/asyncHandler");
const service = require("./pacientes.service");

const buscar = asyncHandler(async (req, res) => {
  const resultados = await service.buscarPacientes(req.query.q);
  res.json(resultados);
});

const historial = asyncHandler(async (req, res) => {
  const paciente = await service.historialPorCedula(req.params.cedula);
  res.json(paciente);
});

module.exports = { buscar, historial };
