const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./notificaciones.controller");

const router = Router();

// Configura esta URL como "webhook de mensajes entrantes" en la consola de
// Twilio (Sandbox de WhatsApp) -> https://tu-dominio/api/notificaciones/webhook
router.post("/webhook", controller.webhookEntrante);

router.get("/", requireRol("admin"), controller.listarMensajes);

module.exports = router;
