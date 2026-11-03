-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "holderType" "PersonType" NOT NULL DEFAULT 'LEGAL';

