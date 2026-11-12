import React from 'react';
import { useCompany } from '../../context/CompanyContext';
import { BookOpen } from 'lucide-react';
import { CONTACT_SECTIONS, contactSectionFor } from '../../lib/contacts';
import { entryRoute } from '../../lib/entries';
import { SETTINGS_TABS, isSettingsModule } from '../../lib/settings';
import { REPORT_TABS, isReportModule } from '../../lib/reports';

export const SubHeader: React.FC = () => {
  const { activeModule, setActiveModule, can } = useCompany();

  // Se o módulo ativo pertencer à gestão de caixa ou se for uma das abas principais
  const isGestaoCaixa =
    activeModule === 'resumo' ||
    activeModule === 'contas-extratos' ||
    activeModule === 'fluxo-caixa';

  // Abas de Configurações e de Relatórios
  const tabbed = isSettingsModule(activeModule)
    ? { title: 'Configurações', tabs: SETTINGS_TABS }
    : isReportModule(activeModule)
      ? { title: 'Relatórios', tabs: REPORT_TABS }
      : null;
  if (tabbed) {
    return (
      <div className="bg-white border-b border-slate-200 px-6 pt-3 flex items-center shrink-0 select-none overflow-x-auto">
        <div className="flex items-center space-x-6">
          <h2 className="text-base text-slate-800 pb-2.5">{tabbed.title}</h2>
          <nav className="flex items-center space-x-6">
            {tabbed.tabs.map((t) => (
              <button
                key={t.module}
                onClick={() => setActiveModule(t.module)}
                className={`text-xs font-medium pb-2.5 transition-all border-b-2 whitespace-nowrap ${
                  activeModule === t.module ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  // Abas de Recebimentos / Pagamentos (Receber | Agendar | Recorrências)
  const entry = entryRoute(activeModule);
  if (entry) {
    const { config } = entry;
    const tabs = [
      { module: config.listModule, label: config.listTitle },
      ...(can('FINANCIAL_OPERATOR') ? [{ module: config.scheduleModule, label: 'Agendar' }] : []),
      { module: config.recurrencesModule, label: 'Recorrências' },
    ];
    return (
      <div className="bg-white border-b border-slate-200 px-6 pt-3 flex items-center shrink-0 select-none">
        <div className="flex items-center space-x-6">
          <h2 className="text-base text-slate-800 pb-2.5">{config.section}</h2>
          <nav className="flex items-center space-x-6">
            {tabs.map((t) => (
              <button
                key={t.module}
                onClick={() => setActiveModule(t.module)}
                className={`text-xs font-medium pb-2.5 transition-all border-b-2 ${
                  activeModule === t.module ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  // Abas da seção Contatos (Clientes | Fornecedores | Funcionários | Sócios)
  if (contactSectionFor(activeModule)) {
    return (
      <div className="bg-white border-b border-slate-200 px-6 pt-3 flex items-center shrink-0 select-none">
        <div className="flex items-center space-x-6">
          <h2 className="text-base text-slate-800 pb-2.5">Contatos</h2>
          <nav className="flex items-center space-x-6">
            {CONTACT_SECTIONS.map((s) => (
              <button
                key={s.module}
                onClick={() => setActiveModule(s.module)}
                className={`text-xs font-medium pb-2.5 transition-all border-b-2 ${
                  activeModule === s.module
                    ? 'border-blue-600 text-blue-600 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  if (!isGestaoCaixa) {
    return null;
  }

  return (
    <div className="bg-white border-b border-slate-200 px-6 pt-3 flex items-center justify-between shrink-0 select-none">
      {/* Lado Esquerdo: Título da Seção + Abas */}
      <div className="flex items-center space-x-6">
        <h2 className="text-base text-slate-800 pb-2.5">Gestão de caixa</h2>

        <nav className="flex items-center space-x-6">
          <button
            onClick={() => setActiveModule('resumo')}
            className={`text-xs font-medium pb-2.5 transition-all border-b-2 ${
              activeModule === 'resumo'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Resumo
          </button>

          <button
            onClick={() => setActiveModule('contas-extratos')}
            className={`text-xs font-medium pb-2.5 transition-all border-b-2 ${
              activeModule === 'contas-extratos'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Contas & Extratos
          </button>

          <button
            onClick={() => setActiveModule('fluxo-caixa')}
            className={`text-xs font-medium pb-2.5 transition-all border-b-2 ${
              activeModule === 'fluxo-caixa'
                ? 'border-blue-600 text-blue-600 font-semibold'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Fluxo de caixa
          </button>
        </nav>
      </div>

      {/* Lado Direito: Link "Veja como funciona" com ícone */}
      <div className="pb-2.5">
        <button
          onClick={() => alert('Tour explicativo: Gestão de caixa, conciliação e fluxo financeiro no Nibo / SYC Hub.')}
          className="flex items-center space-x-1.5 text-xs text-slate-500 hover:text-blue-600 transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Veja como funciona</span>
        </button>
      </div>
    </div>
  );
};
