const WhatsAppProvider = require("./whatsapp.provider");

// ---------------------------------------------------------------------------
// PLANTILLA PARA LA MIGRACION A META (PRODUCCION)
// ---------------------------------------------------------------------------
// Cuando tengan la cuenta de WhatsApp Business aprobada por Meta, solo hay que
// completar esta clase (la llamada HTTP es un POST muy similar a la de Twilio)
// y cambiar WHATSAPP_PROVIDER=meta_cloud_api en el .env. Ningun otro modulo
// del sistema necesita tocarse porque todos dependen de WhatsAppProvider, no
// de esta implementacion concreta.
//
// Documentacion oficial: https://developers.facebook.com/docs/whatsapp/cloud-api
// ---------------------------------------------------------------------------
class MetaCloudApiProvider extends WhatsAppProvider {
  constructor() {
    super();
    this.phoneNumberId = process.env.META_PHONE_NUMBER_ID || "";
    this.accessToken = process.env.META_ACCESS_TOKEN || "";
    this.apiVersion = process.env.META_API_VERSION || "v20.0";
  }

  async enviarMensaje(telefono, texto) {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const respuesta = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefono.replace(/[^\d]/g, ""),
        type: "text",
        text: { body: texto },
      }),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      throw new Error(`Error enviando mensaje via Meta Cloud API: ${detalle}`);
    }

    const data = await respuesta.json();
    return { id: data.messages?.[0]?.id || "desconocido" };
  }
}

module.exports = MetaCloudApiProvider;
