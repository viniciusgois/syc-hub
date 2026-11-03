/** Abas de Configurações (módulo de navegação -> rótulo) */
export const SETTINGS_TABS = [
  { module: 'config-empresa', label: 'Empresa' },
  { module: 'config-categorias', label: 'Categorias' },
  { module: 'config-centros-custo', label: 'Centros de custo' },
  { module: 'config-regras', label: 'Regras' },
  { module: 'config-usuarios', label: 'Usuários' },
  { module: 'config-avancado', label: 'Avançado' },
  { module: 'config-importacao', label: 'Importar do NIBO' },
] as const;

export const isSettingsModule = (module: string) => SETTINGS_TABS.some((t) => t.module === module);
