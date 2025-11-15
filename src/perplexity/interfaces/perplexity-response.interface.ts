export interface PerplexityChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface HashtagData {
  hashtag: string;
  short_rationale: string;
  popularity_note: string;
}

export interface InfluencerData {
  name: string;
  handle: string;
  topic: string;
  followers: number;
  engagement_note: string;
  authenticity_score_guess: number;
}

export interface PerplexityPromptChainResponse {
  hashtags: HashtagData[];
  influencers: InfluencerData[];
  hashtagsResponse: PerplexityChatResponse;
  influencersResponse: PerplexityChatResponse;
}
