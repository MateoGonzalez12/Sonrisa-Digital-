// Interfaz que debe cumplir cualquier proveedor de WhatsApp (patron adaptador).
// el resto del sistema solo conoce este contrato, nunca los
// detalles de Twilio ni de Meta. Migrar de Twilio Sandbox a Meta Cloud API
// (produccion) consiste unicamente en crear otra clase que implemente
// "enviarMensaje" y registrarla en whatsapp/index.js - nada mas cambia.
class WhatsAppProvider {
  /**
   * @param {string} telefono - numero destino en formato E.164, ej. +573001234567
   * @param {string} texto - contenido del mensaje
   * @returns {Promise<{ id: string }>} identificador del mensaje en el proveedor
   */
  // Eslint-disable-next-line no-unused-vars
  async enviarMensaje(telefono, texto) {
    throw new Error("enviarMensaje() debe ser implementado por el proveedor concreto");
  }

  /**
   * Envio mediante plantilla previamente aprobada.
   *
   * WhatsApp solo permite texto libre dentro de las 24 h siguientes al ultimo
   * mensaje del paciente. Fuera de esa ventana -el caso del recordatorio, que
   * sale un dia antes de la cita- el mensaje debe ir con una plantilla que
   * Meta haya aprobado. Los proveedores que no distinguen ese caso (Twilio
   * Sandbox, simulado) pueden reusar enviarMensaje con el texto ya compuesto.
   *
   * @param {string} telefono - numero destino en formato E.164
   * @param {object} plantilla
   * @param {string} plantilla.nombre - nombre de la plantilla aprobada
   * @param {string} [plantilla.idioma] - codigo de idioma, ej. "es"
   * @param {string[]} [plantilla.parametros] - valores para los {{1}}, {{2}}...
   * @param {string} plantilla.textoEquivalente - el mismo mensaje en texto plano,
   *        usado por los proveedores que no manejan plantillas y para dejar
   *        registro legible en la base de datos.
   * @returns {Promise<{ id: string }>}
   */
  async enviarPlantilla(telefono, plantilla) {
    // Comportamiento por defecto: los proveedores sin plantillas envian el
    // texto equivalente, de modo que agregar esta capacidad no obliga a
    // reescribir los proveedores existentes.
    return this.enviarMensaje(telefono, plantilla.textoEquivalente);
  }

  /**
   * Indica si el proveedor exige plantilla fuera de la ventana de 24 h.
   * Solo Meta Cloud API aplica esa restriccion.
   */
  requierePlantillaFueraDeVentana() {
    return false;
  }
}

module.exports = WhatsAppProvider;
