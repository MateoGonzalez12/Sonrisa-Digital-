const asyncHandler = require("../../../utils/asyncHandler");
const { AppError } = require("../../../middlewares/errorHandler");
const service = require("./webauthn.service");
const { firmarToken } = require("../auth.service");

// Registro: exige sesion activa. La persona entra una vez con su PIN y desde
// ahi activa el Face ID; asi se garantiza que quien registra la cara es quien
// realmente conoce el PIN.
const opcionesRegistro = asyncHandler(async (req, res) => {
  res.json(await service.opcionesDeRegistro(req.usuario.id));
});

const verificarRegistro = asyncHandler(async (req, res) => {
  const { respuesta, apodo } = req.body;
  if (!respuesta) throw new AppError("Falta la respuesta del dispositivo", 400);
  res.status(201).json(await service.verificarRegistro(req.usuario.id, respuesta, apodo));
});

// Login: publico, porque justamente sirve para entrar sin haber iniciado sesion.
const opcionesLogin = asyncHandler(async (req, res) => {
  const odontologoId = Number(req.body.odontologoId);
  if (!odontologoId) throw new AppError("Selecciona tu nombre", 400);
  res.json(await service.opcionesDeLogin(odontologoId));
});

const verificarLogin = asyncHandler(async (req, res) => {
  const odontologoId = Number(req.body.odontologoId);
  const { respuesta } = req.body;
  if (!odontologoId || !respuesta) throw new AppError("Datos incompletos", 400);

  const staff = await service.verificarLogin(odontologoId, respuesta);
  if (!staff || !staff.activo) throw new AppError("Este usuario no esta activo", 403);

  // Mismo token que emite el login por PIN: el resto del sistema no necesita
  // saber con que metodo entro la persona.
  const token = firmarToken(
    { id: staff.id, nombre: staff.nombre, rolStaff: staff.rol, rol: "staff" },
    "12h"
  );
  res.json({ token, usuario: { id: staff.id, nombre: staff.nombre, rol: staff.rol } });
});

const listar = asyncHandler(async (req, res) => {
  res.json(await service.listarCredenciales(req.usuario.id));
});

const eliminar = asyncHandler(async (req, res) => {
  res.json(await service.eliminarCredencial(req.usuario.id, req.params.id));
});

module.exports = {
  opcionesRegistro,
  verificarRegistro,
  opcionesLogin,
  verificarLogin,
  listar,
  eliminar,
};
