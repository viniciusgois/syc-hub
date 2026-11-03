import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { ENTRY_CONFIG } from '../../lib/entries';
import { ReportRow, fileSafe } from '../../lib/reports';
import { Modal } from '../common/Modal';
import { useCostCenters } from '../common/useCostCenters';
import { EntryDrawer } from '../entries/EntryDrawer';
import { RowsTable } from './RowsTable';
import { Column, exportRows } from './reportTable';

export interface PanelCell {
  label: string; // "Despesas com veículos · Jul/2026"
  from: string;
  to: string;
  basis: 'CASH' | 'ACCRUAL';
  costCenterId: string;
  target: { categoryId: string } | { groupId: string } | { section: string };
}

/** Lançamentos que compõem uma célula do Painel (como o "Unificado por agendamento" do Nibo) */
export const PanelDetailsModal: React.FC<{ cell: PanelCell; onClose: () => void; onChanged: () => void }> = ({ cell, onClose, onChanged }) => {
  const { currentCompany } = useCompany();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReportRow['entry']>(null);
  const costCenters = useCostCenters();

  const load = useCallback(() => {
    const params = new URLSearchParams({ from: cell.from, to: cell.to, basis: cell.basis, ...cell.target });
    if (cell.costCenterId) params.set('costCenterId', cell.costCenterId);
    api
      .get<{ rows: ReportRow[] }>(`/companies/${currentCompany.id}/reports/panel/details?${params}`)
      .then((r) => setRows(r.rows))
      .catch((err) => setError(errorMessage(err)));
  }, [currentCompany.id, cell]);

  useEffect(load, [load]);

  const cash = cell.basis === 'CASH';
  const columns: Column[] = [
    ...(cash ? [{ key: 'paidAt' as const, label: 'Pagamento' }] : []),
    { key: 'issueDate', label: 'Competência' },
    { key: 'dueDate', label: 'Vencimento' },
    { key: 'contactName', label: 'Contato' },
    { key: 'description', label: 'Descrição' },
    { key: 'categoryName', label: 'Categoria' },
    ...(costCenters.length > 0 ? [{ key: 'costCenterName' as const, label: 'Centro de custo' }] : []),
    ...(cash ? [{ key: 'bankAccountName' as const, label: 'Conta' }] : [{ key: 'status' as const, label: 'Situação' }]),
    { key: 'value', label: 'Valor da categoria/CC' },
    { key: 'groupTotal', label: cash ? 'Valor do pagamento' : 'Valor agendamento' },
  ];

  return (
    <>
      {/* A gaveta do lançamento abre no lugar do modal (que volta ao fechá-la) */}
      {!opened && (
      <Modal
        title={cell.label}
        onClose={onClose}
        width="max-w-[min(1400px,95vw)]"
        footer={
          <button
            type="button"
            disabled={!rows?.length}
            onClick={() =>
              exportRows(`Lancamentos_${fileSafe(cell.label)}.xlsx`, cell.label, `${currentCompany.legalName} | ${cash ? 'Regime de caixa' : 'Regime de competência'}`, columns, rows ?? [])
            }
            className="mr-auto text-sm text-nibo-blue hover:underline flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Exportar (.xlsx)
          </button>
        }
      >
        <p className="text-xs text-slate-500 mb-3">
          {cash ? 'Regime de caixa: o que foi efetivamente pago/recebido no período.' : 'Regime de competência: realizado e agendado pela data de competência.'} Com rateio, cada
          linha mostra a parte da categoria/centro de custo.
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!rows && !error && (
          <p className="text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </p>
        )}
        {rows && <RowsTable columns={columns} rows={rows} onOpen={(r) => setOpened(r.entry)} defaultSort={cash ? 'paidAt' : 'issueDate'} />}
      </Modal>
      )}
      {opened && (
        <EntryDrawer
          config={ENTRY_CONFIG[opened.direction]}
          mode="edit"
          entryId={opened.id}
          isOpen
          onClose={() => setOpened(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
};
