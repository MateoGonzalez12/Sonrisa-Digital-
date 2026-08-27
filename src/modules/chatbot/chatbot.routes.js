const { Router } = require("express");
const controller = require("./chatbot.controller");

const router = Router();

router.post("/iniciar", controller.iniciar);
router.post("/mensaje", controller.mensaje);

module.exports = router;
