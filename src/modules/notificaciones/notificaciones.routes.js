const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./notificaciones.controller");
const push = require("./push/push.controller");

const router = Router();

// Notificaciones push al celular del staff (RF-27).
router.get("/push/clave-publica", push.clavePublica);
router.post("/push/suscribir", requireRol("staff"), push.suscribir);
router.post("/push/desuscribir", requireRol("staff"), push.desuscribir);
router.post("/push/probar", requireRol("staff"), push.probar);

// Configura esta URL como "webhook de mensajes entrantes" en la consola de
// Twilio (Sandbox de WhatsApp) -> https://tu-dominio/api/notificaciones/webhook
router.post("/webhook", controller.webhookEntrante);

router.get("/", requireRol("admin"), controller.listarMensajes);

module.exports = router;
