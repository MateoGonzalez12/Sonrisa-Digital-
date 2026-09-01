const { extraerFechaHora, quitarTildes } = require("../../../utils/fechas");

// Extrae el procedimiento mencionado comparando el mensaje
//contra el nombre (y palabras sueltas del nombre) de cada procedimiento del
//catalogo real almacenado en BD.
function extraerProcedimiento(textoOriginal, catalogo) {
  const texto = quitarTildes(textoOriginal);

  // Coincidencia exacta
  const porNombreCompleto = catalogo.find((p) => texto.includes(quitarTildes(p.nombre)));
  if (porNombreCompleto) return porNombreCompleto;

  // Coincidencia por palabra clave individual
  for (const procedimiento of catalogo) {
    const palabras = quitarTildes(procedimiento.nombre).split(/\s+/).filter((w) => w.length > 4);
    if (palabras.some((palabra) => texto.includes(palabra))) return procedimiento;
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
