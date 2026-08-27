-- CreateEnum
CREATE TYPE "RolStaff" AS ENUM ('ODONTOLOGO', 'AUXILIAR');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'COMPLETADA', 'NO_ASISTIO');

-- CreateEnum
CREATE TYPE "DireccionMensaje" AS ENUM ('ENTRANTE', 'SALIENTE');

-- CreateTable
CREATE TABLE "pacientes" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "cedula" TEXT NOT NULL,
    "telefono" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedimientos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "duracionMin" INTEGER NOT NULL DEFAULT 30,
    "precio" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procedimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odontologos" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "RolStaff" NOT NULL DEFAULT 'ODONTOLOGO',
    "pinHash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "odontologos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horarios_odontologo" (
    "id" SERIAL NOT NULL,
    "odontologoId" INTEGER NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,

    CONSTRAINT "horarios_odontologo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueos_horario" (
    "id" SERIAL NOT NULL,
    "odontologoId" INTEGER,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueos_horario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" SERIAL NOT NULL,
    "pacienteId" INTEGER NOT NULL,
    "odontologoId" INTEGER NOT NULL,
    "procedimientoId" INTEGER NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'PENDIENTE',
    "origen" TEXT NOT NULL DEFAULT 'chatbot',
    "notasAdmin" TEXT,
    "recordatorioEnviado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_whatsapp" (
    "id" SERIAL NOT NULL,
    "citaId" INTEGER,
    "telefono" TEXT NOT NULL,
    "direccion" "DireccionMensaje" NOT NULL,
    "tipo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "proveedorMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversaciones_chatbot" (
    "id" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'web',
    "telefono" TEXT,
    "estado" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversaciones_chatbot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_cedula_key" ON "pacientes"("cedula");

-- CreateIndex
CREATE UNIQUE INDEX "citas_odontologoId_fechaHora_key" ON "citas"("odontologoId", "fechaHora");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- AddForeignKey
ALTER TABLE "horarios_odontologo" ADD CONSTRAINT "horarios_odontologo_odontologoId_fkey" FOREIGN KEY ("odontologoId") REFERENCES "odontologos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_horario" ADD CONSTRAINT "bloqueos_horario_odontologoId_fkey" FOREIGN KEY ("odontologoId") REFERENCES "odontologos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_odontologoId_fkey" FOREIGN KEY ("odontologoId") REFERENCES "odontologos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_procedimientoId_fkey" FOREIGN KEY ("procedimientoId") REFERENCES "procedimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_whatsapp" ADD CONSTRAINT "mensajes_whatsapp_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
