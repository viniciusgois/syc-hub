import React from 'react';
import { useCompany } from '../../context/CompanyContext';
import { formatDocument } from '../../lib/documents';
import { Layers, ChevronRight, Sparkles } from 'lucide-react';

interface GenericModuleViewProps {
  title: string;
  category: string;
  description: string;
}

export const GenericModuleView: React.FC<GenericModuleViewProps> = ({
  title,
  category,
  description,
}) => {
  const { currentCompany } = useCompany();

  return (
    <div className="flex-1 overflow-y-auto bg-[#f4f6f9] p-6 space-y-6 text-slate-800">
      <div>
        <div className="flex items-center space-x-1.5 text-xs text-slate-500 mb-1">
          <span>{category}</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-blue-600 font-semibold">{title}</span>
        </div>
        <h1 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
          {title}
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
            {currentCompany.legalName}
          </span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>

      <div className="bg-white rounded-lg p-10 border border-slate-200 text-center flex flex-col items-center justify-center space-y-3 shadow-xs">
        <div className="w-12 h-12 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <Layers className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-800">Módulo de {title}</h2>
        <p className="text-xs text-slate-500 max-w-md">
          Este módulo está integrado ao contexto multi-empresa de <strong>{currentCompany.legalName}</strong> (CNPJ {formatDocument(currentCompany.cnpj)}). Todas as movimentações alimentam a Gestão de Caixa e a conciliação.
        </p>
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-700 font-semibold bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
          <Sparkles className="w-3.5 h-3.5" />
          Módulo Ativo no SYC Hub
        </span>
      </div>
    </div>
  );
};
