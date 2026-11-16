-- AlterTable: site, Instagram, Google e início do contrato da empresa
ALTER TABLE "companies" ADD COLUMN "website" TEXT,
ADD COLUMN "instagram" TEXT,
ADD COLUMN "googleUrl" TEXT,
ADD COLUMN "contractStartDate" TIMESTAMP(3);
