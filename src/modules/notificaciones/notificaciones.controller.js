const asyncHandler = require("../../utils/asyncHandler");
const prisma = require("../../db/prisma");
const service = require("./notificaciones.service");
const meta = require("./whatsapp/meta.webhook");

// Handshake de Meta al registrar el webhook: devuelve el challenge si el token coincide.
const verificarWebhook = (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (modo === "subscribe" && esperado && token === esperado) {
    return res.status(200).send(String(req.query["hub.challenge"] || ""));
  }
  return res.sendStatus(403);
};

// Mensajes de Meta ya aceptados y todavia en proceso. Se procesan en orden y sin
// que un error en uno impida los demas.
const enProceso = new Set();
function procesarEnSegundoPlano(mensajes) {
  const trabajo = (async () => {
    for (const m of mensajes) {
      try {
        await service.procesarRespuestaEntrante(m);
      } catch (err) {
        console.error("[webhook] error procesando respuesta:", err.message);
      }
    }
  })();
  enProceso.add(trabajo);
  trabajo.finally(() => enProceso.delete(trabajo));
  return trabajo;
}
// Para las pruebas: espera a que terminen los mensajes ya aceptados.
const esperarProcesamiento = () => Promise.all([...enProceso]);

// Respuestas de pacientes por WhatsApp. Meta envia JSON firmado; Twilio, un
// formulario con "From" y "Body".
const webhookEntrante = asyncHandler(async (req, res) => {
  if (req.body && req.body.object === "whatsapp_business_account") {
    if (!process.env.META_APP_SECRET) {
      console.error("[webhook] META_APP_SECRET sin configurar: se rechaza el mensaje de Meta.");
      return res.sendStatus(403);
    }
    if (!meta.firmaValida(req.rawBody, req.get("x-hub-signature-256"))) {
      return res.sendStatus(403);
    }
    // Siempre 200 y de inmediato: si Meta no recibe respuesta a tiempo (procesar
    // implica leer la base y mandar un WhatsApp, unos segundos), reenvia el mismo
    // mensaje. Asi fue como un "Cancelar" cancelo dos citas. El trabajo sigue
    // despues de responder.
    const mensajes = meta.extraerMensajes(req.body);
    res.sendStatus(200);
    return procesarEnSegundoPlano(mensajes);
  }

  // Twilio envia "From" como "whatsapp:+573001234567" y "Body" con el texto.
  const from = String(req.body.From || req.body.from || "").replace("whatsapp:", "");
  const texto = req.body.Body || req.body.body || "";
  if (from && texto) {
    await service.procesarRespuestaEntrante({ telefono: from, texto, id: req.body.MessageSid || undefined });
  }

  // Respuesta TwiML vacia: la respuesta real ya se envio via la API.
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

module.exports = { verificarWebhook, webhookEntrante, listarMensajes, esperarProcesamiento };
