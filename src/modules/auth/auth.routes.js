const { Router } = require("express");
const { loginAdmin, loginStaff, listarStaffParaLogin } = require("./auth.controller");

const router = Router();

router.post("/admin/login", loginAdmin);
router.post("/staff/login", loginStaff);
router.get("/staff/directorio", listarStaffParaLogin);

module.exports = router;
