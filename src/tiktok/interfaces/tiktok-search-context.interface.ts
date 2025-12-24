export interface TikTokSearchContext {
  category: string | null;
  results_count: number | null;
  location: string | null;
  followers_range: string | null;
  country_code: string | null;
  search_terms: string[] | null;
}
