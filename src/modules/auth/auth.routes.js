const { Router } = require("express");
const { loginAdmin, loginStaff, listarStaffParaLogin } = require("./auth.controller");
const { loginAdminLimiter, loginStaffLimiter } = require("../../middlewares/rateLimit");
const { requireRol } = require("./auth.middleware");
const webauthn = require("./webauthn/webauthn.controller");

const router = Router();

// El limitador va antes del controlador: frena la fuerza bruta sobre el PIN
// sin que el modulo de auth tenga que saber como se cuenta.
router.post("/admin/login", loginAdminLimiter, loginAdmin);
router.post("/staff/login", loginStaffLimiter, loginStaff);
router.get("/staff/directorio", listarStaffParaLogin);

// Biometria (Face ID / Touch ID).
// El registro exige sesion activa; el login es publico por definicion.
router.post("/staff/webauthn/registro/opciones", requireRol("staff"), webauthn.opcionesRegistro);
router.post("/staff/webauthn/registro/verificar", requireRol("staff"), webauthn.verificarRegistro);
router.get("/staff/webauthn/credenciales", requireRol("staff"), webauthn.listar);
router.delete("/staff/webauthn/credenciales/:id", requireRol("staff"), webauthn.eliminar);

router.post("/staff/webauthn/login/opciones", loginStaffLimiter, webauthn.opcionesLogin);
router.post("/staff/webauthn/login/verificar", loginStaffLimiter, webauthn.verificarLogin);

module.exports = router;
