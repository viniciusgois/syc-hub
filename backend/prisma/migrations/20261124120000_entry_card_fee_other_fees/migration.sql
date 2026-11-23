-- Tarifa de cartão e demais tarifas como campos próprios (antes ficavam no "desconto")
ALTER TABLE "receivables" ADD COLUMN "cardFee" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "otherFees" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "cardFeeCategoryId" TEXT,
ADD COLUMN "otherFeesCategoryId" TEXT;

ALTER TABLE "payables" ADD COLUMN "cardFee" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "otherFees" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "cardFeeCategoryId" TEXT,
ADD COLUMN "otherFeesCategoryId" TEXT;

ALTER TABLE "receivables" ADD CONSTRAINT "receivables_cardFeeCategoryId_fkey" FOREIGN KEY ("cardFeeCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_otherFeesCategoryId_fkey" FOREIGN KEY ("otherFeesCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payables" ADD CONSTRAINT "payables_cardFeeCategoryId_fkey" FOREIGN KEY ("cardFeeCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payables" ADD CONSTRAINT "payables_otherFeesCategoryId_fkey" FOREIGN KEY ("otherFeesCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Categoria padrão de cada tarifa (só a sugestão do sistema; o usuário pode trocar e renomear).
-- Plano padrão: "Taxas de cartão e meios de pagamento" e "Tarifas bancárias". Planos vindos do Nibo: pelo nome.
WITH alvo AS (
  SELECT DISTINCT ON (c."companyId") c."id"
  FROM "categories" c
  WHERE c."type" = 'EXPENSE' AND NOT c."isGroup" AND c."isActive" AND c."systemKey" IS NULL
    AND (lower(translate(c."name", 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) LIKE '%tax%cart%' OR lower(translate(c."name", 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) LIKE '%tarifa%cart%')
    AND NOT EXISTS (SELECT 1 FROM "categories" o WHERE o."companyId" = c."companyId" AND o."systemKey" = 'CARD_FEE')
  ORDER BY c."companyId", (c."name" = 'Taxas de cartão e meios de pagamento') DESC, c."createdAt"
)
UPDATE "categories" SET "systemKey" = 'CARD_FEE' WHERE "id" IN (SELECT "id" FROM alvo);

WITH alvo AS (
  SELECT DISTINCT ON (c."companyId") c."id"
  FROM "categories" c
  WHERE c."type" = 'EXPENSE' AND NOT c."isGroup" AND c."isActive" AND c."systemKey" IS NULL
    AND lower(translate(c."name", 'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) LIKE 'tarifa%banc%'
    AND NOT EXISTS (SELECT 1 FROM "categories" o WHERE o."companyId" = c."companyId" AND o."systemKey" = 'OTHER_FEES')
  ORDER BY c."companyId", (c."name" = 'Tarifas bancárias') DESC, c."createdAt"
)
UPDATE "categories" SET "systemKey" = 'OTHER_FEES' WHERE "id" IN (SELECT "id" FROM alvo);
