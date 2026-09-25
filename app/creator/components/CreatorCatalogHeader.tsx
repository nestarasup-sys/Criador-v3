import type { ChangeEventHandler, RefObject } from "react";
import type { Category, CompositionMode, FaceMode } from "../../domain/character-primitives";

type CreatorCatalogHeaderProps = {
  category: Category;
  faceMode: FaceMode;
  compositionMode: CompositionMode;
  compositionAvailable: boolean;
  isProcessing: boolean;
  hasFrontHair: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  sheetInputRef: RefObject<HTMLInputElement | null>;
  singleHairInputRef: RefObject<HTMLInputElement | null>;
  hairPairSheetInputRef: RefObject<HTMLInputElement | null>;
  expressionPackInputRef: RefObject<HTMLInputElement | null>;
  deleteMode: boolean;
  selectedCount: number;
  canDeleteAssets: boolean;
  onImportItem: ChangeEventHandler<HTMLInputElement>;
  onImportSheet: ChangeEventHandler<HTMLInputElement>;
  onImportFrontHair: ChangeEventHandler<HTMLInputElement>;
  onImportHairPairSheet: ChangeEventHandler<HTMLInputElement>;
  onImportExpressionPack: ChangeEventHandler<HTMLInputElement>;
  onToggleDeleteMode: () => void;
  onDeleteSelected: () => void;
  onToggleCompositionMode: () => void;
};

const CATEGORY_LABELS: Record<Category, string> = {
  cabelos: "Cabelo (frente)",
  cabelosTras: "Cabelo (trás)",
  rostos: "Rostos",
  roupas: "Roupas",
};

export function CreatorCatalogHeader({ category, faceMode, compositionMode, compositionAvailable, isProcessing, hasFrontHair, fileInputRef, sheetInputRef, singleHairInputRef, hairPairSheetInputRef, expressionPackInputRef, deleteMode, selectedCount, canDeleteAssets, onImportItem, onImportSheet, onImportFrontHair, onImportHairPairSheet, onImportExpressionPack, onToggleDeleteMode, onDeleteSelected, onToggleCompositionMode }: CreatorCatalogHeaderProps) {
  const supportsAssetDelete = category !== "rostos" || faceMode !== "pack";
  const canToggleComposition = category === "rostos" && compositionAvailable;

  return <div className="catalog-header">
    <div>
      <span>CATÁLOGO</span>
      <h2>{CATEGORY_LABELS[category]}</h2>
    </div>
    <div className="import-actions">
      {category === "rostos" && (
        <button
          type="button"
          className={`composition-toggle-button ${compositionMode === "outfit-over-face" ? "active" : ""}`}
          onClick={onToggleCompositionMode}
          disabled={isProcessing || !canToggleComposition}
          aria-pressed={compositionMode === "outfit-over-face"}
          title={canToggleComposition ? "Alternar entre o modelo na frente e a roupa na frente" : "Selecione um rosto, um pack ou um modelo de cabeça 15+ para alternar as camadas"}
        >
          Camada {compositionMode === "outfit-over-face" ? "V2" : "V1"}
        </button>
      )}
      {category === "rostos" && faceMode === "base" ? null : category === "rostos" && faceMode === "pack" ? (
        <button className="add-button" onClick={() => expressionPackInputRef.current?.click()} disabled={isProcessing}>
          {isProcessing ? "Processando…" : "＋ Pack 3×3"}
        </button>
      ) : category === "cabelos" ? (
        <>
          <button className="sheet-button" onClick={() => singleHairInputRef.current?.click()} disabled={isProcessing} title="Importar somente um cabelo frontal">
            ＋ Item
          </button>
          <button className="add-button" onClick={() => fileInputRef.current?.click()} disabled={isProcessing} title="Importar um par: traseiro à esquerda e frontal à direita">
            ＋ Par
          </button>
          <button type="button" className="sheet-button" disabled title="Par V2: cabelo frontal acima e cabelo traseiro abaixo">
            Par V2
          </button>
          <button className="sheet-button" onClick={() => hairPairSheetInputRef.current?.click()} disabled={isProcessing} title="Importar folha 3×2 com três pares">
            Folha · 3 pares
          </button>
        </>
      ) : (
        <>
          {category !== "cabelosTras" && (
            <button className="sheet-button" onClick={() => sheetInputRef.current?.click()} disabled={isProcessing} title={category === "roupas" ? "Importar uma roupa com três, quatro ou seis versões" : "Recortar vários itens de uma imagem"}>
              {category === "roupas" ? "Folha de variantes" : "Folha"}
            </button>
          )}
          <button
            className="add-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing || (category === "cabelosTras" && !hasFrontHair)}
            title={category === "cabelosTras" && !hasFrontHair ? "Selecione primeiro um cabelo frontal" : undefined}
          >
            {isProcessing ? "Processando…" : "＋ Item"}
          </button>
        </>
      )}
      {supportsAssetDelete && (
        <>
          <button
            type="button"
            className={`asset-delete-mode-button ${deleteMode ? "active" : ""}`}
            onClick={onToggleDeleteMode}
            disabled={isProcessing || !canDeleteAssets}
            aria-pressed={deleteMode}
            title={deleteMode ? "Sair do modo de seleção" : "Selecionar itens para apagar"}
          >
            {deleteMode ? "Cancelar" : "Excluir"}
          </button>
          {deleteMode && (
            <button
              type="button"
              className="asset-delete-selected-button"
              onClick={onDeleteSelected}
              disabled={isProcessing || selectedCount === 0}
              title={selectedCount === 0 ? "Selecione pelo menos um item" : `Apagar ${selectedCount} selecionado(s)`}
            >
              Apagar{selectedCount > 0 ? ` · ${selectedCount}` : ""}
            </button>
          )}
        </>
      )}
    </div>
    <input ref={fileInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportItem} />
    <input ref={sheetInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportSheet} />
    <input ref={singleHairInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportFrontHair} />
    <input ref={hairPairSheetInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportHairPairSheet} />
    <input ref={expressionPackInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportExpressionPack} />
  </div>;
}
