export interface GoogleSerpResult {
  title: string;
  url: string;
  snippet?: string;
  position?: number;
}

export interface GoogleSerpResponse {
  query: string;
  results: GoogleSerpResult[];
  totalResults?: number;
}
