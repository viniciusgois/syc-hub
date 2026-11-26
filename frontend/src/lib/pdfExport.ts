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
  /** Título de seção: o 1º texto ocupa a largura toda da tabela */
  span?: boolean;
}

/** Quadro de resumo acima do gráfico/tabela (ex.: Saldo anterior, Entradas, Saídas, Saldo final) */
export interface PdfSummaryItem {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}

/** Gráfico de linha simples (saldo por dia); séries com `dashed` saem tracejadas (projeção) */
export interface PdfChart {
  labels: string[];
  series: { name: string; values: (number | null)[]; dashed?: boolean; fill?: boolean }[];
}

/** Tabela extra depois da principal (ex.: Próximos a receber / a pagar no Resumo) */
export interface PdfSection {
  title: string;
  head: string[];
  body: PdfRow[];
  foot?: string[];
  rightAligned: number[];
  widths?: Record<number, number>;
  emptyText?: string;
}

export interface PdfTableOptions {
  fileName: string;
  company: { legalName: string; cnpj?: string | null; logoUrl?: string | null };
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
  summary?: PdfSummaryItem[];
  chart?: PdfChart;
  /** Título da tabela principal (quando há quadros/gráfico acima) */
  tableTitle?: string;
  sections?: PdfSection[];
  /** Colunas coloridas: entradas em verde e saídas em vermelho (ex.: Entrada/Saída do extrato) */
  colorColumns?: { positive?: number[]; negative?: number[] };
}

const INK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const RED: [number, number, number] = [220, 38, 38];
const GREEN: [number, number, number] = [4, 120, 87];
const BLUE: [number, number, number] = [74, 144, 226];
const BLUE_FILL: [number, number, number] = [230, 240, 252];

