/**
 * Instagram profile analysis result from LLM
 */
export interface InstagramAnalysisResult {
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
  message?: string; // Error or warning message if profile is private or data unsuitable
}

