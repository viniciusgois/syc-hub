import React from 'react';
import { useCompany } from '../../context/CompanyContext';
import { formatDocument } from '../../lib/documents';

/** Cabeçalho que só aparece na impressão (como no Nibo): logo, razão social e CNPJ da empresa */
export const PrintHeader: React.FC = () => {
  const { currentCompany } = useCompany();
  return (
    <div className="hidden print:flex items-center gap-3 px-6 pt-2 pb-3 mb-2 border-b border-slate-200">
      {currentCompany.logoUrl && <img src={currentCompany.logoUrl} alt="" className="w-11 h-11 object-contain" />}
      <div>
        <p className="text-sm font-medium text-slate-800 uppercase">{currentCompany.legalName}</p>
        <p className="text-xs text-slate-500">{formatDocument(currentCompany.cnpj)}</p>
      </div>
    </div>
  );
};
