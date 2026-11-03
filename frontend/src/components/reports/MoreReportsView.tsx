import React from 'react';
import { LineChart, BarChart3, AlignLeft, Hourglass, ArrowDown, ArrowUp, Table2, ArrowLeftRight, TrendingDown } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';

interface ReportCard {
  title: string;
  description: string;
  icon: React.ElementType;
  /** Módulo da tela; sem módulo = "Em breve" */
  module?: string;
}

const SECTIONS: { title: string; reports: ReportCard[] }[] = [
  {
    title: 'Performance do negócio',
    reports: [
      { title: 'Painel de acompanhamento', module: 'rel-painel', icon: LineChart, description: 'Entradas e saídas da empresa por mês, divididas em atividades operacionais, investimentos e financiamentos.' },
      { title: 'Envelhecimento de contas a receber', icon: Hourglass, description: 'Valores devidos à empresa em atraso, organizados por faixas de dias desde o vencimento.' },
      { title: 'Análise vertical', icon: BarChart3, description: 'Evolução do resultado com cada item como porcentagem da receita operacional.' },
      { title: 'Envelhecimento de contas a pagar', icon: Hourglass, description: 'Obrigações da empresa em atraso, organizadas por faixas de dias desde o vencimento.' },
      { title: 'Análise horizontal', icon: AlignLeft, description: 'Compara as variações do resultado ao longo do período desejado.' },
    ],
  },
  {
    title: 'Lançamentos',
    reports: [
      { title: 'Contas a pagar', module: 'rel-pagar', icon: ArrowDown, description: 'Obrigações da empresa que ainda não foram pagas.' },
      { title: 'Contas pagas', module: 'rel-pagas', icon: ArrowDown, description: 'Despesas e obrigações que já foram pagas.' },
      { title: 'Contas a receber', module: 'rel-receber', icon: ArrowUp, description: 'Valores devidos à empresa que ainda não foram recebidos.' },
      { title: 'Contas recebidas', module: 'rel-recebidas', icon: ArrowUp, description: 'Valores já recebidos de clientes e devedores.' },
      { title: 'Unificado por lançamento', icon: Table2, description: 'Pagamentos, recebimentos e valores em aberto, um lançamento por linha.' },
      { title: 'Unificado por agendamento', icon: Table2, description: 'Lançamentos consolidados por agendamento: valor total, em aberto e pago/recebido.' },
      { title: 'Transferências', icon: ArrowLeftRight, description: 'Movimentações de recursos entre as contas da empresa.' },
      { title: 'Recebimentos perdidos', icon: TrendingDown, description: 'Recebimentos agendados que foram marcados como perda.' },
    ],
  },
];

export const MoreReportsView: React.FC = () => {
  const { setActiveModule } = useCompany();
  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <h1 className="text-xl font-medium text-slate-700 mb-4">Todos os relatórios</h1>
      <div className="space-y-5">
        {SECTIONS.map((section) => (
          <section key={section.title} className="rounded border border-slate-200 p-5">
            <h2 className="text-base font-medium text-slate-800 mb-4">{section.title}</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-2">
              {section.reports.map((r) => {
                const Icon = r.icon;
                const content = (
                  <>
                    <span className="w-9 h-9 rounded bg-slate-100 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-slate-500" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        {r.title}
                        {!r.module && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-semibold uppercase tracking-wide">Em breve</span>}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">{r.description}</span>
                    </span>
                  </>
                );
                return r.module ? (
                  <button key={r.title} type="button" onClick={() => setActiveModule(r.module!)} className="flex items-start gap-3 p-2.5 rounded text-left hover:bg-slate-50">
                    {content}
                  </button>
                ) : (
                  <div key={r.title} className="flex items-start gap-3 p-2.5 rounded opacity-70 cursor-default" title="Em breve">
                    {content}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
