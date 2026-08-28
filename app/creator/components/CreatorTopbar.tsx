import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../../shared/NymiShell";

type CreatorTopbarProps = {
  connected: boolean;
  notice: string;
  usesBuiltInBase: boolean;
  hasExpressionPack: boolean;
  exportingPack: boolean;
  exportingVariants: boolean;
  onNew: () => void;
  onSave: () => void;
  onExportPack: () => void;
  onExportVariants: () => void;
  onExportPng: () => void;
};

export function CreatorTopbar({ connected, notice, usesBuiltInBase, hasExpressionPack, exportingPack, exportingVariants, onNew, onSave, onExportPack, onExportVariants, onExportPng }: CreatorTopbarProps) {
  return <header className="topbar creator-topbar">
    <NymiBrand />
    <div className="top-actions">
      <NymiConnectionStatus connected={connected} detail={notice} />
      <span className="notice-pill" title={notice}>{notice}</span>
      <NymiNavigation active="characters" compact />
      <button className="button secondary" onClick={onNew}>＋ Novo</button>
      <button className="button secondary" onClick={onSave}>▣ Salvar</button>
      {(usesBuiltInBase || hasExpressionPack) && <button className="button secondary" onClick={onExportPack} disabled={exportingPack}>
        {exportingPack ? "Montando ZIP…" : "Exportar ZIP"}
      </button>}
      {(usesBuiltInBase || hasExpressionPack) && <button className="button secondary" onClick={onExportVariants} disabled={exportingPack || exportingVariants}>
        {exportingVariants ? "Montando poses…" : "Exportar variantes"}
      </button>}
      <button className="button primary" onClick={onExportPng}>⇩ Exportar PNG</button>
    </div>
  </header>;
}
