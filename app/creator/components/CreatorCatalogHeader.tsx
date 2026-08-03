import type { ChangeEventHandler, RefObject } from "react";
import type { Category, FaceMode } from "../../domain/character-primitives";

type CreatorCatalogHeaderProps = {
  category: Category;
  faceMode: FaceMode;
  isProcessing: boolean;
  hasFrontHair: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  sheetInputRef: RefObject<HTMLInputElement | null>;
  singleHairInputRef: RefObject<HTMLInputElement | null>;
  hairPairSheetInputRef: RefObject<HTMLInputElement | null>;
  expressionPackInputRef: RefObject<HTMLInputElement | null>;
  onImportItem: ChangeEventHandler<HTMLInputElement>;
  onImportSheet: ChangeEventHandler<HTMLInputElement>;
  onImportFrontHair: ChangeEventHandler<HTMLInputElement>;
  onImportHairPairSheet: ChangeEventHandler<HTMLInputElement>;
  onImportExpressionPack: ChangeEventHandler<HTMLInputElement>;
};

const CATEGORY_LABELS: Record<Category, string> = {
  cabelos: "Cabelo (frente)",
  cabelosTras: "Cabelo (trás)",
  rostos: "Rostos",
  roupas: "Roupas",
};

export function CreatorCatalogHeader({ category, faceMode, isProcessing, hasFrontHair, fileInputRef, sheetInputRef, singleHairInputRef, hairPairSheetInputRef, expressionPackInputRef, onImportItem, onImportSheet, onImportFrontHair, onImportHairPairSheet, onImportExpressionPack }: CreatorCatalogHeaderProps) {
  return <div className="catalog-header">
    <div>
      <span>CATÁLOGO</span>
      <h2>{CATEGORY_LABELS[category]}</h2>
    </div>
    <div className="import-actions">
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
          <button className="sheet-button" onClick={() => hairPairSheetInputRef.current?.click()} disabled={isProcessing} title="Importar folha 3×2 com três pares">
            Folha · 3 pares
          </button>
        </>
      ) : (
        <>
          {category !== "cabelosTras" && (
            <button className="sheet-button" onClick={() => sheetInputRef.current?.click()} disabled={isProcessing} title={category === "roupas" ? "Importar uma roupa com quatro ou seis versões" : "Recortar vários itens de uma imagem"}>
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
    </div>
    <input ref={fileInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportItem} />
    <input ref={sheetInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportSheet} />
    <input ref={singleHairInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportFrontHair} />
    <input ref={hairPairSheetInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportHairPairSheet} />
    <input ref={expressionPackInputRef} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={onImportExpressionPack} />
  </div>;
}
