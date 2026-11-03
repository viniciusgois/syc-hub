import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { Company } from '../../types';

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="p-5 rounded border border-slate-200 bg-slate-50">
    <h2 className="text-base font-medium text-slate-800">{title}</h2>
    <div className="mt-2 text-sm text-slate-600 space-y-3">{children}</div>
  </section>
);

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700">
    <span className="relative inline-flex">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="w-10 h-5 rounded-full bg-slate-300 peer-checked:bg-nibo-blue transition-colors" />
      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </span>
    {label}
  </label>
);

export const AdvancedSettings: React.FC = () => {
  const { currentCompany, updateCompany, notify } = useCompany();
  const [months, setMonths] = useState(String(currentCompany.provisioningMonths));

  useEffect(() => setMonths(String(currentCompany.provisioningMonths)), [currentCompany.provisioningMonths]);

  const save = async (patch: Partial<Pick<Company, 'provisioningMonths' | 'accrualBasis' | 'splitsEnabled' | 'bankScheduleEnabled'>>, message: string) => {
    try {
      updateCompany(await api.patch<Company>(`/companies/${currentCompany.id}`, patch));
      notify(message);
    } catch (err) {
      notify(errorMessage(err), 'error');
      setMonths(String(currentCompany.provisioningMonths));
    }
  };

  const commitMonths = () => {
    const n = Number(months);
    if (n === currentCompany.provisioningMonths) return;
    if (!Number.isInteger(n) || n < 1 || n > 60) {
      notify('Informe de 1 a 60 meses', 'error');
      setMonths(String(currentCompany.provisioningMonths));
      return;
    }
    save({ provisioningMonths: n }, 'Meses para provisionamento atualizados');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <h1 className="text-xl font-medium text-slate-700 mb-4">Configurações avançadas</h1>
      <div className="space-y-4">
        <Card title="Meses para provisionamento">
          <p>Os lançamentos recorrentes sem data de término são provisionados no caixa com esta antecedência.</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={60}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              onBlur={commitMonths}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Meses para provisionamento"
              className="w-20 h-10 px-3 rounded border border-slate-300 bg-white text-sm focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight"
            />
            <span>meses antes do vencimento</span>
          </div>
          <p className="text-xs text-slate-500">Reduzir o prazo não apaga ocorrências já geradas; só deixa de gerar além dele.</p>
        </Card>

        <Card title="Regime de competência">
          <p>Visualize a DRE gerencial com base na data de competência dos lançamentos (em vez da data do pagamento/recebimento).</p>
          <Switch
            checked={currentCompany.accrualBasis}
            onChange={(v) => save({ accrualBasis: v }, v ? 'DRE em regime de competência' : 'DRE em regime de caixa')}
            label="Ativar"
          />
        </Card>

        <Card title="Rateio por categoria e centro de custo">
          <p>Divida um recebimento, pagamento ou linha do extrato entre várias categorias e centros de custo, por valor ou por percentual.</p>
          <p>
            Juros/multa e descontos passam a aparecer separados na DRE, nas categorias do sistema: <em>Multas recebidas</em>, <em>Descontos concedidos</em>,{' '}
            <em>Multas pagas</em> e <em>Descontos obtidos</em>.
          </p>
          <Switch
            checked={currentCompany.splitsEnabled}
            onChange={(v) => save({ splitsEnabled: v }, v ? 'Rateio ativado' : 'Rateio desativado')}
            label="Ativar"
          />
          {!currentCompany.splitsEnabled && (
            <p className="text-xs text-slate-500">Desativar não apaga os rateios já feitos; eles continuam valendo na DRE.</p>
          )}
        </Card>

        <Card title="Programado no banco">
          <p>Indique que agendamentos de pagamentos já foram programados no banco.</p>
          <Switch
            checked={currentCompany.bankScheduleEnabled}
            onChange={(v) => save({ bankScheduleEnabled: v }, v ? '"Programado no banco" ativado' : '"Programado no banco" desativado')}
            label="Ativar"
          />
        </Card>
      </div>
    </div>
  );
};
