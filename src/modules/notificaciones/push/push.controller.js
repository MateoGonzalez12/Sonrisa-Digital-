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
//
// La prueba tiene que fallar de forma ruidosa. Antes devolvia 200 con
// {enviadas: 0} cuando faltaban las claves VAPID en el servidor o cuando el
// dispositivo no habia quedado suscrito, y la agenda mostraba "te acabamos de
// enviar una notificacion" aunque no se hubiera enviado nada: el problema real
// quedaba invisible.
const probar = asyncHandler(async (req, res) => {
  if (!pushService.estaConfigurado()) {
    throw new AppError(
      "El servidor no tiene configuradas las claves VAPID, por eso no puede enviar notificaciones.",
      503
    );
  }

  const resultado = await pushService.enviarA(req.usuario.id, {
    titulo: "Notificaciones activadas",
    cuerpo: "Asi se veran los avisos de tus nuevas citas.",
    url: "/agenda/hoy.html",
    tag: "prueba",
  });

  if (resultado.enviadas === 0) {
    throw new AppError(
      "Este dispositivo no quedo suscrito a las notificaciones. Cierra la agenda, vuelve a abrirla desde el icono de la pantalla de inicio e intenta de nuevo.",
      409
    );
  }

  res.json(resultado);
});

module.exports = { clavePublica, suscribir, desuscribir, probar };
