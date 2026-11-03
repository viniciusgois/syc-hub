-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('RECURRING', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "RecurrenceStatus" AS ENUM ('ACTIVE', 'ENDED');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'LOST';

-- AlterEnum
ALTER TYPE "TransactionOrigin" ADD VALUE 'SETTLEMENT';

-- AlterTable
ALTER TABLE "payables" DROP COLUMN "paidAmount",
ADD COLUMN     "expectedDate" TIMESTAMP(3),
ADD COLUMN     "installmentNumber" INTEGER,
ADD COLUMN     "installmentTotal" INTEGER,
ADD COLUMN     "isStarred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurrenceId" TEXT,
ADD COLUMN     "settledAmount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ALTER COLUMN "discount" SET NOT NULL,
ALTER COLUMN "interestFine" SET NOT NULL;

-- AlterTable
ALTER TABLE "receivables" DROP COLUMN "receivedAmount",
ADD COLUMN     "expectedDate" TIMESTAMP(3),
ADD COLUMN     "installmentNumber" INTEGER,
ADD COLUMN     "installmentTotal" INTEGER,
ADD COLUMN     "isStarred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recurrenceId" TEXT,
ADD COLUMN     "settledAmount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ALTER COLUMN "discount" SET NOT NULL,
ALTER COLUMN "interestFine" SET NOT NULL;

-- CreateTable
CREATE TABLE "recurrences" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "type" "RecurrenceType" NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "contactId" TEXT,
    "categoryId" TEXT,
    "costCenterId" TEXT,
    "description" TEXT NOT NULL,
    "documentNumber" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "occurrences" INTEGER,
    "status" "RecurrenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurrences_companyId_direction_status_idx" ON "recurrences"("companyId", "direction", "status");

-- CreateIndex
CREATE INDEX "payables_recurrenceId_idx" ON "payables"("recurrenceId");

-- CreateIndex
CREATE INDEX "receivables_recurrenceId_idx" ON "receivables"("recurrenceId");

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

