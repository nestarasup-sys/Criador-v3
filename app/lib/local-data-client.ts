/** Single source for the loopback data-service endpoint used by the UI. */
export const LOCAL_DATA_URL = "http://127.0.0.1:4318";

export function localDataFetch(path: string, init?: RequestInit) {
  return fetch(`${LOCAL_DATA_URL}${path}`, init);
}
