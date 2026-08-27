const asyncHandler = require("../../utils/asyncHandler");
const service = require("./odontologos.service");

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
  res.json(await service.eliminar(req.params.id));
});

const establecerHorarios = asyncHandler(async (req, res) => {
  res.json(await service.establecerHorarios(req.params.id, req.body.horarios || []));
});

const crearBloqueo = asyncHandler(async (req, res) => {
  res.status(201).json(await service.crearBloqueo(req.body));
});

const listarBloqueos = asyncHandler(async (req, res) => {
  res.json(await service.listarBloqueos(req.query.odontologoId));
});

const eliminarBloqueo = asyncHandler(async (req, res) => {
  await service.eliminarBloqueo(req.params.id);
  res.status(204).end();
});

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  establecerHorarios,
  crearBloqueo,
  listarBloqueos,
  eliminarBloqueo,
};
