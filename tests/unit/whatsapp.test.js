require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { clasificarRespuesta, variantesTelefono } = require("../../src/modules/notificaciones/notificaciones.service");
const { firmaValida, extraerMensajes } = require("../../src/modules/notificaciones/whatsapp/meta.webhook");

test("clasificarRespuesta: confirmaciones claras", () => {
  for (const texto of ["CONFIRMAR", "Confirmo mi cita", "si", "Sí", "ok", "listo", "Si, confirmo", "dale"]) {
    assert.equal(clasificarRespuesta(texto), "CONFIRMAR", `"${texto}"`);
  }
});

test("clasificarRespuesta: cancelaciones claras", () => {
  for (const texto of ["CANCELAR", "quiero cancelar", "cancelo", "no", "No."]) {
    assert.equal(clasificarRespuesta(texto), "CANCELAR", `"${texto}"`);
  }
});

test("clasificarRespuesta: ante la duda no hace nada (null)", () => {
  for (const texto of ["no puedo confirmar", "no se si confirmar", "hola", "gracias", "a que hora era?", "", null, undefined]) {
    assert.equal(clasificarRespuesta(texto), null, `"${texto}"`);
  }
});

test("clasificarRespuesta: una negacion de 'cancelar' no cancela", () => {
  for (const texto of ["no quiero cancelar", "No cancelar", "no la cancele", "nunca dije que quisiera cancelar", "tampoco voy a cancelar"]) {
    assert.equal(clasificarRespuesta(texto), null, `"${texto}"`);
  }
});

test("clasificarRespuesta: 'cancelar' dentro de una frase afirmativa si cancela", () => {
  for (const texto of ["por favor cancelar mi cita", "Cancelar", "quiero cancelar la cita de manana"]) {
    assert.equal(clasificarRespuesta(texto), "CANCELAR", `"${texto}"`);
  }
});

test("variantesTelefono: el mismo celular escrito de distintas formas", () => {
  const esperado = ["3001234567", "573001234567", "+573001234567"];
  for (const entrada of ["3001234567", "573001234567", "+573001234567", "+57 300 123 4567", "300-123-4567"]) {
    assert.deepEqual(variantesTelefono(entrada), esperado, entrada);
  }
});

test("variantesTelefono: un numero no colombiano se deja tal cual", () => {
  assert.deepEqual(variantesTelefono("15551234567"), ["15551234567"]);
});

// ---------------------------------------------------------------------------
// Webhook de Meta
// ---------------------------------------------------------------------------
function firmar(cuerpo, secreto = process.env.META_APP_SECRET) {
  return `sha256=${crypto.createHmac("sha256", secreto).update(cuerpo).digest("hex")}`;
}

test("firmaValida: acepta la firma correcta de Meta", () => {
  const cuerpo = Buffer.from('{"object":"whatsapp_business_account"}');
  assert.equal(firmaValida(cuerpo, firmar(cuerpo)), true);
});

test("firmaValida: rechaza firma incorrecta, ajena, ausente o cuerpo alterado", () => {
  const cuerpo = Buffer.from('{"a":1}');
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, "otro-secreto")), false);
  assert.equal(firmaValida(cuerpo, "sha256=abc"), false);
  assert.equal(firmaValida(cuerpo, undefined), false);
  assert.equal(firmaValida(undefined, firmar(cuerpo)), false);
  assert.equal(firmaValida(Buffer.from('{"a":2}'), firmar(cuerpo)), false);
});

test("firmaValida: sin META_APP_SECRET configurado rechaza todo", () => {
  const guardado = process.env.META_APP_SECRET;
  delete process.env.META_APP_SECRET;
  try {
    const cuerpo = Buffer.from("{}");
    assert.equal(firmaValida(cuerpo, firmar(cuerpo, guardado)), false);
  } finally {
    process.env.META_APP_SECRET = guardado;
  }
});

const envolver = (mensajes) => ({ entry: [{ changes: [{ value: { messages: mensajes } }] }] });

test("extraerMensajes: texto, boton de plantilla y respuesta interactiva", () => {
  const body = envolver([
    { from: "573001112222", type: "text", text: { body: "confirmo" } },
    { from: "573003334444", type: "button", button: { text: "CANCELAR", payload: "x" } },
    { from: "573005556666", type: "interactive", interactive: { button_reply: { title: "CONFIRMAR" } } },
  ]);
  assert.deepEqual(extraerMensajes(body), [
    { telefono: "573001112222", texto: "confirmo" },
    { telefono: "573003334444", texto: "CANCELAR" },
    { telefono: "573005556666", texto: "CONFIRMAR" },
  ]);
});

test("extraerMensajes: conserva el id del mensaje y el del aviso al que responde", () => {
  const body = envolver([
    { id: "wamid.A", from: "573001112222", type: "button", button: { text: "Cancelar" }, context: { from: "573000000000", id: "wamid.AVISO" } },
    { id: "wamid.B", from: "573003334444", type: "text", text: { body: "hola" } },
  ]);
  assert.deepEqual(extraerMensajes(body), [
    { telefono: "573001112222", texto: "Cancelar", id: "wamid.A", contextId: "wamid.AVISO" },
    { telefono: "573003334444", texto: "hola", id: "wamid.B" },
  ]);
});

test("extraerMensajes: ignora estados de entrega, tipos sin texto y cuerpos vacios", () => {
  const conEstados = { entry: [{ changes: [{ value: { statuses: [{ status: "read" }] } }] }] };
  assert.deepEqual(extraerMensajes(conEstados), []);
  assert.deepEqual(extraerMensajes(envolver([{ from: "573001112222", type: "image", image: {} }])), []);
  assert.deepEqual(extraerMensajes({}), []);
  assert.deepEqual(extraerMensajes(null), []);
});
