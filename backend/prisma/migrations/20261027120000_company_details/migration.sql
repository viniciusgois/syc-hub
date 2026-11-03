-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('LEGAL', 'NATURAL');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "addressComplement" TEXT,
ADD COLUMN     "addressNumber" TEXT,
ADD COLUMN     "cei" TEXT,
ADD COLUMN     "cityIbgeCode" TEXT,
ADD COLUMN     "cnae" TEXT,
ADD COLUMN     "cnaeDescription" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "personType" "PersonType" NOT NULL DEFAULT 'LEGAL',
ADD COLUMN     "segment" TEXT;


-- CNPJ/CPF passam a ser armazenados somente com dígitos
UPDATE "companies" SET "cnpj" = regexp_replace("cnpj", '\D', '', 'g');
