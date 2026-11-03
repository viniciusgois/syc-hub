-- CreateTable
CREATE TABLE "entry_settlements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "receivableId" TEXT,
    "payableId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entry_settlements_transactionId_idx" ON "entry_settlements"("transactionId");

-- CreateIndex
CREATE INDEX "entry_settlements_receivableId_idx" ON "entry_settlements"("receivableId");

-- CreateIndex
CREATE INDEX "entry_settlements_payableId_idx" ON "entry_settlements"("payableId");

-- AddForeignKey
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_settlements" ADD CONSTRAINT "entry_settlements_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copia os vínculos existentes (transação -> conta a pagar/receber) para a nova tabela
INSERT INTO "entry_settlements" ("id", "companyId", "transactionId", "receivableId", "payableId", "amount")
SELECT gen_random_uuid()::text, "companyId", "id", "receivableId", "payableId", "amount"
FROM "transactions"
WHERE "receivableId" IS NOT NULL OR "payableId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_payableId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_receivableId_fkey";

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "payableId",
DROP COLUMN "receivableId";
