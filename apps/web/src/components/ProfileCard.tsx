import { useState, useEffect, useMemo } from 'react';
import { getApiBaseUrl } from '../api';

export type Platform = 'instagram' | 'tiktok';

export type ProfileData = {
  profile_name?: string;
  full_name?: string;
  profile_image_link?: string; // Instagram
  profile_pic_url?: string; // TikTok
  profile_url?: string;
  url?: string; // TikTok
  followers?: number;
  posts_count?: number;
  videos_count?: number;
  avg_engagement?: number;
  is_verified?: boolean;
  is_private?: boolean;
  // Allow additional platform-specific fields
  [key: string]: unknown;
};

export type ProfileAnalysis = {
  summary?: string;
  qualityScore?: number;
  topic?: string;
  niche?: string;
  engagementStrength?: string;
  contentAuthenticity?: string;
  followerAuthenticity?: string;
  // Allow additional platform-specific analysis fields
  [key: string]: unknown;
};

export type ProfileCardData = {
  platform: Platform;
  profile: string;
  data: ProfileData;
  analysis?: ProfileAnalysis;
};

type ProfileCardProps = {
  data: ProfileCardData;
};

type TikTokPostPreview = {
  url: string;
  caption: string | null;
  imageUrl: string | null;
  timestamp: number | null;
  engagementRate: number | null;
  followerCountAtPostTime: number | null;
  hashtags: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseAbbreviatedNumber(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;

  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;

  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([kmb])?\+?$/i);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;

  const suffix = match[2]?.toLowerCase();
  const multiplier =
    suffix === 'k'
      ? 1_000
      : suffix === 'm'
        ? 1_000_000
        : suffix === 'b'
          ? 1_000_000_000
          : 1;

  return base * multiplier;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = parseAbbreviatedNumber(normalized);
    if (parsed !== null) return parsed;

    const stripped = normalized
      .replace(/\b(views?|likes?|comments?|shares?|followers?)\b/gi, '')
      .trim();
    if (stripped && stripped !== normalized) {
      return parseAbbreviatedNumber(stripped);
    }
  }
  return null;
}

function pickString(
  source: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function extractText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractText(item);
      if (found) return found;
    }
    return null;
  }

  if (isRecord(value)) {
    return (
      extractText(value.text) ||
      extractText(value.caption) ||
      extractText(value.description) ||
      extractText(value.desc) ||
      extractText(value.title) ||
      extractText(value.subtitle) ||
      extractText(value.content) ||
      extractText(value.value) ||
      extractText(value.name) ||
      extractText(value.share_title) ||
      extractText(value.shareTitle)
    );
  }

  return null;
}

function pickText(
  source: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = extractText(source[key]);
    if (value) return value;
  }
  return null;
}

function pickNumber(
  source: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!source) return null;
  for (const key of keys) {
    const parsed = parseNumber(source[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

const MAX_DEEP_SEARCH_DEPTH = 4;

function deepPickNumber(
  value: unknown,
  keys: string[],
  depth = 0,
): number | null {
  if (depth > MAX_DEEP_SEARCH_DEPTH || !value) return null;

  if (isRecord(value)) {
    const direct = pickNumber(value, keys);
    if (direct !== null) return direct;

    for (const entry of Object.values(value)) {
      const found = deepPickNumber(entry, keys, depth + 1);
      if (found !== null) return found;
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const found = deepPickNumber(entry, keys, depth + 1);
      if (found !== null) return found;
    }
  }

  return null;
}

function deepPickText(
  value: unknown,
  keys: string[],
  depth = 0,
): string | null {
  if (depth > MAX_DEEP_SEARCH_DEPTH || !value) return null;

  if (isRecord(value)) {
    const direct = pickText(value, keys);
    if (direct) return direct;

    for (const entry of Object.values(value)) {
      const found = deepPickText(entry, keys, depth + 1);
      if (found) return found;
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const found = deepPickText(entry, keys, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function extractImageUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractImageUrl(item);
      if (found) return found;
    }
  }
  if (isRecord(value)) {
    return (
      extractImageUrl(value.url) ||
      extractImageUrl(value.src) ||
      extractImageUrl(value.image_url) ||
      extractImageUrl(value.imageUrl) ||
      extractImageUrl(value.cover) ||
      extractImageUrl(value.cover_url) ||
      extractImageUrl(value.thumbnail) ||
      extractImageUrl(value.thumbnail_url)
    );
  }
  return null;
}

function pickImageUrl(
  source: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const candidate = extractImageUrl(source[key]);
    if (candidate) return candidate;
  }
  return null;
}

function pickArray(
  source: Record<string, unknown> | null,
  keys: string[],
): unknown[] | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value as unknown[];
    if (isRecord(value)) {
      const nested = pickArray(value, [
        'items',
        'item_list',
        'itemList',
        'list',
        'data',
        'videos',
        'posts',
        'aweme_list',
        'awemeList',
      ]);
      if (nested) return nested;
    }
  }
  return null;
}

function pickRecord(
  source: Record<string, unknown> | null,
  keys: string[],
): Record<string, unknown> | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) return value;
  }
  return null;
}

