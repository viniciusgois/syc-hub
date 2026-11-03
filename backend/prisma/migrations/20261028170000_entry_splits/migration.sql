-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "bankScheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "splitsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "discountCategoryId" TEXT,
ADD COLUMN     "interestCategoryId" TEXT,
ADD COLUMN     "scheduledAtBank" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "discountCategoryId" TEXT,
ADD COLUMN     "interestCategoryId" TEXT;

-- CreateTable
CREATE TABLE "entry_splits" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "receivableId" TEXT,
    "payableId" TEXT,
    "transactionId" TEXT,
    "recurrenceId" TEXT,
    "categoryId" TEXT NOT NULL,
    "costCenterId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_splits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entry_splits_receivableId_idx" ON "entry_splits"("receivableId");

-- CreateIndex
CREATE INDEX "entry_splits_payableId_idx" ON "entry_splits"("payableId");

-- CreateIndex
CREATE INDEX "entry_splits_transactionId_idx" ON "entry_splits"("transactionId");

-- CreateIndex
CREATE INDEX "entry_splits_recurrenceId_idx" ON "entry_splits"("recurrenceId");

-- CreateIndex
CREATE INDEX "entry_splits_companyId_categoryId_idx" ON "entry_splits"("companyId", "categoryId");

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_interestCategoryId_fkey" FOREIGN KEY ("interestCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_discountCategoryId_fkey" FOREIGN KEY ("discountCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_interestCategoryId_fkey" FOREIGN KEY ("interestCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_discountCategoryId_fkey" FOREIGN KEY ("discountCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_splits" ADD CONSTRAINT "entry_splits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_splits" ADD CONSTRAINT "entry_splits_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_splits" ADD CONSTRAINT "entry_splits_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_splits" ADD CONSTRAINT "entry_splits_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_splits" ADD CONSTRAINT "entry_splits_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "recurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_splits" ADD CONSTRAINT "entry_splits_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_splits" ADD CONSTRAINT "entry_splits_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

