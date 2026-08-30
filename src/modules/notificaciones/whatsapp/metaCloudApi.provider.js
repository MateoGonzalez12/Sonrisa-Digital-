const WhatsAppProvider = require("./whatsapp.provider");

// ---------------------------------------------------------------------------
// PROVEEDOR DE PRODUCCION: WhatsApp Cloud API (Meta)
// ---------------------------------------------------------------------------
// Documentacion: https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Regla clave del canal: solo se puede enviar texto libre dentro de las 24 h
// posteriores al ultimo mensaje del paciente. Fuera de esa ventana Meta
// rechaza el envio (error 131047) y hay que usar una plantilla aprobada.
// Como los pacientes de este sistema agendan por la web y no por WhatsApp, esa
// ventana normalmente ni siquiera se abre: por eso el recordatorio, los avisos
// de cambio y las alertas administrativas van siempre por plantilla.
// ---------------------------------------------------------------------------
class MetaCloudApiProvider extends WhatsAppProvider {
  constructor() {
    super();
    this.phoneNumberId = process.env.META_PHONE_NUMBER_ID || "";
    this.accessToken = process.env.META_ACCESS_TOKEN || "";
    this.apiVersion = process.env.META_API_VERSION || "v20.0";

    if (!this.phoneNumberId || !this.accessToken) {
      console.warn(
        "[whatsapp] META_PHONE_NUMBER_ID/META_ACCESS_TOKEN sin configurar. Los envios fallaran."
      );
    }
  }

  get url() {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  // Meta espera el numero en E.164 pero sin el signo "+" ni separadores.
  normalizar(telefono) {
    return String(telefono).replace(/[^\d]/g, "");
  }

  async publicar(cuerpo) {
    const respuesta = await fetch(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...cuerpo }),
    });

    const data = await respuesta.json().catch(() => null);

    if (!respuesta.ok) {
      const error = (data && data.error) || {};
      const detalle = error.message || JSON.stringify(data);
      const fallo = new Error(`Meta Cloud API (${respuesta.status}): ${detalle}`);
      fallo.codigoMeta = error.code;
      // 131047: fuera de la ventana de 24 h; hay que reintentar con plantilla.
      fallo.requierePlantilla = error.code === 131047;
      throw fallo;
    }

    return { id: (data.messages && data.messages[0] && data.messages[0].id) || "desconocido" };
  }

  async enviarMensaje(telefono, texto) {
    return this.publicar({
      to: this.normalizar(telefono),
      type: "text",
      text: { body: texto, preview_url: false },
    });
  }

  async enviarPlantilla(telefono, plantilla) {
    const componentes = [];

    if (plantilla.parametros && plantilla.parametros.length) {
      componentes.push({
        type: "body",
        parameters: plantilla.parametros.map((valor) => ({
          type: "text",
          text: String(valor),
        })),
      });
    }

    return this.publicar({
      to: this.normalizar(telefono),
      type: "template",
      template: {
        name: plantilla.nombre,
        language: { code: plantilla.idioma || "es" },
        ...(componentes.length ? { components: componentes } : {}),
      },
    });
  }

  requierePlantillaFueraDeVentana() {
    return true;
  }
}

module.exports = MetaCloudApiProvider;
