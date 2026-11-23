-- Categorias que o sistema usa por função (juros/multa, desconto, transferência) passam a ser achadas por uma chave,
-- não pelo nome: o usuário pode renomear e mover essas categorias livremente.
ALTER TABLE "categories" ADD COLUMN "systemKey" TEXT;

UPDATE "categories" SET "systemKey" = 'RECEIVABLE_INTEREST' WHERE "isSystem" AND "name" = 'Multas recebidas';
UPDATE "categories" SET "systemKey" = 'RECEIVABLE_DISCOUNT' WHERE "isSystem" AND "name" = 'Descontos concedidos';
UPDATE "categories" SET "systemKey" = 'PAYABLE_INTEREST'    WHERE "isSystem" AND "name" = 'Multas pagas';
UPDATE "categories" SET "systemKey" = 'PAYABLE_DISCOUNT'    WHERE "isSystem" AND "name" = 'Descontos obtidos';
UPDATE "categories" SET "systemKey" = 'TRANSFER'            WHERE "isSystem" AND "type" = 'TRANSFER' AND "section" IS NULL;

-- Se alguma empresa tiver duas com o mesmo papel, fica só a mais antiga marcada
UPDATE "categories" c SET "systemKey" = NULL
WHERE c."systemKey" IS NOT NULL AND EXISTS (
  SELECT 1 FROM "categories" o
  WHERE o."companyId" = c."companyId" AND o."systemKey" = c."systemKey"
    AND (o."createdAt" < c."createdAt" OR (o."createdAt" = c."createdAt" AND o."id" < c."id"))
);

CREATE UNIQUE INDEX "categories_companyId_systemKey_key" ON "categories"("companyId", "systemKey");
