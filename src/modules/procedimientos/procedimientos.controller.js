const asyncHandler = require("../../utils/asyncHandler");
const service = require("./procedimientos.service");

const listar = asyncHandler(async (req, res) => {
  const soloActivos = req.query.activos === "true";
  res.json(await service.listar({ soloActivos }));
});

const obtener = asyncHandler(async (req, res) => {
  res.json(await service.obtener(req.params.id));
});

const crear = asyncHandler(async (req, res) => {
  res.status(201).json(await service.crear(req.body));
});

const actualizar = asyncHandler(async (req, res) => {
  res.json(await service.actualizar(req.params.id, req.body));
});

const eliminar = asyncHandler(async (req, res) => {
  const forzar = req.query.forzar === "true";
  const resultado = await service.eliminar(req.params.id, { forzar });
  res.json(resultado);
});

module.exports = { listar, obtener, crear, actualizar, eliminar };
