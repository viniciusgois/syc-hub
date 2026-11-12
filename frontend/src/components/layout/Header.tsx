import React, { useState, useRef, useEffect } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { CreateCompanyModal } from '../companies/CreateCompanyModal';
import { api } from '../../lib/api';
import { formatDocument, initials, onlyDigits } from '../../lib/documents';
import {
  ChevronDown,
  Search,
  Bell,
  Plus,
  Mail,
  Check,
} from 'lucide-react';

export const Header: React.FC = () => {
  const { currentCompany, companies, setCurrentCompanyId, addCompany, notify, transactions, setActiveModule } = useCompany();
  const [alerts, setAlerts] = useState<{ overdue: { count: number; receivable: number; payable: number }; unreconciledTransactions: number } | null>(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const alertCount = (alerts?.overdue.count ?? 0) + (alerts?.unreconciledTransactions ?? 0);

  // Recarrega os alertas ao trocar de empresa e quando o razão muda (importação, conciliação, baixa)
  useEffect(() => {
    let cancelled = false;
    api
      .get<NonNullable<typeof alerts>>(`/companies/${currentCompany.id}/reports/alerts`)
      .then((a) => !cancelled && setAlerts(a))
      .catch(() => !cancelled && setAlerts(null));
    return () => {
      cancelled = true;
    };
  }, [currentCompany.id, transactions]);

  useEffect(() => {
    if (!bellOpen) return;
    const onClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [bellOpen]);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredCompanies = companies.filter((c) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.tradeName.toLowerCase().includes(term) ||
      c.legalName.toLowerCase().includes(term) ||
      (onlyDigits(term) !== '' && c.cnpj.includes(onlyDigits(term)))
    );
  });

  return (
    <header className="h-14 bg-white border-b border-slate-200/90 px-6 flex items-center justify-between z-30 sticky top-0">
      {/* ========================================================= */}
      {/* SELETOR DE EMPRESAS (ORGANIZATION SELECTOR - IDENTICO NIBO) */}
      {/* ========================================================= */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center space-x-3 text-left group hover:opacity-90 transition-opacity focus:outline-none"
        >
          {currentCompany.logoUrl && <img src={currentCompany.logoUrl} alt="" className="w-9 h-9 rounded object-contain bg-white border border-slate-100" />}
          <div className="flex flex-col">
            <span className="text-sm font-medium text-slate-800 max-w-[420px] truncate uppercase">
              {currentCompany.legalName}
            </span>
            <span className="text-xs text-slate-500">
              {formatDocument(currentCompany.cnpj)}
            </span>
          </div>

          <ChevronDown
            className={`w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* MODAL / DROPDOWN DE EMPRESAS - CONFORME SCREENSHOT 2 */}
        {dropdownOpen && (
          <div className="absolute left-0 mt-2 w-[380px] bg-white rounded-lg border border-slate-200 shadow-xl py-2 z-50 text-slate-700 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Cabeçalho do Dropdown: Minhas empresas (8) + Busca */}
            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 shrink-0">
                Minhas empresas ({companies.length})
              </span>

              <div className="relative flex-1 max-w-[170px]">
                <input
                  type="text"
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full text-xs pl-2.5 pr-7 py-1 rounded border border-slate-200 focus:outline-none focus:border-blue-500 text-slate-700 placeholder-slate-400"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2" />
              </div>
            </div>

            {/* Lista Rolável de Empresas */}
            <div className="py-1 max-h-72 overflow-y-auto divide-y divide-slate-50">
              {filteredCompanies.map((comp) => {
                const isSelected = comp.id === currentCompany.id;
                return (
                  <button
                    key={comp.id}
                    onClick={() => {
                      setCurrentCompanyId(comp.id);
                      setDropdownOpen(false);
                    }}
                    className={`w-full px-4 py-2 flex items-center justify-between text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50/70 text-blue-900'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3 truncate">
                      {/* Badge Quadrado com Inicial "GF" idêntico ao Nibo */}
                      {comp.logoUrl ? (
                        <img src={comp.logoUrl} alt="" className="w-7 h-7 rounded object-contain bg-white border border-slate-100 shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {initials(comp.tradeName || comp.legalName)}
                        </div>
                      )}
                      <div className="truncate">
                        <p className="text-xs font-semibold uppercase truncate text-slate-800">
                          {comp.legalName}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {formatDocument(comp.cnpj)}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <Check className="w-4 h-4 text-blue-600 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Rodapé com Links: + Criar nova empresa | Convidar usuários */}
            <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-blue-600 font-medium">
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  setCreateOpen(true);
                }}
                className="flex items-center space-x-1 hover:underline text-blue-600"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Criar nova empresa</span>
              </button>

              <button
                onClick={() => alert('Convite de usuários por e-mail.')}
                className="flex items-center space-x-1 hover:underline text-blue-600"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Convidar usuários</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* LADO DIREITO: NOTIFICAÇÕES (SINO NIBO)                    */}
      {/* ========================================================= */}
      <div className="flex items-center space-x-4">
        {/* Sino: vencidos em aberto + linhas do extrato a conciliar */}
        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setBellOpen((o) => !o)}
            aria-label={`Alertas${alertCount ? ` (${alertCount})` : ''}`}
            aria-expanded={bellOpen}
            className="relative p-1 rounded-full hover:bg-slate-100 transition-colors"
          >
            <Bell className="w-5 h-5 text-blue-500 fill-blue-500/10" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-slate-900 text-[10px] font-bold flex items-center justify-center shadow-xs">
                {alertCount > 99 ? '99+' : alertCount}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg border border-slate-200 shadow-xl py-2 z-50 text-sm">
              <p className="px-4 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Alertas</p>
              {alertCount === 0 && <p className="px-4 py-3 text-slate-500">Tudo em dia.</p>}
              {!!alerts?.overdue.count && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveModule('fluxo-caixa');
                    setBellOpen(false);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50"
                >
                  <span className="block text-slate-800">
                    {alerts.overdue.count} {alerts.overdue.count === 1 ? 'lançamento vencido' : 'lançamentos vencidos'} em aberto
                  </span>
                  <span className="block text-xs text-slate-500">
                    {[
                      alerts.overdue.receivable > 0 && `R$ ${alerts.overdue.receivable.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} a receber`,
                      alerts.overdue.payable > 0 && `R$ ${alerts.overdue.payable.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} a pagar`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    · conferir no Fluxo de caixa
                  </span>
                </button>
              )}
              {!!alerts?.unreconciledTransactions && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveModule('contas-extratos');
                    setBellOpen(false);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50"
                >
                  <span className="block text-slate-800">
                    {alerts.unreconciledTransactions} {alerts.unreconciledTransactions === 1 ? 'linha do extrato' : 'linhas do extrato'} a conciliar
                  </span>
                  <span className="block text-xs text-slate-500">Contas & Extratos</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <CreateCompanyModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(company) => {
          addCompany(company);
          notify(`Empresa ${company.legalName} criada`);
        }}
      />
    </header>
  );
};