function pickTimestamp(source: Record<string, unknown> | null): number | null {
  const raw = pickNumber(source, [
    'create_time',
    'createTime',
    'create_date',
    'createDate',
    'created_at',
    'createdAt',
    'posted_at',
    'postedAt',
    'publish_time',
    'publishTime',
    'timestamp',
    'taken_at',
  ]);
  if (raw !== null) {
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }

  const dateString = pickString(source, [
    'datetime',
    'date',
    'create_date',
    'createDate',
    'created_at',
    'createdAt',
    'create_time',
    'createTime',
    'posted_at',
    'postedAt',
    'publish_time',
    'publishTime',
    'timestamp',
    'taken_at',
  ]);
  if (!dateString) return null;
  const parsed = Date.parse(dateString);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function deepPickTimestamp(value: unknown): number | null {
  const raw = deepPickNumber(value, [
    'create_time',
    'createTime',
    'create_date',
    'createDate',
    'created_at',
    'createdAt',
    'posted_at',
    'postedAt',
    'publish_time',
    'publishTime',
    'timestamp',
    'taken_at',
  ]);
  if (raw !== null) {
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }

  const dateString = deepPickText(value, [
    'datetime',
    'date',
    'create_date',
    'createDate',
    'created_at',
    'createdAt',
    'create_time',
    'createTime',
    'posted_at',
    'postedAt',
    'publish_time',
    'publishTime',
    'timestamp',
    'taken_at',
  ]);
  if (!dateString) return null;
  const parsed = Date.parse(dateString);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function buildTikTokPostUrl(
  handle: string | null,
  postId: string | null,
): string | null {
  if (!handle || !postId) return null;
  const cleanHandle = normalizeTikTokHandle(handle);
  const cleanPostId = postId.trim();
  if (!cleanHandle || !cleanPostId) return null;
  return `https://www.tiktok.com/@${cleanHandle}/video/${cleanPostId}`;
}

function normalizeTikTokHandle(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutAt = trimmed.replace(/^@/, '');
  const urlMatch = withoutAt.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) return urlMatch[1];
  return withoutAt;
}

function buildProxyImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const baseUrl = getApiBaseUrl();
    const encodedUrl = encodeURIComponent(url);
    return `${baseUrl}/api/v1/proxy-image?url=${encodedUrl}`;
  } catch {
    return url;
  }
}

function formatCount(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value.toLocaleString();
}

function formatPostDate(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  };
  if (date.getFullYear() !== now.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString(undefined, options);
}

