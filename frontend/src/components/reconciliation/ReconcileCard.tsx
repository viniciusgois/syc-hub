import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, Calendar, Link2, Loader2, Pencil, Plus, RotateCcw, Search, Sparkles, Split, Trash2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { categoryChoices } from '../../lib/categories';
import { brDate, contactOptions, money } from '../../lib/entries';
import { CostCenterOption } from '../common/useCostCenters';
import { Transaction } from '../../types';
import { SearchSelect } from '../common/SearchSelect';

export type CardAction = 'rule' | 'detail' | 'search' | 'split' | 'ignore' | 'restore';

type Tab = 'suggestion' | 'new' | 'search';
type Kind = 'entry' | 'transfer';

const inputClass = 'w-full h-9 px-3 rounded border border-slate-300 text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight';

/**
 * Uma movimentação importada (esquerda) e como ela entra no extrato do sistema (direita):
 * Sugestão (conta agendada, transferência ou regra), Nova transação, ou Buscar / Criar vários.
 */
export const ReconcileCard: React.FC<{
  tx: Transaction;
  showGuesses: boolean;
  costCenters: CostCenterOption[];
  onAction: (action: CardAction, tx: Transaction) => void;
  onDone: () => Promise<void>;
}> = ({ tx, showGuesses, costCenters, onAction, onDone }) => {
  const { currentCompany, accounts, categories, contacts, notify } = useCompany();
  const isCredit = tx.type === 'CREDIT';
  const ignored = tx.reconciliationStatus === 'IGNORED';
  const ruleSuggestion = tx.reconciliationStatus === 'SUGGESTED' && tx.suggestedCategoryId ? tx : null;

  // Sugestões disponíveis (a primeira vem marcada)
  const suggestions = useMemo(() => {
    const list: { key: string; title: string; detail: string; amount?: number; badge?: string }[] = [];
    if (tx.matchSuggestion) {
      const m = tx.matchSuggestion;
      list.push({
        key: 'entry',
        title: `${isCredit ? 'Recebimento' : 'Pagamento'} agendado: ${m.description}`,
        detail: [`venc. ${brDate(m.dueDate)}`, m.contactName, m.categoryName].filter(Boolean).join(' · '),
        amount: m.openAmount,
        badge: m.exactAmount ? 'VALOR EXATO' : undefined,
      });
    }
    if (tx.transferSuggestion) {
      const t = tx.transferSuggestion;
      list.push({
        key: 'transfer',
        title: `Transferência ${isCredit ? 'de' : 'para'} ${t.accountName}`,
        detail: `${brDate(t.date)} · ${t.description}`,
        amount: tx.amount,
      });
    }
    if (ruleSuggestion) {
      list.push({
        key: 'rule',
        title: categories.find((c) => c.id === ruleSuggestion.suggestedCategoryId)?.name ?? 'Categoria sugerida',
        detail: [ruleSuggestion.ruleMatchReason, contacts.find((c) => c.id === ruleSuggestion.suggestedContactId)?.name].filter(Boolean).join(' · '),
      });
    }
    return list;
  }, [tx, isCredit, ruleSuggestion, categories, contacts]);

  // Palpite: regra, ou a última linha conciliada com a mesma descrição
  const guess = showGuesses
    ? ruleSuggestion
      ? { categoryId: ruleSuggestion.suggestedCategoryId ?? '', contactId: ruleSuggestion.suggestedContactId ?? '', costCenterId: '' }
      : tx.guess
        ? { categoryId: tx.guess.categoryId, contactId: tx.guess.contactId ?? '', costCenterId: tx.guess.costCenterId ?? '' }
        : null
    : null;

  const [tab, setTab] = useState<Tab>(suggestions.length ? 'suggestion' : 'new');
  const [picked, setPicked] = useState(suggestions[0]?.key ?? '');
  const [kind, setKind] = useState<Kind>('entry');
  const [form, setForm] = useState({
    contactId: guess?.contactId ?? '',
    description: tx.description,
    categoryId: guess?.categoryId ?? '',
    costCenterId: guess?.costCenterId ?? '',
    otherAccountId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const catOptions = useMemo(
    () =>
      // Natureza da movimentação primeiro; a oposta continua disponível (ex.: estorno)
      [...categoryChoices(categories, isCredit ? 'INCOME' : 'EXPENSE'), ...categoryChoices(categories, isCredit ? 'EXPENSE' : 'INCOME')].map((o) => ({
        value: o.value,
        label: `${o.type === 'INCOME' ? '↑' : '↓'} ${o.label}`,
        group: o.group,
      })),
    [categories, isCredit],
  );
  const contOptions = useMemo(() => contactOptions(contacts, isCredit ? 'RECEIVABLE' : 'PAYABLE'), [contacts, isCredit]);
  const otherAccounts = accounts.filter((a) => a.id !== tx.bankAccountId);
  const base = `/companies/${currentCompany.id}/transactions`;

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      notify(message);
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const transfer = (otherId: string, counterpartId?: string) =>
    api.post(`${base}/transfer`, {
      fromAccountId: isCredit ? otherId : tx.bankAccountId,
      toAccountId: isCredit ? tx.bankAccountId : otherId,
      transactionId: tx.id,
      counterpartId: counterpartId ?? null,
    });

  const confirm = () => {
    if (tab === 'suggestion') {
      if (picked === 'entry' && tx.matchSuggestion) {
        // Valor diferente: escolher juros/desconto ou baixa parcial no diálogo
        if (Math.abs(tx.matchSuggestion.openAmount - tx.amount) >= 0.005) return onAction('search', tx);
        const m = tx.matchSuggestion;
        return run(() => api.post(`${base}/${tx.id}/match`, { entries: [{ direction: m.direction, id: m.id }] }), 'Movimentação conciliada com a conta agendada');
      }
      if (picked === 'transfer' && tx.transferSuggestion) {
        const t = tx.transferSuggestion;
        return run(() => transfer(t.bankAccountId, t.transactionId), 'Transferência conciliada nas duas contas');
      }
      if (picked === 'rule') return run(() => api.post(`${base}/${tx.id}/reconcile`, {}), 'Movimentação conciliada');
      return setError('Escolha uma sugestão');
    }
    if (tab === 'search') return onAction('search', tx);
    if (kind === 'transfer') {
      if (!form.otherAccountId) return setError(`Escolha a conta de ${isCredit ? 'origem' : 'destino'}`);
      return run(() => transfer(form.otherAccountId), 'Transferência registrada');
    }
    if (!form.categoryId) return setError('Selecione a categoria');
    return run(
      () =>
        api.post(`${base}/${tx.id}/reconcile`, {
          categoryId: form.categoryId,
          contactId: form.contactId || null,
          costCenterId: form.costCenterId || null,
          customDescription: form.description.trim() && form.description.trim() !== tx.description ? form.description.trim() : null,
        }),
      'Movimentação conciliada',
    );
  };

  const Arrow = isCredit ? ArrowUp : ArrowDown;
  const tabs: [Tab, string][] = [
    ['suggestion', 'Sugestão'],
    ['new', 'Nova transação'],
    ['search', 'Buscar / Criar vários'],
  ];

  return (
    <article className="border border-slate-200 rounded flex flex-col md:flex-row bg-white" aria-label={`${brDate(tx.date)} ${tx.description}`}>
      {/* Movimentação importada */}
      <div className="md:w-[340px] shrink-0 p-4 flex flex-col border-b md:border-b-0 md:border-r border-slate-200">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[15px] text-slate-800">
            <Calendar className="w-4 h-4 text-slate-500" />
            {brDate(tx.date)}
          </span>
          <span className={`flex items-center gap-0.5 text-[15px] font-medium ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
            <Arrow className="w-4 h-4" />
            {money(tx.amount)}
          </span>
        </div>
        <p className="mt-3 text-[13px] text-slate-700 uppercase break-words">{tx.description}</p>
        {tx.checknum && <p className="mt-1 text-xs text-slate-500">Doc. {tx.checknum}</p>}
        <div className="mt-auto pt-4 flex items-center justify-between">
          {ignored ? (
            <span className="text-xs text-slate-500">Descartada</span>
          ) : (
            <button type="button" onClick={() => onAction('rule', tx)} className="text-sm text-nibo-blue hover:underline flex items-center gap-1">
              <Plus className="w-4 h-4" /> Criar regra
            </button>
          )}
          {ignored ? (
            <button type="button" onClick={() => onAction('restore', tx)} className="text-sm text-nibo-blue hover:underline flex items-center gap-1">
              <RotateCcw className="w-4 h-4" /> Restaurar
            </button>
          ) : (
            <button type="button" onClick={() => onAction('ignore', tx)} title="Descartar movimentação" aria-label="Descartar movimentação" className="p-1 rounded text-nibo-blue hover:bg-slate-100">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Como entra no extrato do sistema */}
      {!ignored && (
        <div className="flex-1 min-w-0 bg-slate-50 p-3 flex gap-3">
          <div className="flex-1 min-w-0">
            <div role="tablist" className="flex flex-wrap gap-1 mb-0">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    setTab(key);
                    setError(null);
                  }}
                  className={`px-4 h-9 text-[13px] rounded-t ${tab === key ? 'bg-white text-slate-900 font-medium' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {label}
                  {key === 'suggestion' && suggestions.length > 0 && <Sparkles className="inline w-3.5 h-3.5 ml-1 text-amber-500" />}
                </button>
              ))}
            </div>
            <div className="bg-white rounded-b rounded-tr p-3 min-h-[110px]">
              {tab === 'suggestion' &&
                (suggestions.length === 0 ? (
                  <p className="text-sm text-slate-500 py-3">
                    Nenhuma sugestão para esta movimentação. Use <strong>Nova transação</strong> para classificar ou <strong>Buscar</strong> para ligar a um lançamento agendado.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {suggestions.map((s) => (
                      <li key={s.key}>
                        <label className={`flex items-center gap-3 px-2.5 py-2 rounded border cursor-pointer ${picked === s.key ? 'border-nibo-blue bg-nibo-blueLight' : 'border-slate-200 hover:bg-slate-50'}`}>
                          <input type="radio" name={`sug-${tx.id}`} checked={picked === s.key} onChange={() => setPicked(s.key)} className="accent-nibo-blue" />
                          {s.key === 'transfer' ? <ArrowLeftRight className="w-4 h-4 text-slate-500 shrink-0" /> : s.key === 'entry' ? <Link2 className="w-4 h-4 text-slate-500 shrink-0" /> : <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />}
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-slate-800 truncate">{s.title}</span>
                            {s.detail && <span className="block text-xs text-slate-500 truncate">{s.detail}</span>}
                          </span>
                          {s.badge && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{s.badge}</span>}
                          {s.amount !== undefined && <span className="text-sm whitespace-nowrap">R$ {money(s.amount)}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                ))}

              {tab === 'new' && (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2.5">
                    <select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputClass}>
                      <option value="entry">{isCredit ? 'Recebimento' : 'Pagamento'}</option>
                      <option value="transfer">Transferência</option>
                    </select>
                    {kind === 'entry' ? (
                      <SearchSelect value={form.contactId} onChange={(v) => set('contactId', v)} options={contOptions} placeholder="Nome" clearable size="sm" />
                    ) : (
                      <select aria-label={isCredit ? 'Conta de origem' : 'Conta de destino'} value={form.otherAccountId} onChange={(e) => set('otherAccountId', e.target.value)} className={`${inputClass} ${form.otherAccountId ? '' : 'text-slate-400'}`}>
                        <option value="">{isCredit ? 'Veio da conta...' : 'Foi para a conta...'}</option>
                        {otherAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {kind === 'entry' && (
                    <div className={`grid grid-cols-1 gap-2.5 ${costCenters.length ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                      <input aria-label="Descrição" value={form.description} onChange={(e) => set('description', e.target.value)} className={inputClass} />
                      <SearchSelect value={form.categoryId} onChange={(v) => set('categoryId', v)} options={catOptions} placeholder="Categoria" size="sm" />
                      {costCenters.length > 0 && (
                        <select aria-label="Centro de custo" value={form.costCenterId} onChange={(e) => set('costCenterId', e.target.value)} className={`${inputClass} ${form.costCenterId ? '' : 'text-slate-400'}`}>
                          <option value="">Centro de custo</option>
                          {costCenters.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {kind === 'entry' && (
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      <button type="button" onClick={() => onAction('detail', { ...tx, contactId: form.contactId || undefined, categoryId: form.categoryId || undefined, costCenterId: form.costCenterId || undefined, customDescription: form.description })} className="text-sm text-nibo-blue hover:underline flex items-center gap-1">
                        <Pencil className="w-3.5 h-3.5" /> Criar agendamento detalhado
                      </button>
                      {currentCompany.splitsEnabled && (
                        <button type="button" onClick={() => onAction('split', tx)} className="text-sm text-nibo-blue hover:underline flex items-center gap-1">
                          <Split className="w-3.5 h-3.5" /> Ratear entre categorias
                        </button>
                      )}
                      {guess && (form.categoryId === guess.categoryId) && <span className="text-xs text-amber-700 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> palpite</span>}
                    </div>
                  )}
                </div>
              )}

              {tab === 'search' && (
                <div className="space-y-2 py-1">
                  <p className="text-sm text-slate-600">Ligue esta movimentação a um ou vários {isCredit ? 'recebimentos' : 'pagamentos'} já agendados, ou divida o valor entre várias categorias.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => onAction('search', tx)} className="h-9 px-3.5 rounded border border-nibo-blue text-nibo-blue text-sm hover:bg-nibo-blueLight flex items-center gap-1.5">
                      <Search className="w-4 h-4" /> Buscar {isCredit ? 'recebimentos' : 'pagamentos'} em aberto
                    </button>
                    {currentCompany.splitsEnabled && (
                      <button type="button" onClick={() => onAction('split', tx)} className="h-9 px-3.5 rounded border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 flex items-center gap-1.5">
                        <Split className="w-4 h-4" /> Criar vários (rateio)
                      </button>
                    )}
                  </div>
                </div>
              )}
              {error && (
                <p className="text-sm text-rose-600 mt-2" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || (tab === 'suggestion' && !suggestions.length)}
            className="self-center w-14 h-12 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center justify-center disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'OK'}
          </button>
        </div>
      )}
    </article>
  );
};
