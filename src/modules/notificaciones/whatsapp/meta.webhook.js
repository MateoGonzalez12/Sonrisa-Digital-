const crypto = require("crypto");

// Meta firma cada POST con HMAC-SHA256 del cuerpo crudo usando el App Secret.
// Sin validarla, cualquiera podria confirmar o cancelar citas con una peticion falsa.
function firmaValida(rawBody, cabecera) {
  const secreto = process.env.META_APP_SECRET;
  if (!secreto || !rawBody || !cabecera) return false;
  const esperada = `sha256=${crypto.createHmac("sha256", secreto).update(rawBody).digest("hex")}`;
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(cabecera));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Devuelve [{ telefono, texto, id?, contextId? }] con los mensajes entrantes del
// payload de Meta. Cubre texto normal y respuestas por boton (plantilla o
// interactivo); ignora los "statuses" (entregado/leido).
//  - id: identificador del mensaje; permite descartar los que Meta reenvia.
//  - contextId: id del mensaje al que el paciente respondio (boton o cita de un
//    aviso); permite saber a que cita se refiere sin adivinar.
function extraerMensajes(body) {
  const mensajes = [];
  for (const entrada of (body && body.entry) || []) {
    for (const cambio of entrada.changes || []) {
      for (const m of (cambio.value && cambio.value.messages) || []) {
        let texto = null;
        if (m.type === "text") texto = m.text && m.text.body;
        else if (m.type === "button") texto = m.button && (m.button.text || m.button.payload);
        else if (m.type === "interactive" && m.interactive) {
          const r = m.interactive.button_reply || m.interactive.list_reply;
          texto = r && r.title;
        }
        if (m.from && texto) {
          const mensaje = { telefono: m.from, texto };
          if (m.id) mensaje.id = m.id;
          if (m.context && m.context.id) mensaje.contextId = m.context.id;
          mensajes.push(mensaje);
        }
      }
    }
  }
  return mensajes;
}

module.exports = { firmaValida, extraerMensajes };
