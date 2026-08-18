export type BaseDadosVideo = {
  id: string;
  sequence: number;
  fileName: string;
  originalName: string;
  storedPath: string;
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
  videos: BaseDadosVideo[];
  updatedAt: string;
};
