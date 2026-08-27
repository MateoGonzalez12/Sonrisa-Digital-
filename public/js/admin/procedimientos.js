requireAdminAuth();
montarSidebar("procedimientos");

async function cargarTabla() {
  const tbody = document.querySelector("#tablaProcedimientos tbody");
  try {
    const procedimientos = await Api.get("/api/procedimientos", { auth: "admin" });
    tbody.innerHTML = procedimientos
      .map(
        (p) => `<tr>
          <td>${p.nombre}</td>
          <td>${p.duracionMin} min</td>
          <td>${p.precio ? "$" + Number(p.precio).toLocaleString("es-CO") : "—"}</td>
          <td>${p.activo ? '<span class="status-pill confirmada">Activo</span>' : '<span class="status-pill cancelada">Inactivo</span>'}</td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-sm" onclick='editarProcedimiento(${JSON.stringify(p)})'>Editar</button>
            <button class="btn btn-danger btn-sm" onclick="eliminarProcedimiento(${p.id})">Desactivar</button>
          </td>
        </tr>`
      )
      .join("");
  } catch (err) {
    manejarErrorApi(err);
  }
}

function abrirModal(titulo) {
  document.getElementById("modalTitulo").textContent = titulo;
  document.getElementById("errorProcedimiento").style.display = "none";
  document.getElementById("modalProcedimiento").classList.add("open");
}

document.getElementById("btnNuevo").onclick = () => {
  document.getElementById("formProcedimiento").reset();
  document.getElementById("procedimientoId").value = "";
  document.getElementById("pActivo").checked = true;
  abrirModal("Nuevo procedimiento");
};

function editarProcedimiento(p) {
  document.getElementById("procedimientoId").value = p.id;
  document.getElementById("pNombre").value = p.nombre;
  document.getElementById("pDescripcion").value = p.descripcion || "";
  document.getElementById("pDuracion").value = p.duracionMin;
  document.getElementById("pPrecio").value = p.precio || "";
  document.getElementById("pActivo").checked = p.activo;
  abrirModal("Editar procedimiento");
}

async function eliminarProcedimiento(id, forzar) {
  if (!confirm("¿Desactivar este procedimiento? Dejará de ofrecerse a los pacientes.")) return;
  try {
    const resultado = await Api.del(`/api/procedimientos/${id}${forzar ? "?forzar=true" : ""}`, { auth: "admin" });
    if (resultado.eliminado === false) {
      if (confirm(`${resultado.advertencia}\n\n¿Deseas desactivarlo de todas formas?`)) {
        return eliminarProcedimiento(id, true);
      }
      return;
    }
    mostrarToast("Procedimiento desactivado.");
    cargarTabla();
  } catch (err) {
    manejarErrorApi(err);
  }
}

document.getElementById("cerrarModalProc").onclick = () => document.getElementById("modalProcedimiento").classList.remove("open");

document.getElementById("formProcedimiento").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("procedimientoId").value;
  const datos = {
    nombre: document.getElementById("pNombre").value.trim(),
    descripcion: document.getElementById("pDescripcion").value.trim(),
    duracionMin: Number(document.getElementById("pDuracion").value),
    precio: document.getElementById("pPrecio").value ? Number(document.getElementById("pPrecio").value) : null,
    activo: document.getElementById("pActivo").checked,
  };
  const errorBox = document.getElementById("errorProcedimiento");
  errorBox.style.display = "none";

  try {
    if (id) {
      await Api.put(`/api/procedimientos/${id}`, datos, { auth: "admin" });
    } else {
      await Api.post("/api/procedimientos", datos, { auth: "admin" });
    }
    document.getElementById("modalProcedimiento").classList.remove("open");
    mostrarToast("Procedimiento guardado.");
    cargarTabla();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.style.display = "block";
  }
});

cargarTabla();