const compactNumber = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/** Escala "redonda" para o eixo do gráfico */
function niceScale(min: number, max: number, ticks = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((v) => v >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { lo, hi, step };
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export async function exportTablePdf(o: PdfTableOptions) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;

  // Cabeçalho (1ª página): logo (se houver), razão social, CNPJ e "Gerado em"
  let y = margin + 8;
  let left = margin;
  const logo = o.company.logoUrl;
  if (logo && /^data:image\/(png|jpe?g);base64,/i.test(logo)) {
    try {
      doc.addImage(logo, /png/i.test(logo.slice(0, 20)) ? 'PNG' : 'JPEG', margin, y - 14, 34, 34);
      left = margin + 44;
    } catch {
      // logo em formato não suportado: segue sem
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.setFontSize(17);
  doc.text(o.company.legalName.toUpperCase(), left, y, { maxWidth: pageW - left - margin - 190 });
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
    doc.text(formatDocument(o.company.cnpj), left, y);
  }
  y = Math.max(y, left > margin ? margin + 28 : y) + 20;
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

  y += 12;

  // Quadros de resumo
  if (o.summary?.length) {
    const gap = 10;
    const w = (pageW - margin * 2 - gap * (o.summary.length - 1)) / o.summary.length;
    o.summary.forEach((item, i) => {
      const x = margin + i * (w + gap);
      doc.setDrawColor(...LINE);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, w, 40, 4, 4, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(item.label, x + 10, y + 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...(item.tone === 'negative' ? RED : item.tone === 'positive' ? GREEN : INK));
      doc.text(item.value, x + 10, y + 31);
    });
    y += 54;
  }

  // Gráfico (saldo por dia; projeção tracejada)
  const chart = o.chart;
  if (chart && chart.labels.length > 1) {
    const h = 130;
    const axisW = 52;
    const x0 = margin + axisW;
    const w = pageW - margin * 2 - axisW;
    const values = chart.series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length) {
      const top = y + (chart.series.length > 1 ? 12 : 0);
      const { lo, hi, step } = niceScale(Math.min(...values), Math.max(...values));
      const yOf = (v: number) => top + h - ((v - lo) / (hi - lo)) * h;
      const xOf = (i: number) => x0 + (i / (chart.labels.length - 1)) * w;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.setLineWidth(0.5);
      for (let v = lo; v <= hi + step / 2; v += step) {
        doc.setDrawColor(...LINE);
        doc.line(x0, yOf(v), x0 + w, yOf(v));
        doc.text(compactNumber(v), x0 - 6, yOf(v) + 2.5, { align: 'right' });
      }
      for (const s of chart.series) {
        const pts = s.values.map((v, i) => (v === null ? null : ([xOf(i), yOf(v)] as [number, number]))).filter((p): p is [number, number] => !!p);
        if (pts.length < 2) continue;
        if (s.fill) {
          const base = yOf(Math.max(lo, Math.min(0, hi)));
          const poly: [number, number][] = [[pts[0][0], base], ...pts, [pts[pts.length - 1][0], base]];
          doc.setFillColor(...BLUE_FILL);
          doc.lines(poly.slice(1).map((p, i) => [p[0] - poly[i][0], p[1] - poly[i][1]]), poly[0][0], poly[0][1], [1, 1], 'F', true);
        }
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(1.4);
        if (s.dashed) doc.setLineDashPattern([4, 3], 0);
        for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        doc.setLineDashPattern([], 0);
      }
      // Rótulos do eixo X (até ~10); o último sempre aparece e tira o anterior se ficar colado
      const every = Math.max(1, Math.ceil(chart.labels.length / 10));
      const last = chart.labels.length - 1;
      const marks = chart.labels.map((_, i) => i).filter((i) => i % every === 0 && (i === last || last - i >= every * 0.6));
      if (!marks.includes(last)) marks.push(last);
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      marks.forEach((i) => doc.text(chart.labels[i], xOf(i), top + h + 11, { align: 'center' }));
      // Legenda (só quando há mais de uma série, ex.: realizado e projetado)
      if (chart.series.length > 1) {
        let lx = x0;
        chart.series.forEach((s) => {
          doc.setDrawColor(...BLUE);
          doc.setLineWidth(1.4);
          if (s.dashed) doc.setLineDashPattern([4, 3], 0);
          doc.line(lx, y + 2, lx + 16, y + 2);
          doc.setLineDashPattern([], 0);
          doc.text(s.name, lx + 20, y + 4.5);
          lx += 30 + doc.getTextWidth(s.name);
        });
      }
      doc.setLineWidth(0.5);
      y = top + h + 26;
    }
  }

  if (o.tableTitle) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(o.tableTitle, margin, y + 4);
    y += 12;
  }

  const right = new Set(o.rightAligned);
  const positive = new Set(o.colorColumns?.positive ?? []);
  const negative = new Set(o.colorColumns?.negative ?? []);
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, top: margin, bottom: margin + 10 },
    head: [o.head],
    body: o.body.map((r) => (r.span ? [{ content: r.cells[0], colSpan: o.head.length }] : r.cells)),
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
      if (data.section === 'body' && text.trim()) {
        if (positive.has(data.column.index)) data.cell.styles.textColor = GREEN;
        if (negative.has(data.column.index)) data.cell.styles.textColor = RED;
      }
    },
  });

  // Tabelas extras (seções)
  type WithLastTable = { lastAutoTable?: { finalY: number } };
  for (const sec of o.sections ?? []) {
    let sy = ((doc as unknown as WithLastTable).lastAutoTable?.finalY ?? y) + 24;
    if (sy > pageH - margin - 60) {
      doc.addPage();
      sy = margin + 10;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(sec.title, margin, sy);
    const secRight = new Set(sec.rightAligned);
    const rows: PdfRow[] = sec.body.length ? sec.body : [{ cells: [sec.emptyText ?? 'Nada a mostrar'], span: true }];
    autoTable(doc, {
      startY: sy + 8,
      margin: { left: margin, right: margin, top: margin, bottom: margin + 10 },
      head: [sec.head],
      body: rows.map((r) => (r.span ? [{ content: r.cells[0], colSpan: sec.head.length }] : r.cells)),
      foot: sec.foot ? [sec.foot] : undefined,
      showFoot: 'lastPage',
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: o.fontSize ?? 8.5, textColor: INK, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, lineColor: LINE, lineWidth: { bottom: 0.5 }, overflow: 'linebreak' },
      headStyles: { fillColor: [240, 241, 243], fontStyle: 'bold', lineWidth: 0 },
      footStyles: { fontStyle: 'bold', fillColor: [248, 250, 252], lineWidth: { top: 0.8 } },
      columnStyles: Object.fromEntries(sec.head.map((_, i) => [i, { halign: secRight.has(i) ? 'right' : 'left', ...(sec.widths?.[i] ? { cellWidth: sec.widths[i] } : {}) }])),
      didParseCell: (data) => {
        if (secRight.has(data.column.index)) data.cell.styles.halign = 'right';
        const text = Array.isArray(data.cell.text) ? data.cell.text.join(' ') : String(data.cell.text ?? '');
        if (data.section !== 'head' && /^\(.*\)/.test(text.trim())) data.cell.styles.textColor = RED;
      },
    });
  }

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
