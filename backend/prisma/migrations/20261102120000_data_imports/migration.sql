-- CreateTable
CREATE TABLE "data_imports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "importedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "summary" JSONB NOT NULL,
    "created" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_imports_companyId_createdAt_idx" ON "data_imports"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

