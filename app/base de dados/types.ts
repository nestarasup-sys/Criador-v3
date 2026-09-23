export type BaseDadosVideo = {
  id: string;
  sequence: number;
  fileName: string;
  originalName: string;
  storedPath: string;
  absolutePath?: string;
  /** Estado derivado pelo servidor ao conferir a pasta local. */
  fileAvailable?: boolean;
  url?: string;
  contentType: string;
  size: number;
  /** SHA-256 do conteúdo; impede cópias físicas do mesmo vídeo. */
  contentHash?: string;
  durationSeconds: number;
  description: string;
  sceneEndSeconds: number;
  /** Segundo em que a primeira reação coletiva pode começar. */
  firstGroupReactionSeconds: number;
  /** Segundo em que a segunda reação coletiva pode começar. */
  secondGroupReactionSeconds: number;
  /** Contexto adicional enviado nas exportações que alimentam a IA. */
  additionalAiContext: string;
  /** Incremented by the local server for every metadata commit. */
  metadataRevision?: number;
  createdAt: string;
  updatedAt: string;
};

export type BaseDadosState = {
  app: "NYMI_BASE_DADOS_V1";
  version: 1;
  /** Próxima sequência reservada; evita reutilizar números excluídos. */
  nextSequence?: number;
  videos: BaseDadosVideo[];
  updatedAt: string;
};

export type BaseDadosDraftState = {
  app: "NYMI_BASE_DADOS_DRAFTS_V1";
  version: 1;
  videos: BaseDadosVideo[];
  updatedAt: string;
};
