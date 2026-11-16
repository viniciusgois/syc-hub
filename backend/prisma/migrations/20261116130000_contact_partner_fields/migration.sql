-- AlterTable: dados de sócio no contato (data de nascimento e qualificação)
ALTER TABLE "contacts" ADD COLUMN "birthDate" TIMESTAMP(3),
ADD COLUMN "qualification" TEXT;

-- Sócios criados pelo cadastro da empresa guardavam a qualificação (QSA da Receita) em "notes": move para o campo próprio
UPDATE "contacts"
SET "qualification" = "notes", "notes" = NULL
WHERE "type" = 'PARTNER'
  AND "notes" IS NOT NULL
  AND length("notes") <= 80
  AND position(E'\n' in "notes") = 0
  AND "notes" ~* '(s[óo]cio|administrador|diretor|presidente|titular|procurador|conselheiro|tesoureiro|acionista|cotista)';
