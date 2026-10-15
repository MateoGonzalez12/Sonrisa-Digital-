require("../helpers/entorno");
const test = require("node:test");
const assert = require("node:assert/strict");

const { clasificarIntencion } = require("../../src/modules/chatbot/nlp/clasificador");
const { extraerProcedimiento } = require("../../src/modules/chatbot/nlp/entidades");

test("clasificarIntencion: reconoce cada intencion del chatbot", () => {
  const casos = [
    ["hola", "SALUDO"],
    ["Buenas tardes", "SALUDO"],
    ["quiero agendar una cita", "AGENDAR"],
    ["necesito una cita", "AGENDAR"],
    ["quiero reprogramar mi cita", "REPROGRAMAR"],
    ["quiero cambiar mi cita", "REPROGRAMAR"],
    ["quiero cancelar mi cita", "CANCELAR"],
    ["no podre asistir", "CANCELAR"],
    ["cuanto cuesta la ortodoncia", "CONSULTAR_PROCEDIMIENTOS"],
    ["que servicios tienen", "CONSULTAR_PROCEDIMIENTOS"],
    ["ver mis citas", "VER_CITAS"],
    ["cuando es mi cita", "VER_CITAS"],
  ];
  for (const [mensaje, esperada] of casos) {
    assert.equal(clasificarIntencion(mensaje).intencion, esperada, `"${mensaje}"`);
  }
});

test("clasificarIntencion: pedir contacto humano (boton y frases libres)", () => {
  for (const mensaje of [
    "Hablar con una persona",
    "quiero hablar con una persona",
    "necesito un asesor",
    "servicio al cliente",
    "ATENCIÓN AL CLIENTE",
  ]) {
    assert.equal(clasificarIntencion(mensaje).intencion, "DERIVAR_HUMANO", `"${mensaje}"`);
  }
});

test("clasificarIntencion: ignora tildes y mayusculas", () => {
  assert.equal(clasificarIntencion("ANULAR MI CITA").intencion, "CANCELAR");
  assert.equal(clasificarIntencion("¿Cuánto cuesta?").intencion, "CONSULTAR_PROCEDIMIENTOS");
});

test("clasificarIntencion: lo que no entiende es AMBIGUO y sin confianza", () => {
  for (const mensaje of ["asdfgh", "", "   ", null, undefined]) {
    const r = clasificarIntencion(mensaje);
    assert.equal(r.intencion, "AMBIGUO", `"${mensaje}"`);
    assert.equal(r.confianza, 0);
  }
});

const catalogo = [
  { id: 1, nombre: "Ortodoncia" },
  { id: 2, nombre: "Limpieza dental" },
  { id: 3, nombre: "Ortopedia dentofacial" },
];

test("extraerProcedimiento: por nombre completo", () => {
  assert.equal(extraerProcedimiento("Agendar Limpieza dental", catalogo).id, 2);
  assert.equal(extraerProcedimiento("quiero ORTODONCIA", catalogo).id, 1);
});

test("extraerProcedimiento: por una palabra del nombre, sin tildes", () => {
  assert.equal(extraerProcedimiento("quiero una limpieza", catalogo).id, 2);
  assert.equal(extraerProcedimiento("ortopedia por favor", catalogo).id, 3);
});

test("extraerProcedimiento: sin coincidencia devuelve null", () => {
  assert.equal(extraerProcedimiento("hola buenas", catalogo), null);
});
