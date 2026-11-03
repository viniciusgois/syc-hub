-- AlterEnum
ALTER TYPE "PersonType" ADD VALUE 'FOREIGN';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressNumber" TEXT,
ADD COLUMN     "cityIbgeCode" TEXT,
ADD COLUMN     "cityReg" TEXT,
ADD COLUMN     "contactPerson" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "personType" "PersonType" NOT NULL DEFAULT 'LEGAL',
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "contact_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_notes_contactId_createdAt_idx" ON "contact_notes"("contactId", "createdAt");

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Documentos de contatos passam a ser armazenados somente com dígitos (exceto exterior)
UPDATE "contacts" SET "document" = regexp_replace("document", '\D', '', 'g') WHERE "document" IS NOT NULL;
