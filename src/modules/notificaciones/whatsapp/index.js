const env = require("../../../config/env");
const TwilioSandboxProvider = require("./twilioSandbox.provider");
const SimuladoProvider = require("./simulado.provider");
const MetaCloudApiProvider = require("./metaCloudApi.provider");

// Fabrica: elige el proveedor concreto segun WHATSAPP_PROVIDER en el .env.
// Cambiar de sandbox a produccion (Meta) es solo cambiar esta variable.
function crearProveedor() {
  switch (env.whatsappProvider) {
    case "twilio_sandbox":
      return new TwilioSandboxProvider();
    case "meta_cloud_api":
      return new MetaCloudApiProvider();
    case "simulado":
    default:
      return new SimuladoProvider();
  }
}

module.exports = crearProveedor();
