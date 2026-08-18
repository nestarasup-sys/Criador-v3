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
  durationSeconds: number;
  description: string;
  sceneEndSeconds: number;
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
