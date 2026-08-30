-- CreateTable
CREATE TABLE "credenciales_webauthn" (
    "id" SERIAL NOT NULL,
    "odontologoId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "apodo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUso" TIMESTAMP(3),

    CONSTRAINT "credenciales_webauthn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripciones_push" (
    "id" SERIAL NOT NULL,
    "odontologoId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoEnvio" TIMESTAMP(3),

    CONSTRAINT "suscripciones_push_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credenciales_webauthn_credentialId_key" ON "credenciales_webauthn"("credentialId");

-- CreateIndex
CREATE INDEX "credenciales_webauthn_odontologoId_idx" ON "credenciales_webauthn"("odontologoId");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_push_endpoint_key" ON "suscripciones_push"("endpoint");

-- CreateIndex
CREATE INDEX "suscripciones_push_odontologoId_idx" ON "suscripciones_push"("odontologoId");

-- AddForeignKey
ALTER TABLE "credenciales_webauthn" ADD CONSTRAINT "credenciales_webauthn_odontologoId_fkey" FOREIGN KEY ("odontologoId") REFERENCES "odontologos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suscripciones_push" ADD CONSTRAINT "suscripciones_push_odontologoId_fkey" FOREIGN KEY ("odontologoId") REFERENCES "odontologos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
