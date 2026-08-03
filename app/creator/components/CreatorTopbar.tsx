import { NymiConnectionStatus, NymiNavigation } from "../../shared/NymiShell";

type CreatorTopbarProps = {
  connected: boolean;
  notice: string;
  usesBuiltInBase: boolean;
  hasExpressionPack: boolean;
  exportingPack: boolean;
  onNew: () => void;
  onSave: () => void;
  onExportPack: () => void;
  onExportPng: () => void;
};

export function CreatorTopbar({ connected, notice, usesBuiltInBase, hasExpressionPack, exportingPack, onNew, onSave, onExportPack, onExportPng }: CreatorTopbarProps) {
  return <header className="topbar">
    <div className="brand">
      <div className="brand-mark"><span>✦</span></div>
      <div><h1>Nymi Gacha</h1><p aria-label="Estúdio de personagens">Premium Character Studio</p></div>
    </div>
    <div className="top-actions">
      <NymiConnectionStatus connected={connected} detail={notice} />
      <span className="notice-pill" title={notice}>{notice}</span>
      <NymiNavigation active="characters" compact />
      <button className="button secondary" onClick={onNew}>＋ Novo</button>
      <button className="button secondary" onClick={onSave}>▣ Salvar</button>
      {(usesBuiltInBase || hasExpressionPack) && <button className="button secondary" onClick={onExportPack} disabled={exportingPack}>
        {exportingPack ? "Montando ZIP…" : "Exportar ZIP"}
      </button>}
      <button className="button primary" onClick={onExportPng}>⇩ Exportar PNG</button>
    </div>
  </header>;
}
