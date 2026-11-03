import React, { useState } from 'react';
import { Eye, Loader2, Lock } from 'lucide-react';
import { AuthProvider, useAuthState } from './context/AuthContext';
import { LoginPage } from './components/auth/LoginPage';
import { AccessPage } from './components/auth/AccessPage';
import { ROLE_LABEL } from './lib/roles';
import { isSettingsModule } from './lib/settings';
import { CompanyProvider, useCompany } from './context/CompanyContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { SubHeader } from './components/layout/SubHeader';
import { ResumoView } from './components/dashboard/ResumoView';
import { AccountsAndStatements } from './components/accounts/AccountsAndStatements';
import { ImportKind, OFXDropzoneModal } from './components/accounts/OFXDropzoneModal';
import { NewAccountDrawer } from './components/accounts/NewAccountDrawer';
import { PanelView } from './components/reports/PanelView';
import { EntriesReportView } from './components/reports/EntriesReportView';
import { MoreReportsView } from './components/reports/MoreReportsView';
import { ENTRIES_REPORTS } from './lib/reports';
import { ContactsView } from './components/contacts/ContactsView';
import { CashflowView } from './components/cashflow/CashflowView';
import { CompanySettings } from './components/settings/CompanySettings';
import { CategoriesSettings } from './components/settings/CategoriesSettings';
import { CostCentersSettings } from './components/settings/CostCentersSettings';
import { RulesSettings } from './components/settings/RulesSettings';
import { UsersSettings } from './components/settings/UsersSettings';
import { NiboImportSettings } from './components/settings/NiboImportSettings';
import { AdvancedSettings } from './components/settings/AdvancedSettings';
import { contactSectionFor } from './lib/contacts';
import { EntriesView } from './components/entries/EntriesView';
import { RecurrencesView } from './components/entries/RecurrencesView';
import { entryRoute } from './lib/entries';

/** Configurações só para administradores (o menu já esconde; isto cobre links diretos) */
const NoPermission: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white text-slate-600">
    <Lock className="w-8 h-8 text-slate-400 mb-3" />
    <p className="text-base font-medium text-slate-700">Você não tem permissão para esta área</p>
    <p className="text-sm mt-1">As configurações da empresa ficam com administradores e proprietários.</p>
  </div>
);

