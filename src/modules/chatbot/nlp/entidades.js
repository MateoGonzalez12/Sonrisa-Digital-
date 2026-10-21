const { extraerFechaHora, quitarTildes } = require("../../../utils/fechas");

// Palabras del nombre de un procedimiento que no sirven para identificarlo
// ("dental" aparece en varios y en cualquier frase sobre dientes).
const PALABRAS_GENERICAS = new Set(["dental", "dentales", "dentadura"]);

// Como lo dice la gente cuando no usa el nombre del catalogo. Se indexa por el
// nombre del procedimiento (sin tildes y en minusculas); lo que el admin cree
// despues con otro nombre sigue funcionando por su propio nombre. Cada termino
// coincide al inicio de una palabra ("freno" cubre frenos).
const SINONIMOS = {
  ortodoncia: ["bracket", "braquet", "brakets", "freno", "alineador", "invisalign", "ortodoncista", "aparato"],
  "limpieza dental": ["profilaxis", "detartraje", "sarro", "higiene", "limpiar", "limpiez"],
  "implantes dentales": ["implante", "implant", "tornillo"],
  coronas: ["corona", "funda", "puente", "protesis"],
  endodoncia: ["endodon", "conducto", "nervio", "desvitaliz"],
};

function palabras(texto) {
  return quitarTildes(String(texto || ""))
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Raiz sencilla para tolerar plural/singular: "coronas" -> "corona".
function raiz(palabra) {
  return palabra.length > 4 && palabra.endsWith("s") ? palabra.slice(0, -1) : palabra;
}

// Extrae el procedimiento mencionado comparando el mensaje contra el nombre (y
// palabras sueltas del nombre, y sinonimos) de cada procedimiento del catalogo
// real almacenado en BD.
function extraerProcedimiento(textoOriginal, catalogo) {
  const texto = quitarTildes(String(textoOriginal || ""));

  // Coincidencia exacta
  const porNombreCompleto = catalogo.find((p) => texto.includes(quitarTildes(p.nombre)));
  if (porNombreCompleto) return porNombreCompleto;

  // Coincidencia por palabra clave: una palabra del nombre (en singular o plural)
  // o un sinonimo, al inicio de alguna palabra del mensaje.
  const dichas = palabras(textoOriginal);
  for (const procedimiento of catalogo) {
    const nombre = quitarTildes(procedimiento.nombre);
    const claves = [
      ...nombre.split(/\s+/).filter((w) => w.length > 4 && !PALABRAS_GENERICAS.has(w)).map(raiz),
      ...(SINONIMOS[nombre] || []),
    ];
    if (claves.some((clave) => dichas.some((dicha) => dicha.startsWith(clave)))) return procedimiento;
  }

  return null;
}

// Extrae fecha, hora y procedimiento en un solo paso a partir
// del mensaje libre del paciente.
function extraerEntidades(texto, catalogoProcedimientos = []) {
  const { fecha, hora, fechaHora } = extraerFechaHora(texto);
  const procedimiento = extraerProcedimiento(texto, catalogoProcedimientos);
  return { fecha, hora, fechaHora, procedimiento };
}

module.exports = { extraerEntidades, extraerProcedimiento };
