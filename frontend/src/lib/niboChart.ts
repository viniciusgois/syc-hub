import { DRESection } from '../types';

/** Categoria do plano do Nibo lida do PDF (Configurações › Categorias, salvo como PDF pelo navegador) */
export interface ChartItem {
  section: DRESection;
  group: string | null;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  /** Cadeado no Nibo: categoria do sistema */
  locked: boolean;
}

export interface PdfText {
  str: string;
  x: number;
  y: number;
  /** Fonte monoespaçada: é o ícone do cadeado */
  mono: boolean;
  /** Fonte serifada: cabeçalho/rodapé que o navegador põe na impressão */
  serif: boolean;
}

export interface PdfPage {
  width: number;
  items: PdfText[];
}

const norm = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const SECTIONS: Record<string, DRESection> = {
  'receitas operacionais': 'OPERATING_REVENUE',
  'custos operacionais': 'OPERATING_COSTS',
  'despesas operacionais e outras receitas': 'OPERATING_EXPENSES',
  'atividades de investimento': 'INVESTING',
  'atividades de financiamento': 'FINANCING',
};
const NOISE = new Set(['grupo vazio', 'subgrupo vazio']);
const ARROWS: Record<string, ChartItem['type']> = { '↑': 'INCOME', '↓': 'EXPENSE' };

/**
 * Monta o plano pela posição do texto: seção em maiúsculas mais à esquerda, categoria com seta,
 * subgrupo sem seta no mesmo recuo das categorias, e categorias do subgrupo com a seta mais recuada.
 * (A ordem do texto no PDF vem embaralhada; a posição não.)
 */
export function parseNiboChart(pages: PdfPage[]): { items: ChartItem[]; ignored: string[] } {
  type Line = { x: number; text: string; arrow: ChartItem['type'] | null; arrowX: number; locked: boolean };
  const allLines: Line[][] = pages.map((page) => {
    const usable = page.items.filter((i) => !i.serif && i.x < page.width * 0.6);
    const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: PdfText[][] = [];
    for (const it of sorted) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= 3);
      if (row) row.push(it);
      else rows.push([it]);
    }
    return rows
      .map((row) => {
        // Ícones (arrastar, editar, excluir) vêm como caracteres de uso privado: não são texto
        const parts = row
          .sort((a, b) => a.x - b.x)
          .map((i) => ({ ...i, str: i.str.replace(/[\uE000-\uF8FF\u200B-\u200D\uFEFF]/g, '') }))
          .filter((i) => i.str.trim() && !i.mono && !NOISE.has(norm(i.str)));
        const locked = row.some((i) => i.mono);
        if (!parts.length) return null;
        const arrowPart = parts.find((p) => ARROWS[p.str.trim()[0]]);
        const arrow = arrowPart ? ARROWS[arrowPart.str.trim()[0]] : null;
        const text = parts
          .map((p) => (p === arrowPart ? p.str.trim().slice(1) : p.str))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { x: parts[0].x, text, arrow, arrowX: arrowPart?.x ?? parts[0].x, locked };
      })
      .filter((l): l is Line => !!l && !!l.text);
  });

  const lines = allLines.flat();
  const arrowXs = lines.filter((l) => l.arrow).map((l) => l.arrowX);
  if (!arrowXs.length) return { items: [], ignored: [] };
  const topX = Math.min(...arrowXs);

  const items: ChartItem[] = [];
  const ignored: string[] = [];
  let section: DRESection | null = null;
  let group: string | null = null;
  for (const l of lines) {
    const asSection = SECTIONS[norm(l.text)];
    if (asSection && !l.arrow) {
      section = asSection;
      group = null;
      continue;
    }
    if (!section) continue; // nome da empresa, CNPJ, "Categorias"...
    if (l.arrow) {
      const child = l.arrowX > topX + 8;
      if (!child) group = null;
      items.push({ section, group: child ? group : null, name: l.text, type: l.arrow, locked: l.locked });
    } else if (Math.abs(l.x - topX) <= 8) {
      group = l.text; // subgrupo
    } else {
      ignored.push(l.text);
    }
  }
  return { items, ignored };
}

/** Lê o PDF no navegador (o pdf.js só é baixado quando esta função é usada) */
export async function readNiboChartPdf(file: File) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily: string }>;
    pages.push({
      width: page.getViewport({ scale: 1 }).width,
      items: content.items
        .filter((i): i is typeof i & { str: string; transform: number[]; fontName: string } => 'str' in i)
        .map((i) => {
          const family = styles[i.fontName]?.fontFamily ?? '';
          return { str: i.str, x: i.transform[4], y: i.transform[5], mono: family === 'monospace', serif: family === 'serif' };
        }),
    });
  }
  return parseNiboChart(pages);
}
