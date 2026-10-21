// Frases clave para clasificar la intencion del mensaje del paciente.
//
// Reglas de escritura (el clasificador normaliza ambos lados: sin tildes, en
// minusculas y sin signos):
//  - Una frase coincide cuando aparece al INICIO de una palabra, y puede seguir
//    de cualquier terminacion. Asi "cancel" cubre cancela, cancelar, cancelen,
//    cancelo... y "reprogram" cubre reprogramar, reprogramo, reprogramacion.
//  - Cuando varias frases coinciden en el mismo trozo del mensaje, vale la mas
//    larga ("reagendar" le gana a "agendar"; "tengo una cita" a "una cita").
//
// El ORDEN de las intenciones importa: ante un empate de puntaje gana la que
// esta primero. Van primero las que piden una accion concreta sobre una cita
// existente y al final las mas genericas (agendar y saludo).
module.exports = {
  REPROGRAMAR: [
    "reprogram", "reagend", "reprograma", "reprogramar",
    "cambiar mi cita", "cambiar la cita", "cambiar de cita", "cambio de cita",
    "cambiarla", "cambiarme la cita", "cambiar la fecha", "cambiar fecha", "cambio de fecha",
    "cambiar hora", "cambiar la hora", "cambio de hora", "cambiar el horario", "cambiar de horario",
    "cambiar el dia", "cambiar de dia", "cambiar para otro",
    "mover mi cita", "mover la cita", "moverla", "mover para", "mover mi",
    "pasar mi cita", "pasar la cita", "pasarla para", "pasarme la cita",
    "modificar mi cita", "modificar la cita", "modificar", "aplazar", "posponer", "adelantar mi cita",
    "me toca cambiar", "puedo cambiar", "quiero cambiar", "necesito cambiar",
  ],

  CANCELAR: [
    "cancel", "anul", "cancelar mi cita", "quiero cancelar",
    "ya no puedo ir", "no puedo ir", "no podre ir", "no podemos ir", "no voy a poder ir",
    "no podre asistir", "no voy a poder asistir", "no puedo asistir", "no voy a asistir",
    "no voy a ir", "ya no voy", "ya no quiero la cita", "no quiero la cita", "no necesito la cita",
    "me surgio un imprevisto", "imprevisto", "tengo un compromiso", "no alcanzo a llegar", "no alcanzo",
    "no llego", "no voy a llegar", "no podre llegar", "no puedo llegar",
    "dar de baja la cita", "quitar la cita", "eliminar la cita", "borrar la cita",
  ],

  VER_CITAS: [
    "mis citas", "ver mi cita", "ver mis citas", "tengo alguna cita", "cuando es mi cita",
    "consultar mi cita", "informacion de mi cita", "tengo cita", "tengo una cita",
    "cuando tengo cita", "a que hora es mi cita", "a que hora tengo", "a que hora era",
    "que dia es mi cita", "que dia tengo", "mi proxima cita", "revisar mi cita", "estado de mi cita",
    "cita pendiente", "citas pendientes", "citas agendadas", "cita agendada",
    "cuando me toca", "cuando es la cita", "a que hora es la cita", "que dia es la cita",
    "la cita que tengo", "recordarme mi cita", "recordar mi cita", "recordatorio de mi cita",
  ],

  DERIVAR_HUMANO: [
    "hablar con alguien", "persona real", "asesor", "humano", "quiero hablar con una persona",
    "hablar con una persona", "servicio al cliente", "atencion al cliente",
    "hablar con la doctora", "hablar con el doctor", "hablar con la dra", "hablar con la odontologa",
    "hablar con la recepcionista", "hablar con la secretaria", "hablar con un", "hablar con el consultorio",
    "me pueden llamar", "me puede llamar", "me llaman", "me llamas", "llamenme", "llamarme",
    "pasame con", "comunicarme con", "comunicar con", "contactar", "contacto con",
    "una persona", "recepcionista", "operador", "agente", "queja", "reclamo",
  ],

  CONSULTAR_PROCEDIMIENTOS: [
    "procedimientos", "procedimiento", "que servicios", "servicios", "que tratamientos", "tratamientos",
    "tratamiento", "que ofrecen", "ofrecen", "que hacen", "hacen", "realizan", "manejan",
    "precio", "precios", "cuanto cuesta", "cuanto cuestan", "cuanto vale", "cuanto valen", "cuanto es",
    "costo", "costos", "cobran", "tarifa", "tarifas", "que valor",
    "cuanto dura", "cuanto demora", "cuanto tiempo", "duracion",
    "informacion", "info",
    "brackets", "bracket", "braquets", "frenos", "alineadores", "invisalign", "ortodoncia", "ortodoncista",
    "endodoncia", "conducto", "limpieza", "blanqueamiento", "blanqueo", "implante", "implantes",
    "corona", "coronas", "protesis", "extraccion", "cirugia",
  ],

  AGENDAR: [
    "agendar", "agenda", "reservar", "reserva", "reservame", "sacar cita", "pedir cita", "quiero una cita",
    "quiero agendar", "programar cita", "sacar una cita", "quisiera una cita",
    "necesito una cita", "quiero sacar cita",
    "una cita", "dar cita", "darme cita", "dame cita", "me dan cita", "me das cita", "me regalan cita",
    "primera cita", "nueva cita", "otra cita", "cita para", "citas disponibles", "cita disponible",
    "disponibilidad", "hay cupo", "hay espacio", "hay turno", "turno", "cupo", "separar", "apartar",
    "quiero ir", "quisiera ir", "necesito ir", "cuando puedo ir", "para cuando hay",
    "quiero consulta", "necesito consulta", "consulta con", "valoracion", "revision", "chequeo",
    "me duele", "duele", "dolor", "muela", "diente", "caries", "emergencia", "urgencia", "urgente",
    "se me rompio", "se me cayo", "se me partio",
  ],

  SALUDO: [
    "hola", "holi", "buenas", "buenos dias", "buenas tardes", "buenas noches", "buen dia", "buena tarde",
    "buena noche", "que tal", "hey", "saludos", "como estas", "como esta", "como me va",
  ],
};
