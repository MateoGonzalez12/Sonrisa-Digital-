const asyncHandler = require("../../../utils/asyncHandler");
const { AppError } = require("../../../middlewares/errorHandler");
const env = require("../../../config/env");
const pushService = require("./push.service");

// La clave publica no es secreta: el navegador la necesita para crear la
// suscripcion. La privada nunca sale del servidor.
const clavePublica = asyncHandler(async (req, res) => {
  if (!env.vapid.publicKey) {
    throw new AppError("Las notificaciones push no estan configuradas en el servidor", 503);
  }
  res.json({ publicKey: env.vapid.publicKey });
});

const suscribir = asyncHandler(async (req, res) => {
  const { suscripcion } = req.body;
  if (!suscripcion) throw new AppError("Falta la suscripcion del dispositivo", 400);

  const guardada = await pushService.registrarSuscripcion(
    req.usuario.id,
    suscripcion,
    req.headers["user-agent"] || null
  );
  res.status(201).json({ ok: true, id: guardada.id });
});

const desuscribir = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) throw new AppError("Falta el endpoint", 400);
  await pushService.eliminarSuscripcion(endpoint);
  res.json({ ok: true });
});

// Permite que la Dra. compruebe en el momento que las notificaciones le llegan,
// sin tener que esperar a que un paciente agende.
const probar = asyncHandler(async (req, res) => {
  const resultado = await pushService.enviarA(req.usuario.id, {
    titulo: "Notificaciones activadas",
    cuerpo: "Asi se veran los avisos de tus nuevas citas.",
    url: "/agenda/hoy.html",
    tag: "prueba",
  });
  res.json(resultado);
});

module.exports = { clavePublica, suscribir, desuscribir, probar };
