import { InstagramAnalysisResult } from './instagram-analysis.interface';

/**
 * Location information for Instagram posts
 */
export interface InstagramPostLocation {
  has_public_page: boolean;
  id: string;
  name: string;
  slug: string;
}

/**
 * Instagram post data structure
 */
export interface InstagramPost {
  caption: string | null;
  comments: number;
  datetime: string;
  id: string;
  image_url: string | null;
  likes: number;
  location: InstagramPostLocation | null;
  content_type: 'Video' | 'Carousel' | 'Photo';
  url: string;
  video_url: string | null;
  is_pinned: boolean;
}

/**
 * Input data structure from BrightData
 */
export interface InstagramProfileInput {
  url: string;
}

/**
 * Instagram profile data structure from BrightData scraper
 */
export interface InstagramProfile {
  account: string;
  fbid: string;
  id: string;
  followers: number;
  posts_count: number;
  is_business_account: boolean;
  is_professional_account: boolean;
  is_verified: boolean;
  avg_engagement: number;
  biography: string | null;
  following: number;
  posts: InstagramPost[];
  profile_image_link: string | null;
  profile_url: string;
  profile_name: string;
  highlights_count: number;
  full_name: string;
  is_private: boolean;
  url: string;
  is_joined_recently: boolean;
  has_channel: boolean;
  partner_id: string;
  business_address: string | null;
  related_accounts: unknown[];
  email_address: string | null;
  timestamp: string;
  input: InstagramProfileInput;
}

/**
 * Response data structure from the analysis endpoint
 */
export interface InstagramAnalysisData {
  profile: string;
  data: InstagramProfile;
  analysis: InstagramAnalysisResult;
}

/**
 * Complete API response structure
 */
export interface InstagramAnalysisResponse {
  statusCode: number;
  data: InstagramAnalysisData;
  message: string;
}

