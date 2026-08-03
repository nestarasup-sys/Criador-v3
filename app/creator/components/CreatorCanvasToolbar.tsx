import type { ReactNode } from "react";

type CreatorCanvasToolbarProps = {
  fitMode: boolean;
  hasActiveItem: boolean;
  eraserMode: boolean;
  chromaMode: boolean;
  chromaEligibleItem: boolean;
  isProcessing: boolean;
  previewPanMode: boolean;
  exportFrameMode: boolean;
  exportTouchesEdge: boolean;
  onToggleFit: () => void;
  onToggleEraser: () => void;
  onToggleChroma: () => void;
  onTogglePan: () => void;
  onToggleExportFrame: () => void;
  onReset: () => void;
};

function ToolButton({ children, className, disabled, onClick, title }: { children: ReactNode; className?: string; disabled?: boolean; onClick: () => void; title: string }) {
  return <button className={className} disabled={disabled} onClick={onClick} title={title}>{children}</button>;
}

export function CreatorCanvasToolbar({ fitMode, hasActiveItem, eraserMode, chromaMode, chromaEligibleItem, isProcessing, previewPanMode, exportFrameMode, exportTouchesEdge, onToggleFit, onToggleEraser, onToggleChroma, onTogglePan, onToggleExportFrame, onReset }: CreatorCanvasToolbarProps) {
  return <div className="stage-tools">
    <ToolButton
      className={`fit-mode-button ${fitMode ? "active" : ""}`}
      disabled={!hasActiveItem}
      onClick={onToggleFit}
      title="Encaixar no canvas: ajustar o item selecionado diretamente"
    >
      <span aria-hidden="true">◰</span>{fitMode ? "Encaixando" : "Encaixar"}
    </ToolButton>
    <ToolButton
      className={`eraser-mode-button ${eraserMode ? "active" : ""}`}
      onClick={onToggleEraser}
      title="Borracha por camada"
    >
      <span aria-hidden="true">◇</span>{eraserMode ? "Borracha ativa" : "Borracha"}
    </ToolButton>
    <ToolButton
      className={`chroma-mode-button ${chromaMode ? "active" : ""}`}
      disabled={!chromaEligibleItem || isProcessing}
      onClick={onToggleChroma}
      title={chromaEligibleItem ? "Remove manualmente o fundo da peça selecionada" : "Selecione uma roupa, cabelo ou rosto avulso"}
    >
      <span aria-hidden="true">◉</span>{chromaMode ? "Chroma ativo" : "Chroma Key"}
    </ToolButton>
    <ToolButton
      className={`pan-mode-button ${previewPanMode ? "active" : ""}`}
      onClick={onTogglePan}
      title="Mover preview: move somente a visualização deste personagem"
    >
      <span aria-hidden="true">✥</span>{previewPanMode ? "Movendo" : "Mover"}
    </ToolButton>
    <ToolButton
      className={`export-frame-button ${exportFrameMode ? "active" : ""} ${exportTouchesEdge ? "warning" : ""}`}
      onClick={onToggleExportFrame}
      title="Enquadrar exportação: reposiciona o personagem no PNG e no ZIP finais"
    >
      <span aria-hidden="true">⌗</span>{exportFrameMode ? "Enquadrando" : "Enquadrar"}
    </ToolButton>
    <ToolButton className="pan-reset-button" onClick={onReset} title="Restaurar visualização e enquadramento">
      <span aria-hidden="true">↻</span>Reiniciar
    </ToolButton>
  </div>;
}
