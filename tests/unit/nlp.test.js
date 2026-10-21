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

// Frases como las escribe un paciente de verdad: modismos, faltas de ortografia,
// frases cortas. Si alguna deja de reconocerse, se rompio el vocabulario.
test("clasificarIntencion: frases reales de pacientes", () => {
  const casos = [
    ["hola buenas", "SALUDO"], ["buenos dias", "SALUDO"], ["buenas tardes doctora", "SALUDO"], ["holi", "SALUDO"],
    ["quiero una cita", "AGENDAR"], ["necesito agendar para la otra semana", "AGENDAR"],
    ["me pueden dar cita", "AGENDAR"], ["una cita porfa", "AGENDAR"], ["hay citas disponibles", "AGENDAR"],
    ["quisiera separar un turno", "AGENDAR"], ["me duele una muela", "AGENDAR"],
    ["cuando puedo ir a consulta", "AGENDAR"], ["me dan un arreglo de caries", "AGENDAR"],
    ["tengo un dolor de diente fuerte", "AGENDAR"], ["quiero una valoracion", "AGENDAR"],
    ["ya no voy a poder ir", "CANCELAR"], ["cancela mi cita", "CANCELAR"], ["no puedo asistir mañana", "CANCELAR"],
    ["cancelen la cita porfa", "CANCELAR"], ["necesito anular", "CANCELAR"],
    ["me surgio un imprevisto no puedo ir", "CANCELAR"], ["ya no quiero la cita", "CANCELAR"],
    ["puedo cambiar mi cita", "REPROGRAMAR"], ["quiero mover la cita para otro dia", "REPROGRAMAR"],
    ["cambiarla para el viernes", "REPROGRAMAR"], ["reagendar", "REPROGRAMAR"],
    ["me toca cambiar la hora", "REPROGRAMAR"], ["necesito posponer mi cita", "REPROGRAMAR"],
    ["cuanto cuesta una limpieza", "CONSULTAR_PROCEDIMIENTOS"], ["que precio tiene la ortodoncia", "CONSULTAR_PROCEDIMIENTOS"],
    ["hacen blanqueamiento", "CONSULTAR_PROCEDIMIENTOS"], ["que servicios tienen", "CONSULTAR_PROCEDIMIENTOS"],
    ["cuanto dura el tratamiento", "CONSULTAR_PROCEDIMIENTOS"], ["tienen brackets", "CONSULTAR_PROCEDIMIENTOS"],
    ["quiero poner brackets", "CONSULTAR_PROCEDIMIENTOS"], ["cuanto vale una extraccion", "CONSULTAR_PROCEDIMIENTOS"],
    ["cuando es mi cita", "VER_CITAS"], ["a que hora tengo cita", "VER_CITAS"],
    ["tengo cita pendiente", "VER_CITAS"], ["mis citas", "VER_CITAS"], ["que dia es mi cita", "VER_CITAS"],
    ["quiero hablar con la doctora", "DERIVAR_HUMANO"], ["me pueden llamar", "DERIVAR_HUMANO"],
    ["necesito hablar con alguien", "DERIVAR_HUMANO"], ["pasame con una persona", "DERIVAR_HUMANO"],
  ];
  const fallos = casos
    .map(([mensaje, esperada]) => [mensaje, esperada, clasificarIntencion(mensaje).intencion])
    .filter(([, esperada, obtenida]) => esperada !== obtenida)
    .map(([mensaje, esperada, obtenida]) => `"${mensaje}": esperaba ${esperada}, dio ${obtenida}`);
  assert.deepEqual(fallos, []);
});

test("clasificarIntencion: una palabra dentro de otra mas especifica no suma a otra intencion", () => {
  // "reagendar" contiene "agendar"; "tengo una cita" contiene "una cita".
  assert.equal(clasificarIntencion("reagendar").intencion, "REPROGRAMAR");
  assert.equal(clasificarIntencion("tengo una cita").intencion, "VER_CITAS");
  assert.equal(clasificarIntencion("quiero agendar una cita").intencion, "AGENDAR");
});

test("clasificarIntencion: las frases de los botones del chat siguen funcionando", () => {
  const botones = [
    ["Agendar una cita", "AGENDAR"], ["Agendar una nueva", "AGENDAR"], ["Agendar otra cita", "AGENDAR"],
    ["Ver mis citas", "VER_CITAS"], ["Reprogramar", "REPROGRAMAR"], ["Cancelar cita", "CANCELAR"],
    ["Hablar con una persona", "DERIVAR_HUMANO"],
  ];
  for (const [boton, esperada] of botones) {
    assert.equal(clasificarIntencion(boton).intencion, esperada, `"${boton}"`);
  }
});

test("clasificarIntencion: ante un empate ganan las acciones sobre las genericas (no el saludo)", () => {
  // "como esta" (saludo) y "precio" (consulta) suman lo mismo: debe ganar la consulta.
  assert.equal(clasificarIntencion("como esta el precio").intencion, "CONSULTAR_PROCEDIMIENTOS");
  // no se confunde con otra palabra que la contenga ("cita" en "solicitar")
  assert.equal(clasificarIntencion("quiero solicitar informacion").intencion, "CONSULTAR_PROCEDIMIENTOS");
});

const catalogo = [
  { id: 1, nombre: "Ortodoncia" },
  { id: 2, nombre: "Limpieza dental" },
  { id: 3, nombre: "Ortopedia dentofacial" },
];

const catalogoReal = [
  { id: 1, nombre: "Coronas" },
  { id: 2, nombre: "Endodoncia" },
  { id: 3, nombre: "Implantes dentales" },
  { id: 4, nombre: "Limpieza dental" },
  { id: 5, nombre: "Ortodoncia" },
];

test("extraerProcedimiento: singular, plural y sinonimos de la gente", () => {
  const casos = [
    ["quiero una corona", 1], ["necesito unas coronas", 1], ["una funda para el diente", 1],
    ["necesito un tratamiento de conducto", 2], ["me van a matar el nervio", 2], ["endodoncia", 2],
    ["implante", 3], ["quiero un implante", 3],
    ["me interesa la limpieza", 4], ["profilaxis", 4],
    ["me quiero poner frenos", 5], ["quiero brackets", 5], ["alineadores invisibles", 5],
  ];
  for (const [mensaje, id] of casos) {
    const encontrado = extraerProcedimiento(mensaje, catalogoReal);
    assert.equal(encontrado && encontrado.id, id, `"${mensaje}"`);
  }
});

test("extraerProcedimiento: 'dental' solo no identifica ningun procedimiento", () => {
  assert.equal(extraerProcedimiento("tengo un problema dental", catalogoReal), null);
  assert.equal(extraerProcedimiento("quiero blanqueamiento", catalogoReal), null);
});

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