const MainLayout: React.FC = () => {
  const { activeModule, setActiveModule, can, role } = useCompany();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadTargetAccountId, setUploadTargetAccountId] = useState<string | undefined>(undefined);
  const [isNewAccountOpen, setIsNewAccountOpen] = useState(false);

  const [uploadKind, setUploadKind] = useState<ImportKind | undefined>(undefined);
  const handleOpenUpload = (accountId?: string, kind?: ImportKind) => {
    setUploadTargetAccountId(accountId);
    setUploadKind(kind);
    setIsUploadModalOpen(true);
  };

  const renderActiveModule = () => {
    if (isSettingsModule(activeModule) && !can('ADMIN')) return <NoPermission />;
    switch (activeModule) {
      case 'resumo':
        return (
          <ResumoView
            onOpenUpload={handleOpenUpload}
            onNavigate={(mod) => setActiveModule(mod)}
          />
        );
      case 'contas-extratos':
        return <AccountsAndStatements onOpenUpload={handleOpenUpload} onAddAccount={() => setIsNewAccountOpen(true)} />;
      case 'rel-painel':
        return <PanelView />;
      case 'rel-receber':
      case 'rel-recebidas':
      case 'rel-pagar':
      case 'rel-pagas':
        return <EntriesReportView key={activeModule} config={ENTRIES_REPORTS[activeModule]} />;
      case 'rel-mais':
        return <MoreReportsView />;
      case 'fluxo-caixa':
        return <CashflowView />;
      case 'clientes':
      case 'fornecedores':
      case 'funcionarios':
      case 'socios': {
        const section = contactSectionFor(activeModule)!;
        return <ContactsView key={section.module} section={section} />;
      }
      case 'contas-receber':
      case 'agendar-receber':
      case 'recorrencias-receber':
      case 'contas-pagar':
      case 'agendar-pagar':
      case 'recorrencias-pagar': {
        const route = entryRoute(activeModule)!;
        if (route.tab === 'recurrences') return <RecurrencesView key={activeModule} config={route.config} />;
        return (
          <EntriesView
            key={route.config.listModule}
            config={route.config}
            openScheduleOnMount={route.tab === 'schedule'}
            onScheduleClosed={() => route.tab === 'schedule' && setActiveModule(route.config.listModule)}
          />
        );
      }
      case 'config-empresa':
        return <CompanySettings />;
      case 'config-categorias':
        return <CategoriesSettings />;
      case 'config-centros-custo':
        return <CostCentersSettings />;
      case 'config-regras':
        return <RulesSettings />;
      case 'config-usuarios':
        return <UsersSettings />;
      case 'config-avancado':
        return <AdvancedSettings />;
      case 'config-importacao':
        return <NiboImportSettings />;
      default:
        return (
          <ResumoView
            onOpenUpload={handleOpenUpload}
            onNavigate={(mod) => setActiveModule(mod)}
          />
        );
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#f4f6f9] text-slate-800 overflow-hidden font-sans">
      {/* 1. Sidebar de 2 Níveis Nibo (Trilho Navy + Menu Branco) */}
      <Sidebar />

      {/* 2. Área Principal de Conteúdo */}
      <div className="flex flex-col flex-1 h-screen overflow-hidden">
        {/* Header Superior com Seletor Global de Empresas */}
        <Header onOpenUpload={() => handleOpenUpload()} />

        {/* Sub-Header: Abas da Seção (Resumo | Contas & Extratos | Fluxo de caixa) */}
        <SubHeader />

        {/* Papéis de leitura: o sistema mostra tudo, mas as ações de gravação são recusadas */}
        {!can('FINANCIAL_OPERATOR') && (
          <div role="status" className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-2 shrink-0">
            <Eye className="w-3.5 h-3.5 shrink-0" />
            <span>
              Acesso de <strong>{ROLE_LABEL[role]}</strong>: você pode consultar tudo, mas não lançar nem alterar dados nesta empresa.
            </span>
          </div>
        )}

        {/* Conteúdo do Módulo Ativo */}
        <main className="flex-1 overflow-hidden flex flex-col relative bg-[#f4f6f9]">
          {renderActiveModule()}
        </main>
      </div>

      {/* Modal Global de Upload & Dropzone OFX/XLSX */}
      <OFXDropzoneModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        defaultAccountId={uploadTargetAccountId}
        kind={uploadKind}
        onAddAccount={() => {
          setIsUploadModalOpen(false);
          setIsNewAccountOpen(true);
        }}
      />

      {/* Gaveta lateral de cadastro de conta (Nibo: "Nova conta") */}
      <NewAccountDrawer isOpen={isNewAccountOpen} onClose={() => setIsNewAccountOpen(false)} />
    </div>
  );
};

/** Portão do app: link de acesso (convite/redefinição) → login → sistema */
export function App() {
  const auth = useAuthState();
  const [accessToken, setAccessToken] = useState(() => new URLSearchParams(window.location.search).get('acesso'));
  const leaveAccess = () => {
    window.history.replaceState(null, '', window.location.pathname); // o token não fica na barra de endereço
    setAccessToken(null);
  };

  if (accessToken) {
    return (
      <AccessPage
        token={accessToken}
        onSignedIn={(user) => {
          leaveAccess();
          auth.signedIn(user);
        }}
        onCancel={leaveAccess}
      />
    );
  }
  if (auth.user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f6f9]">
        <Loader2 className="w-6 h-6 text-nibo-blue animate-spin" aria-label="Carregando" />
      </div>
    );
  }
  if (!auth.user) return <LoginPage onSignedIn={auth.signedIn} expired={auth.expired} />;

  return (
    <AuthProvider value={{ user: auth.user, logout: auth.logout, setUser: auth.setUser }}>
      {/* key: trocar de usuário recarrega empresas e dados do zero */}
      <CompanyProvider key={auth.user.id}>
        <MainLayout />
      </CompanyProvider>
    </AuthProvider>
  );
}

export default App;