function formatEngagementRate(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${value.toFixed(2).replace(/\.00$/, '')}%`;
}

function normalizeHashtags(value: unknown): string[] {
  const collected: string[] = [];

  const addTag = (tag: string | null) => {
    if (!tag) return;
    const trimmed = tag.trim();
    if (trimmed) collected.push(trimmed);
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') {
        addTag(entry);
      } else if (isRecord(entry)) {
        addTag(
          pickString(entry, [
            'hashtag_name',
            'hashtagName',
            'tag_name',
            'tagName',
            'name',
            'text',
            'title',
          ]) || extractText(entry),
        );
      }
    }
  } else if (typeof value === 'string') {
    value
      .split(/[\s,]+/g)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach(addTag);
  } else if (isRecord(value)) {
    addTag(
      pickString(value, [
        'hashtag_name',
        'hashtagName',
        'tag_name',
        'tagName',
        'name',
        'text',
        'title',
      ]) || extractText(value),
    );
  }

  if (collected.length === 0) return [];
  return Array.from(new Set(collected));
}

function extractHashtagsFromText(value: string | null): string[] {
  if (!value) return [];
  const matches = value.match(/#[^\s#]+/g);
  if (!matches) return [];
  return matches.map((tag) => tag.replace(/^#+/, ''));
}

function deepPickHashtags(value: unknown, depth = 0): string[] {
  if (depth > MAX_DEEP_SEARCH_DEPTH || !value) return [];

  if (isRecord(value)) {
    const directSources = [
      value.hashtags,
      value.hashtag_list,
      value.hashtagList,
      value.tag_list,
      value.tagList,
      value.tags,
      value.text_extra,
      value.textExtra,
    ];
    const direct = directSources.flatMap((source) => normalizeHashtags(source));
    if (direct.length > 0) {
      return Array.from(new Set(direct));
    }

    for (const entry of Object.values(value)) {
      const found = deepPickHashtags(entry, depth + 1);
      if (found.length > 0) return found;
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const found = deepPickHashtags(entry, depth + 1);
      if (found.length > 0) return found;
    }
  }

  return [];
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) {
    return !value.some((entry) => !isEmptyValue(entry));
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

function mergePostRecords(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(next)) {
    const existing = merged[key];

    if (isRecord(existing) && isRecord(value)) {
      merged[key] = mergePostRecords(existing, value);
      continue;
    }

    if (isEmptyValue(existing) && !isEmptyValue(value)) {
      merged[key] = value;
      continue;
    }

    if (!(key in merged)) {
      merged[key] = value;
    }
  }

  return merged;
}

function getPostKey(
  entry: Record<string, unknown>,
  urlKeys: string[],
  idKeys: string[],
): string | null {
  const direct = pickString(entry, idKeys) || pickString(entry, urlKeys);
  if (direct) return direct;

  const deepText = deepPickText(entry, [...idKeys, ...urlKeys]);
  if (deepText) return deepText;

  const deepNumber = deepPickNumber(entry, idKeys);
  if (deepNumber !== null) return String(deepNumber);

  return null;
}

function mergePostSources(
  sources: unknown[],
  urlKeys: string[],
  idKeys: string[],
): Record<string, unknown>[] {
  const buckets = new Map<string, Record<string, unknown>>();
  const unkeyed: Record<string, unknown>[] = [];

  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!isRecord(entry)) continue;
      const key = getPostKey(entry, urlKeys, idKeys);
      if (key) {
        const existing = buckets.get(key);
        buckets.set(key, existing ? mergePostRecords(existing, entry) : entry);
      } else {
        unkeyed.push(entry);
      }
    }
  }

  return [...buckets.values(), ...unkeyed];
}

function extractTikTokPosts(profile: ProfileCardData): TikTokPostPreview[] {
  if (profile.platform !== 'tiktok') return [];

  const rawProfile = profile.data as Record<string, unknown>;
  const urlKeys = [
    'video_url',
    'videoUrl',
    'post_url',
    'postUrl',
    'url',
    'share_url',
    'shareUrl',
    'share_link',
    'shareLink',
    'link',
    'web_url',
    'webUrl',
    'permalink',
    'permalink_url',
    'permalinkUrl',
  ];
  const captionKeys = [
    'caption',
    'caption_text',
    'captionText',
    'post_caption',
    'postCaption',
    'description',
    'desc',
    'text',
    'message',
    'body',
    'title',
    'subtitle',
    'full_text',
    'fullText',
    'video_description',
    'videoDescription',
    'video_desc',
    'videoDesc',
    'share_info',
    'shareInfo',
  ];
  const imageKeys = [
    'cover',
    'cover_url',
    'coverUrl',
    'cover_image',
    'coverImage',
    'cover_image_url',
    'coverImageUrl',
    'thumbnail',
    'thumbnail_url',
    'thumbnailUrl',
    'image_url',
    'imageUrl',
    'video_thumbnail',
    'videoThumbnail',
    'video_thumbnail_url',
    'videoThumbnailUrl',
    'dynamic_cover',
    'dynamicCover',
    'dynamic_cover_url',
    'dynamicCoverUrl',
    'origin_cover',
    'originCover',
    'origin_cover_url',
    'originCoverUrl',
    'poster',
    'poster_url',
    'posterUrl',
    'preview_image',
    'previewImage',
    'preview_image_url',
    'previewImageUrl',
    'first_frame',
    'firstFrame',
    'first_frame_url',
    'firstFrameUrl',
    'photo_url',
    'photoUrl',
    'static_cover',
    'staticCover',
    'static_cover_url',
    'staticCoverUrl',
  ];
  const idKeys = [
    'video_id',
    'videoId',
    'id',
    'aweme_id',
    'awemeId',
    'item_id',
    'itemId',
    'post_id',
    'postId',
    'share_id',
    'shareId',
  ];
  const viewKeys = [
    'views',
    'view_count',
    'viewCount',
    'viewcount',
    'play_count',
    'playCount',
    'playcount',
    'plays',
  ];
  const likeKeys = [
    'likes',
    'likes_count',
    'likesCount',
    'like_count',
    'likeCount',
    'digg_count',
    'diggCount',
    'diggcount',
  ];
  const commentKeys = [
    'comments',
    'comments_count',
    'commentsCount',
    'comment_count',
    'commentCount',
    'commentcount',
    'replies',
    'reply_count',
    'replyCount',
  ];
  const shareKeys = [
    'shares',
    'shares_count',
    'sharesCount',
    'share_count',
    'shareCount',
    'sharecount',
    'repost_count',
    'repostCount',
  ];
  const engagementKeys = [
    'engagement_rate_estimated',
    'engagementRateEstimated',
    'engagement_rate',
    'engagementRate',
  ];
  const followerKeys = [
    'follower_count_at_post_time',
    'followerCountAtPostTime',
    'followers_count',
    'followersCount',
    'follower_count',
    'followerCount',
    'followers',
    'account_followers',
    'accountFollowers',
  ];

  const rawPostSources: Array<unknown[] | null> = [
    Array.isArray(rawProfile.top_videos) ? rawProfile.top_videos : null,
    Array.isArray(rawProfile.top_posts_data) ? rawProfile.top_posts_data : null,
    Array.isArray(rawProfile.pinned_posts) ? rawProfile.pinned_posts : null,
    Array.isArray(rawProfile.posts) ? rawProfile.posts : null,
    Array.isArray(rawProfile.videos) ? rawProfile.videos : null,
    Array.isArray(rawProfile.recent_videos) ? rawProfile.recent_videos : null,
    Array.isArray(rawProfile.recent_posts) ? rawProfile.recent_posts : null,
    Array.isArray(rawProfile.latest_videos) ? rawProfile.latest_videos : null,
    Array.isArray(rawProfile.latest_posts) ? rawProfile.latest_posts : null,
    Array.isArray(rawProfile.items) ? rawProfile.items : null,
    Array.isArray(rawProfile.item_list) ? rawProfile.item_list : null,
    Array.isArray(rawProfile.itemList) ? rawProfile.itemList : null,
    Array.isArray(rawProfile.aweme_list) ? rawProfile.aweme_list : null,
    Array.isArray(rawProfile.awemeList) ? rawProfile.awemeList : null,
    pickArray(rawProfile, [
      'posts',
      'videos',
      'recent_videos',
      'recent_posts',
      'latest_videos',
      'latest_posts',
      'top_videos',
      'top_posts_data',
      'pinned_posts',
      'items',
      'item_list',
      'itemList',
      'aweme_list',
      'awemeList',
    ]),
  ];

  const rawPosts = mergePostSources(rawPostSources, urlKeys, idKeys);

  if (rawPosts.length === 0) return [];

  const profileHandle =
    pickString(rawProfile, [
      'unique_id',
      'uniqueId',
      'username',
      'handle',
      'user_name',
      'userName',
      'account',
      'account_id',
      'accountId',
    ]) ||
    normalizeTikTokHandle(
      pickString(rawProfile, ['profile_url', 'profileUrl', 'url']) || '',
    ) ||
    normalizeTikTokHandle(profile.profile) ||
    profile.profile;

  const postsWithTimestamps = rawPosts
    .map((item) => {
      if (!isRecord(item)) {
        return { item, timestamp: null };
      }
      const postRecord =
        pickRecord(item, [
          'post',
          'item',
          'aweme',
          'data',
          'post_data',
          'postData',
        ]) || item;
      return {
        item,
        timestamp:
          pickTimestamp(postRecord) ??
          pickTimestamp(item) ??
          deepPickTimestamp(item),
      };
    })
    .filter((entry) => entry.item);

  const hasTimestamp = postsWithTimestamps.some(
    (entry) => typeof entry.timestamp === 'number',
  );

  const sortedPosts = hasTimestamp
    ? [...postsWithTimestamps].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
      )
    : postsWithTimestamps;

  const posts: TikTokPostPreview[] = [];
  const seen = new Set<string>();

  for (const { item, timestamp } of sortedPosts) {
    if (!isRecord(item)) continue;

    const postRecord =
      pickRecord(item, [
        'post',
        'item',
        'aweme',
        'data',
        'post_data',
        'postData',
      ]) || item;
    const mediaRecord =
      pickRecord(item, ['media', 'media_info', 'mediaInfo']) ||
      pickRecord(postRecord, ['media', 'media_info', 'mediaInfo']);
    const videoRecord =
      pickRecord(item, ['video', 'video_info', 'videoInfo']) ||
      pickRecord(postRecord, ['video', 'video_info', 'videoInfo']);
    const engagementRecord =
      pickRecord(item, ['engagement', 'engagement_info', 'engagementInfo']) ||
      pickRecord(postRecord, [
        'engagement',
        'engagement_info',
        'engagementInfo',
      ]);
    const accountRecord =
      pickRecord(item, [
        'account',
        'author',
        'user',
        'owner',
        'profile',
        'creator',
      ]) ||
      pickRecord(postRecord, [
        'account',
        'author',
        'user',
        'owner',
        'profile',
        'creator',
      ]);
    const metricsRecord =
      pickRecord(item, [
        'metrics_context',
        'metricsContext',
        'metrics',
        'metrics_info',
        'metricsInfo',
      ]) ||
      pickRecord(postRecord, [
        'metrics_context',
        'metricsContext',
        'metrics',
        'metrics_info',
        'metricsInfo',
      ]);
    const statsRecord =
      pickRecord(item, [
        'stats',
        'statistics',
        'stats_v2',
        'statsV2',
        'stats_info',
        'statsInfo',
      ]) ||
      pickRecord(postRecord, [
        'stats',
        'statistics',
        'stats_v2',
        'statsV2',
        'stats_info',
        'statsInfo',
      ]);
    const shareRecord =
      pickRecord(item, ['share_info', 'shareInfo']) ||
      pickRecord(postRecord, ['share_info', 'shareInfo']);

    const postUrl =
      pickString(item, urlKeys) ||
      pickString(postRecord, urlKeys) ||
      pickString(mediaRecord, urlKeys) ||
      pickString(videoRecord, urlKeys) ||
      pickString(shareRecord, urlKeys) ||
      null;

    const postId = pickString(item, idKeys) || pickString(postRecord, idKeys);

    const url = postUrl || buildTikTokPostUrl(profileHandle, postId);
    if (!url) continue;

    const imageUrl =
      pickImageUrl(item, imageKeys) ||
      pickImageUrl(postRecord, imageKeys) ||
      pickImageUrl(mediaRecord, imageKeys) ||
      pickImageUrl(videoRecord, imageKeys);

    const caption =
      pickText(item, captionKeys) ||
      pickText(postRecord, captionKeys) ||
      pickText(mediaRecord, captionKeys) ||
      pickText(videoRecord, captionKeys) ||
      pickText(shareRecord, captionKeys) ||
      deepPickText(item, captionKeys) ||
      null;

    const views =
      pickNumber(item, viewKeys) ||
      pickNumber(postRecord, viewKeys) ||
      pickNumber(statsRecord, viewKeys) ||
      pickNumber(videoRecord, viewKeys) ||
      deepPickNumber(item, viewKeys);

    const likes =
      pickNumber(engagementRecord, likeKeys) ||
      pickNumber(item, likeKeys) ||
      pickNumber(postRecord, likeKeys) ||
      pickNumber(statsRecord, likeKeys) ||
      pickNumber(videoRecord, likeKeys) ||
      deepPickNumber(item, likeKeys);

    const comments =
      pickNumber(engagementRecord, commentKeys) ||
      pickNumber(item, commentKeys) ||
      pickNumber(postRecord, commentKeys) ||
      pickNumber(statsRecord, commentKeys) ||
      pickNumber(videoRecord, commentKeys) ||
      deepPickNumber(item, commentKeys);

    const engagementRate =
      pickNumber(engagementRecord, engagementKeys) ||
      pickNumber(item, engagementKeys) ||
      pickNumber(postRecord, engagementKeys) ||
      deepPickNumber(item, engagementKeys);

    const followerCountAtPostTime =
      pickNumber(metricsRecord, followerKeys) ||
      pickNumber(item, followerKeys) ||
      pickNumber(postRecord, followerKeys) ||
      pickNumber(accountRecord, followerKeys) ||
      deepPickNumber(item, followerKeys);

    const shares =
      pickNumber(item, shareKeys) ||
      pickNumber(postRecord, shareKeys) ||
      pickNumber(statsRecord, shareKeys) ||
      pickNumber(videoRecord, shareKeys) ||
      deepPickNumber(item, shareKeys);

    const hashtagSources = [
      item.hashtags,
      postRecord.hashtags,
      item.hashtag_list,
      item.hashtagList,
      item.text_extra,
      item.textExtra,
      postRecord.text_extra,
      postRecord.textExtra,
      item.tags,
      postRecord.tags,
      item.tag_list,
      postRecord.tag_list,
    ];
    let hashtags = hashtagSources.flatMap((source) =>
      normalizeHashtags(source),
    );
    if (hashtags.length === 0) {
      hashtags = deepPickHashtags(item);
    }
    if (hashtags.length === 0 && caption) {
      hashtags = extractHashtagsFromText(caption);
    }
    hashtags = Array.from(new Set(hashtags));

    const dedupeKey =
      url ||
      postId ||
      pickString(item, ['post_id', 'postId']) ||
      pickString(postRecord, ['post_id', 'postId']) ||
      `${caption || ''}-${imageUrl || ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    posts.push({
      url,
      caption,
      imageUrl,
      timestamp: typeof timestamp === 'number' ? timestamp : null,
      engagementRate,
      followerCountAtPostTime,
      hashtags,
      views,
      likes,
      comments,
      shares,
    });

    if (posts.length >= 5) break;
  }

  return posts;
}

