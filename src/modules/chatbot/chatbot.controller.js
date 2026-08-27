const asyncHandler = require("../../utils/asyncHandler");
const { AppError } = require("../../middlewares/errorHandler");
const service = require("./chatbot.service");

const iniciar = asyncHandler(async (req, res) => {
  res.json(await service.iniciarConversacion("web"));
});

const mensaje = asyncHandler(async (req, res) => {
  const { conversacionId, mensaje: texto } = req.body;
  if (!texto || !texto.trim()) throw new AppError("El mensaje no puede estar vacio", 400);
  res.json(await service.procesarMensaje({ conversacionId, mensaje: texto, canal: "web" }));
});

module.exports = { iniciar, mensaje };
