const twilio = require("twilio");
const WhatsAppProvider = require("./whatsapp.provider");
const env = require("../../../config/env");

// Envia mensajes reales de WhatsApp a traves del Sandbox gratuito de Twilio.
// Requiere que el numero destino se haya unido al sandbox una vez (enviando el
// codigo "join <palabra>" al numero de Twilio) - es la via mas rapida para
// tener WhatsApp real sin pasar por la revision de Meta Business.
class TwilioSandboxProvider extends WhatsAppProvider {
  constructor() {
    super();
    if (!env.twilio.accountSid || !env.twilio.authToken) {
      console.warn(
        "[whatsapp] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN no configurados. " +
          "Los envios de WhatsApp fallaran hasta que completes el .env"
      );
    }
    this.client = twilio(env.twilio.accountSid, env.twilio.authToken);
  }

  formatearNumero(telefono) {
    const limpio = String(telefono).replace(/[^\d+]/g, "");
    const conCodigo = limpio.startsWith("+") ? limpio : `+57${limpio.replace(/^0+/, "")}`;
    return `whatsapp:${conCodigo}`;
  }

  async enviarMensaje(telefono, texto) {
    const mensaje = await this.client.messages.create({
      from: env.twilio.from,
      to: this.formatearNumero(telefono),
      body: texto,
    });
    return { id: mensaje.sid };
  }
}

module.exports = TwilioSandboxProvider;
