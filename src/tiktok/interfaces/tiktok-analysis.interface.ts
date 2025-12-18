/**
 * TikTok profile analysis result from LLM
 */
export interface TikTokAnalysisResult {
  summary: string;
  qualityScore: number; // 1-5
  topic?: string;
  niche?: string;
  sponsoredFrequency?: string;
  contentAuthenticity?: string;
  followerAuthenticity?: string;
  visibleBrands?: string[];
  engagementStrength?: string;
  postsAnalysis?: string;
  hashtagsStatistics?: string;
  message?: string;
}

