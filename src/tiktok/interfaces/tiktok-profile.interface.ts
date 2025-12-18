import { TikTokAnalysisResult } from './tiktok-analysis.interface';

/**
 * We treat BrightData TikTok profile payload as a loosely-typed object,
 * because the dataset schema can vary.
 */
export type TikTokProfile = Record<string, unknown>;

/**
 * Response data structure from the TikTok profile analysis endpoint
 */
export interface TikTokAnalysisData {
  profile: string;
  data: TikTokProfile;
  analysis: TikTokAnalysisResult;
}