function TikTokPostThumbnail({
  imageUrl,
  caption,
}: {
  imageUrl: string | null;
  caption: string;
}) {
  const [error, setError] = useState(false);
  const proxiedImageUrl = useMemo(
    () => buildProxyImageUrl(imageUrl),
    [imageUrl],
  );

  if (!proxiedImageUrl || error) {
    return (
      <div className="profileCardPostPlaceholder" aria-label={caption}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M21 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9l7 7v9Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M8 13l2.5 2.5L15 11l3 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={proxiedImageUrl}
      alt={caption}
      className="profileCardPostImage"
      onError={() => setError(true)}
    />
  );
}

function getPlatformUrl(
  platform: Platform,
  profile: string,
  profileUrl?: string,
): string | null {
  if (profileUrl) {
    return profileUrl;
  }

  const username = profile.replace(/^@/, '');

  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${username}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${username}`;
    default:
      return null;
  }
}

function formatStat(value: number | undefined): string | null {
  return value ? value.toLocaleString() : null;
}

function formatEngagement(value: number | undefined): string | null {
  return value ? `${(value * 100).toFixed(2)}%` : null;
}

export function ProfileCard({ data }: ProfileCardProps) {
  const profileName =
    data.data.full_name || data.data.profile_name || data.profile;
  // TikTok uses profile_pic_url, Instagram uses profile_image_link
  const profileImage =
    data.data.profile_pic_url || data.data.profile_image_link;
  const followers = formatStat(data.data.followers);
  const posts = formatStat(data.data.posts_count || data.data.videos_count);
  const engagement = formatEngagement(data.data.avg_engagement);

  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset states when image URL changes
  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
  }, [profileImage]);

  // Create proxied image URL to bypass CORS
  const proxiedImageUrl = useMemo(
    () => buildProxyImageUrl(profileImage),
    [profileImage],
  );

  // Construct profile URL based on platform
  const profileUrl = useMemo(() => {
    // TikTok uses 'url' field, Instagram uses 'profile_url'
    const url = data.data.url || data.data.profile_url;
    return getPlatformUrl(data.platform, data.profile, url);
  }, [data.platform, data.profile, data.data.url, data.data.profile_url]);

  const platformClass = `profileCard-${data.platform}`;
  const latestTikTokPosts = useMemo(() => extractTikTokPosts(data), [data]);

  return (
    <div className={`profileCard ${platformClass}`}>
      <div className="profileCardHeader">
        {profileImage ? (
          <>
            {!imageLoaded && !imageError && (
              <div className="profileCardImagePlaceholder">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M20 21a8 8 0 0 0-16 0"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            )}
            {proxiedImageUrl && (
              <img
                src={proxiedImageUrl}
                alt={profileName}
                className="profileCardImage"
                onLoad={() => {
                  setImageLoaded(true);
                  setImageError(false);
                }}
                onError={() => {
                  // Only set error after onLoad hasn't fired
                  if (!imageLoaded) {
                    setImageError(true);
                  }
                }}
                style={{
                  display: imageLoaded && !imageError ? 'block' : 'none',
                }}
              />
            )}
            {imageError && (
              <div className="profileCardImagePlaceholder">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M20 21a8 8 0 0 0-16 0"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            )}
          </>
        ) : (
          <div className="profileCardImagePlaceholder">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M20 21a8 8 0 0 0-16 0"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </div>
        )}
        <div className="profileCardInfo">
          <div className="profileCardName">
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="profileCardLink"
              >
                {profileName}
              </a>
            ) : (
              profileName
            )}
            {data.data.is_verified && (
              <span className="profileCardVerified" title="Verified">
                ✓
              </span>
            )}
          </div>
          <div className="profileCardStats">
            {followers && <span>{followers} followers</span>}
            {posts && (
              <span>
                {posts} {data.data.videos_count ? 'videos' : 'posts'}
              </span>
            )}
            {engagement && <span>{engagement} engagement</span>}
          </div>
        </div>
      </div>
      {data.analysis?.summary && (
        <div className="profileCardAnalysis">
          <div className="profileAnalysisSection">
            <h4>Summary</h4>
            <p>{data.analysis.summary}</p>
          </div>
          {data.analysis.topic && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Topic:</span>
              <span>{data.analysis.topic}</span>
            </div>
          )}
          {data.analysis.niche && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Niche:</span>
              <span>{data.analysis.niche}</span>
            </div>
          )}
          {data.analysis.qualityScore !== undefined && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Quality Score:</span>
              <span>{data.analysis.qualityScore}/5</span>
            </div>
          )}
          {data.analysis.engagementStrength && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Engagement:</span>
              <span>{data.analysis.engagementStrength}</span>
            </div>
          )}
          {data.analysis.contentAuthenticity && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Content:</span>
              <span>{data.analysis.contentAuthenticity}</span>
            </div>
          )}
          {data.analysis.followerAuthenticity && (
            <div className="profileAnalysisRow">
              <span className="profileAnalysisLabel">Followers:</span>
              <span>{data.analysis.followerAuthenticity}</span>
            </div>
          )}
        </div>
      )}
      {data.platform === 'tiktok' && latestTikTokPosts.length > 0 && (
        <div className="profileCardPosts">
          <h4>Latest posts</h4>
          <div className="profileCardPostsGrid">
            {latestTikTokPosts.map((post) => {
              const caption = post.caption?.trim() || 'View on TikTok';
              const dateLabel = formatPostDate(post.timestamp);
              const views = formatCount(post.views);
              const likes = formatCount(post.likes);
              const comments = formatCount(post.comments);
              const shares = formatCount(post.shares);
              const engagementRate = formatEngagementRate(post.engagementRate);
              const followersAtPost = formatCount(post.followerCountAtPostTime);
              const hashtagLabel =
                post.hashtags.length > 0
                  ? post.hashtags
                      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
                      .join(' ')
                  : null;
              const hasStats =
                dateLabel ||
                views ||
                likes ||
                comments ||
                shares ||
                engagementRate ||
                followersAtPost;

              return (
                <a
                  key={post.url}
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="profileCardPost"
                >
                  <TikTokPostThumbnail
                    imageUrl={post.imageUrl}
                    caption={caption}
                  />
                  {hasStats && (
                    <div className="profileCardPostStatsRow">
                      {dateLabel && <span>{dateLabel}</span>}
                      {views && <span>{views} views</span>}
                      {likes && <span>{likes} likes</span>}
                      {comments && <span>{comments} comments</span>}
                      {shares && <span>{shares} shares</span>}
                      {engagementRate && (
                        <span>{engagementRate} engagement</span>
                      )}
                      {followersAtPost && (
                        <span>{followersAtPost} followers at post</span>
                      )}
                    </div>
                  )}
                  <div className="profileCardPostMeta">
                    <div className="profileCardPostCaption">{caption}</div>
                    {hashtagLabel && (
                      <div className="profileCardPostTags">{hashtagLabel}</div>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
