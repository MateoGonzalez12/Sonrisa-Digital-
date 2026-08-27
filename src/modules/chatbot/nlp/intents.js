// patrones para clasificar la intencion del mensaje del paciente.
module.exports = {
  SALUDO: [
    "hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "que tal", "hey",
  ],
  AGENDAR: [
    "agendar", "agenda", "reservar", "sacar cita", "pedir cita", "quiero una cita",
    "quiero agendar", "programar cita", "sacar una cita", "quisiera una cita",
    "necesito una cita", "quiero sacar cita",
  ],
  REPROGRAMAR: [
    "reprogramar", "cambiar mi cita", "mover mi cita", "cambiar la fecha", "cambiar hora",
    "reagendar", "modificar mi cita", "cambiar el horario",
  ],
  CANCELAR: [
    "cancelar", "anular", "ya no puedo ir", "no podre asistir", "no voy a poder ir",
    "cancelar mi cita", "quiero cancelar", "no puedo asistir",
  ],
  CONSULTAR_PROCEDIMIENTOS: [
    "procedimientos", "que servicios", "que tratamientos", "precio", "cuanto cuesta",
    "cuanto vale", "brackets", "alineadores", "ortodoncia", "cuanto dura", "informacion",
    "que ofrecen", "servicios tienen",
  ],
  VER_CITAS: [
    "mis citas", "ver mi cita", "tengo alguna cita", "cuando es mi cita", "consultar mi cita",
    "ver mis citas", "informacion de mi cita",
  ],
  DERIVAR_HUMANO: [
    "hablar con alguien", "persona real", "asesor", "humano", "quiero hablar con una persona",
  ],
};
