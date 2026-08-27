const WhatsAppProvider = require("./whatsapp.provider");

// Proveedor de respaldo: no envia nada externo, solo simula el envio
// (util para desarrollo local sin cuenta de Twilio, o si Twilio falla).
class SimuladoProvider extends WhatsAppProvider {
  async enviarMensaje(telefono, texto) {
    console.log(`[whatsapp:SIMULADO] -> ${telefono}: ${texto}`);
    return { id: `simulado-${Date.now()}` };
  }
}

module.exports = SimuladoProvider;
