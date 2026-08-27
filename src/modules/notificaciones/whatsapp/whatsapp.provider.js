// Interfaz que debe cumplir cualquier proveedor de WhatsApp (patron adaptador).
// RNF-03/RNF-04: el resto del sistema solo conoce este contrato, nunca los
// detalles de Twilio ni de Meta. Migrar de Twilio Sandbox a Meta Cloud API
// (produccion) consiste unicamente en crear otra clase que implemente
// "enviarMensaje" y registrarla en whatsapp/index.js - nada mas cambia.
class WhatsAppProvider {
  /**
   * @param {string} telefono - numero destino en formato E.164, ej. +573001234567
   * @param {string} texto - contenido del mensaje
   * @returns {Promise<{ id: string }>} identificador del mensaje en el proveedor
   */
  // eslint-disable-next-line no-unused-vars
  async enviarMensaje(telefono, texto) {
    throw new Error("enviarMensaje() debe ser implementado por el proveedor concreto");
  }
}

module.exports = WhatsAppProvider;
