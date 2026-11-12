import React, { useState, useEffect } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { CONTACT_SECTIONS, contactSectionFor } from '../../lib/contacts';
import { ENTRY_CONFIG, entryRoute } from '../../lib/entries';
import { SETTINGS_TABS, isSettingsModule } from '../../lib/settings';
import { REPORT_TABS, isReportModule } from '../../lib/reports';
import { UserMenu } from '../auth/UserMenu';
import {
  Pin,
  LayoutGrid,
  Inbox,
  BarChart3,
  Users,
  ArrowUp,
  ArrowDown,
  FileText,
  Settings,
  MoreHorizontal,
  Mail,
  FolderArchive,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Building2,
  HelpCircle,
  Gift,
  CheckSquare,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { activeModule, setActiveModule, can } = useCompany();
  const [isPinned, setIsPinned] = useState(true);

  // Estados de acordeons do menu secundário
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    gestaoCaixa: true,
    contatos: false,
    recebimentos: false,
    pagamentos: false,
    relatorios: false,
    configuracoes: false,
    maisOpcoes: false,
  });

  // Ao entrar numa tela de contatos (ex.: pelas abas do topo), expande o grupo no menu
  const inContacts = !!contactSectionFor(activeModule);
  useEffect(() => {
    if (inContacts) setOpenSections((prev) => (prev.contatos ? prev : { ...prev, contatos: true }));
  }, [inContacts]);

  // Idem para Configurações
  const inSettings = isSettingsModule(activeModule);
  useEffect(() => {
    if (inSettings) setOpenSections((prev) => (prev.configuracoes ? prev : { ...prev, configuracoes: true }));
  }, [inSettings]);

  // Idem para Relatórios
  const inReports = isReportModule(activeModule);
  useEffect(() => {
    if (inReports) setOpenSections((prev) => (prev.relatorios ? prev : { ...prev, relatorios: true }));
  }, [inReports]);

  // Idem para Recebimentos / Pagamentos
  const entrySection = entryRoute(activeModule)?.config.direction;
  useEffect(() => {
    const key = entrySection === 'RECEIVABLE' ? 'recebimentos' : entrySection === 'PAYABLE' ? 'pagamentos' : null;
    if (key) setOpenSections((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, [entrySection]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex h-screen shrink-0 select-none z-20">
      {/* ========================================================= */}
      {/* 1. TRILHO PRINCIPAL ESQUERDO (ÍCONES NIBO - NAVY ESCURO)   */}
      {/* ========================================================= */}
      <aside className="w-14 bg-[#14233c] flex flex-col items-center justify-between py-3 shrink-0 border-r border-[#0e1a2e]">
        {/* Topo do trilho: Logo Constelação Nibo */}
        <div className="flex flex-col items-center space-y-4">
          <div
            onClick={() => setActiveModule('resumo')}
            className="w-10 h-10 flex items-center justify-center cursor-pointer group"
            title="SYC Hub / Nibo BPO"
          >
            <svg
              viewBox="0 0 32 32"
              className="w-7 h-7 text-white fill-current transition-transform group-hover:scale-105"
            >
              <circle cx="8" cy="23" r="3.6" />
              <circle cx="16" cy="9" r="3.6" />
              <circle cx="24" cy="23" r="3.6" />
              <path
                d="M8 23 L16 9 L24 23"
                stroke="white"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </div>

          {/* Divisor sutil */}
          <div className="w-6 h-[1px] bg-slate-700/60 my-1" />

          {/* Ícones de Navegação do Trilho */}
          <button
            onClick={() => setActiveModule('resumo')}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              activeModule === 'resumo' || activeModule === 'contas-extratos'
                ? 'bg-blue-600/30 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Tarefas & Gestão Financeira"
          >
            <CheckSquare className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveModule('rel-painel')}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              isReportModule(activeModule)
                ? 'bg-blue-600/30 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
            title="Relatórios"
          >
            <TrendingUp className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveModule('empresas')}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              activeModule === 'empresas' ? 'bg-blue-600/30 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
            title="SYC Empresas"
            aria-label="SYC Empresas"
          >
            <Building2 className="w-4 h-4" />
          </button>
        </div>

        {/* Rodapé do trilho: News, Ajuda e Avatar */}
        <div className="flex flex-col items-center space-y-3.5 pb-1">
          <button
            onClick={() => alert('Novidades e atualizações da plataforma BPO')}
            className="flex flex-col items-center justify-center text-slate-400 hover:text-white group transition-colors"
            title="Novidades"
          >
            <Gift className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-[9px] font-medium tracking-tight mt-0.5 text-slate-400 group-hover:text-white">
              News
            </span>
          </button>

          <button
            onClick={() => alert('Central de Ajuda e Suporte ao Contador / BPO')}
            className="flex flex-col items-center justify-center text-slate-400 hover:text-white group transition-colors"
            title="Central de Ajuda"
          >
            <HelpCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span className="text-[9px] font-medium tracking-tight mt-0.5 text-slate-400 group-hover:text-white">
              Ajuda
            </span>
          </button>

          {/* Usuário logado: alterar senha e sair */}
          <UserMenu />
        </div>
      </aside>

      {/* ========================================================= */}
      {/* 2. MENU SECUNDÁRIO BRANCO (ESTRUTURA DE MÓDULOS NIBO)     */}
      {/* ========================================================= */}
      {isPinned && activeModule !== 'empresas' && (
        <aside className="w-56 bg-white border-r border-slate-200 flex flex-col h-screen text-slate-700">
          {/* Cabeçalho Empresa com Botão Pin */}
          <div className="h-14 px-4 border-b border-slate-200/80 flex items-center justify-between shrink-0">
            <span className="text-lg text-slate-800">Empresa</span>
            <button
              onClick={() => setIsPinned(!isPinned)}
              className="p-1 rounded text-blue-500 hover:bg-blue-50 transition-colors"
              title="Fixar/Ocultar menu lateral"
            >
              <Pin className="w-4 h-4 rotate-45 fill-blue-500/20" />
            </button>
          </div>

          {/* Lista de Navegação com Scroll */}
          <div className="flex-1 overflow-y-auto px-2 py-2.5 text-xs">
            {/* Seção Superior */}
            <div className="space-y-0.5 mb-2">
              <button
                onClick={() => setActiveModule('resumo')}
                className={`w-full flex items-center space-x-2.5 px-3 py-1.5 rounded text-left transition-colors ${
                  activeModule === 'resumo' ? 'text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100/70'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 text-slate-500" />
                <span>Início</span>
              </button>

              <button
                onClick={() => alert('Caixa de Entrada: Nenhum documento ou comprovante pendente.')}
                className="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded text-slate-600 hover:bg-slate-100/70 text-left transition-colors"
              >
                <Inbox className="w-3.5 h-3.5 text-slate-500" />
                <span>Caixa de entrada</span>
              </button>
            </div>

            {/* Divisor / Título FINANCEIRO */}
            <div className="px-3 pt-2 pb-1">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                FINANCEIRO
              </span>
            </div>

            {/* Grupo: Gestão de caixa */}
            <div className="space-y-0.5">
              <button
                onClick={() => toggleSection('gestaoCaixa')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100/70 text-left font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <BarChart3 className="w-3.5 h-3.5 text-slate-600" />
                  <span>Gestão de caixa</span>
                </div>
                {openSections.gestaoCaixa ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {openSections.gestaoCaixa && (
                <div className="pl-6 space-y-0.5">
                  <button
                    onClick={() => setActiveModule('resumo')}
                    className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                      activeModule === 'resumo'
                        ? 'bg-[#e6effc] text-blue-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                    }`}
                  >
                    Resumo
                  </button>

                  <button
                    onClick={() => setActiveModule('contas-extratos')}
                    className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                      activeModule === 'contas-extratos'
                        ? 'bg-[#e6effc] text-blue-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                    }`}
                  >
                    Contas & Extratos
                  </button>

                  <button
                    onClick={() => setActiveModule('fluxo-caixa')}
                    className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                      activeModule === 'fluxo-caixa'
                        ? 'bg-[#e6effc] text-blue-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                    }`}
                  >
                    Fluxo de caixa
                  </button>
                </div>
              )}
            </div>

            {/* Grupo: Contatos */}
            <div className="space-y-0.5">
              <button
                onClick={() => toggleSection('contatos')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100/70 text-left font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <Users className="w-3.5 h-3.5 text-slate-500" />
                  <span>Contatos</span>
                </div>
                {openSections.contatos ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {openSections.contatos && (
                <div className="pl-6 space-y-0.5">
                  {CONTACT_SECTIONS.map((section) => (
                    <button
                      key={section.module}
                      onClick={() => setActiveModule(section.module)}
                      className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                        activeModule === section.module
                          ? 'bg-[#e6effc] text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                      }`}
                    >
                      {section.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Grupo: Recebimentos */}
            <div className="space-y-0.5">
              <button
                onClick={() => toggleSection('recebimentos')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100/70 text-left font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <ArrowUp className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Recebimentos</span>
                </div>
                {openSections.recebimentos ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {openSections.recebimentos && (
                <div className="pl-6 space-y-0.5">
                  {[
                    { module: ENTRY_CONFIG.RECEIVABLE.listModule, label: ENTRY_CONFIG.RECEIVABLE.listTitle },
                    ...(can('FINANCIAL_OPERATOR') ? [{ module: ENTRY_CONFIG.RECEIVABLE.scheduleModule, label: 'Agendar' }] : []),
                    { module: ENTRY_CONFIG.RECEIVABLE.recurrencesModule, label: 'Recorrências' },
                  ].map((item) => (
                    <button
                      key={item.module}
                      onClick={() => setActiveModule(item.module)}
                      className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                        activeModule === item.module
                          ? 'bg-[#e6effc] text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Grupo: Pagamentos */}
            <div className="space-y-0.5">
              <button
                onClick={() => toggleSection('pagamentos')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100/70 text-left font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <ArrowDown className="w-3.5 h-3.5 text-rose-600" />
                  <span>Pagamentos</span>
                </div>
                {openSections.pagamentos ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {openSections.pagamentos && (
                <div className="pl-6 space-y-0.5">
                  {[
                    { module: ENTRY_CONFIG.PAYABLE.listModule, label: ENTRY_CONFIG.PAYABLE.listTitle },
                    ...(can('FINANCIAL_OPERATOR') ? [{ module: ENTRY_CONFIG.PAYABLE.scheduleModule, label: 'Agendar' }] : []),
                    { module: ENTRY_CONFIG.PAYABLE.recurrencesModule, label: 'Recorrências' },
                  ].map((item) => (
                    <button
                      key={item.module}
                      onClick={() => setActiveModule(item.module)}
                      className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                        activeModule === item.module
                          ? 'bg-[#e6effc] text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Grupo: Relatórios */}
            <div className="space-y-0.5">
              <button
                onClick={() => toggleSection('relatorios')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100/70 text-left font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  <span>Relatórios</span>
                </div>
                {openSections.relatorios ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {openSections.relatorios && (
                <div className="pl-6 space-y-0.5">
                  {REPORT_TABS.map((t) => (
                    <button
                      key={t.module}
                      onClick={() => setActiveModule(t.module)}
                      className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                        activeModule === t.module
                          ? 'bg-[#e6effc] text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Grupo: Configurações (só administradores e proprietários) */}
            {can('ADMIN') && (
            <div className="space-y-0.5">
              <button
                onClick={() => toggleSection('configuracoes')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100/70 text-left font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <Settings className="w-3.5 h-3.5 text-slate-500" />
                  <span>Configurações</span>
                </div>
                {openSections.configuracoes ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {openSections.configuracoes && (
                <div className="pl-6 space-y-0.5">
                  {SETTINGS_TABS.map((item) => (
                    <button
                      key={item.module}
                      onClick={() => setActiveModule(item.module)}
                      className={`w-full text-left px-3 py-1.5 rounded transition-all text-xs ${
                        activeModule === item.module
                          ? 'bg-[#e6effc] text-blue-700 font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Grupo: Mais opções */}
            <div className="space-y-0.5">
              <button
                onClick={() => toggleSection('maisOpcoes')}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100/70 text-left font-medium"
              >
                <div className="flex items-center space-x-2.5">
                  <MoreHorizontal className="w-3.5 h-3.5 text-slate-500" />
                  <span>Mais opções</span>
                </div>
                {openSections.maisOpcoes ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>
            </div>

            {/* Divisor / Título CONTADOR */}
            <div className="px-3 pt-5 pb-1">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                CONTADOR
              </span>
            </div>

            <div className="space-y-0.5">
              <button
                onClick={() => alert('Convite enviado para equipe contábil parceira.')}
                className="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded text-slate-600 hover:bg-slate-100/70 text-left transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span>Convide seu contador</span>
              </button>

              <button
                onClick={() => alert('Repositório Permanente de Documentos Fiscais e SPED.')}
                className="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded text-slate-600 hover:bg-slate-100/70 text-left transition-colors"
              >
                <FolderArchive className="w-3.5 h-3.5 text-slate-500" />
                <span>Arquivo permanente</span>
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
};
