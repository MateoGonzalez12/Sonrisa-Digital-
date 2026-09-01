const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./procedimientos.controller");

const router = Router();

// Publico (landing + chatbot necesitan leer el catalogo)
router.get("/", controller.listar);
router.get("/:id", controller.obtener);

// Solo admin puede modificar el catalogo
router.post("/", requireRol("admin"), controller.crear);
router.put("/:id", requireRol("admin"), controller.actualizar);
router.delete("/:id", requireRol("admin"), controller.eliminar);

module.exports = router;
