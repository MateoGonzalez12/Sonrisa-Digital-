const asyncHandler = require("../../utils/asyncHandler");
const prisma = require("../../db/prisma");
const service = require("./notificaciones.service");

// Webhook que Twilio (o Meta Cloud API mas adelante) invoca cuando el
// paciente responde un mensaje de WhatsApp. RF-11/RF-12.
const webhookEntrante = asyncHandler(async (req, res) => {
  // Twilio envia "From" como "whatsapp:+573001234567" y "Body" con el texto.
  const from = String(req.body.From || req.body.from || "").replace("whatsapp:", "");
  const texto = req.body.Body || req.body.body || "";

  if (from && texto) {
    await service.procesarRespuestaEntrante({ telefono: from, texto });
  }

  // Respuesta TwiML vacia: la respuesta real ya se envio via la API (para
  // mantener un unico camino de envio/registro, sea recordatorio o respuesta).
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");
});

const listarMensajes = asyncHandler(async (req, res) => {
  const mensajes = await prisma.mensajeWhatsapp.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { cita: { include: { paciente: true } } },
  });
  res.json(mensajes);
});

module.exports = { webhookEntrante, listarMensajes };
