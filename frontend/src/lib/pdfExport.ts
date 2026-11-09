import { formatDocument } from './documents';

/**
 * PDF dos relatórios (para enviar ao dono da empresa): A4 paisagem, cabeçalho com empresa, título,
 * filtros e "Gerado em", tabela com valores no padrão contábil, linha de total e numeração de páginas.
 * O jsPDF só é baixado quando alguém exporta.
 */

export type PdfRowStyle = 'normal' | 'section' | 'group' | 'result';

export interface PdfRow {
  cells: string[];
  style?: PdfRowStyle;
  /** Recuo da 1ª coluna (0 = sem recuo) */
  indent?: number;
}

export interface PdfTableOptions {
  fileName: string;
  company: { legalName: string; cnpj?: string | null };
  title: string;
  /** Período, regime e filtros aplicados */
  subtitle?: string;
  head: string[];
  body: PdfRow[];
  foot?: string[];
  /** Colunas alinhadas à direita (valores) */
  rightAligned: number[];
  /** Valores negativos "(1.234)" em vermelho (Painel) */
  redNegatives?: boolean;
  /** Largura fixa (pt) de colunas específicas */
  widths?: Record<number, number>;
  fontSize?: number;
}

const INK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const RED: [number, number, number] = [220, 38, 38];

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export async function exportTablePdf(o: PdfTableOptions) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;

  // Cabeçalho (1ª página)
  let y = margin + 8;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.setFontSize(17);
  doc.text(o.company.legalName.toUpperCase(), margin, y, { maxWidth: pageW - margin * 2 - 190 });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const when = stamp(new Date());
  doc.text(when, pageW - margin, y - 4, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text('Gerado em: ', pageW - margin - doc.getTextWidth(when), y - 4, { align: 'right' });
  if (o.company.cnpj) {
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(formatDocument(o.company.cnpj), margin, y);
  }
  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.setFontSize(14);
  doc.text(o.title, margin, y);
  if (o.subtitle) {
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(o.subtitle, margin, y, { maxWidth: pageW - margin * 2 });
  }

  const right = new Set(o.rightAligned);
  autoTable(doc, {
    startY: y + 12,
    margin: { left: margin, right: margin, top: margin, bottom: margin + 10 },
    head: [o.head],
    body: o.body.map((r) => r.cells),
    foot: o.foot ? [o.foot] : undefined,
    showFoot: 'lastPage',
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: o.fontSize ?? 8.5, textColor: INK, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, lineColor: LINE, lineWidth: { bottom: 0.5 }, overflow: 'linebreak' },
    headStyles: { fillColor: [240, 241, 243], fontStyle: 'bold', lineWidth: 0 },
    footStyles: { fontStyle: 'bold', fillColor: [248, 250, 252], lineWidth: { top: 0.8 } },
    columnStyles: Object.fromEntries(
      o.head.map((_, i) => [i, { halign: right.has(i) ? 'right' : 'left', ...(o.widths?.[i] ? { cellWidth: o.widths[i] } : {}) }]),
    ),
    didParseCell: (data) => {
      if (right.has(data.column.index)) data.cell.styles.halign = 'right';
      const text = Array.isArray(data.cell.text) ? data.cell.text.join(' ') : String(data.cell.text ?? '');
      if (data.section === 'body') {
        const row = o.body[data.row.index];
        if (row?.style === 'section') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [248, 250, 252];
        } else if (row?.style === 'group') {
          data.cell.styles.fontStyle = 'bold';
        } else if (row?.style === 'result') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [239, 246, 255];
        }
        if (data.column.index === 0 && row?.indent) data.cell.styles.cellPadding = { top: 4, bottom: 4, left: 5 + row.indent * 10, right: 5 };
      }
      if (o.redNegatives && data.section !== 'head' && /^\(.*\)/.test(text.trim())) data.cell.styles.textColor = RED;
    },
  });

  // Rodapé com numeração (depois da tabela, quando já se sabe o total de páginas)
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${o.company.legalName} · ${o.title}`, margin, pageH - 18);
    doc.text(`${p}/${pages}`, pageW - margin, pageH - 18, { align: 'right' });
  }
  doc.save(o.fileName);
}
