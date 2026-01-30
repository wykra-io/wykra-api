import { ProfileCard } from '../ProfileCard';
import { InstagramSearchResults } from '../InstagramSearchResults';
import { TikTokSearchResults } from '../TikTokSearchResults';
import type { ChatMessage } from '../../types';
import {
  detectPlatformFromMessage,
  parseProfileCardData,
  parseInstagramSearchResults,
  parseTikTokSearchResults,
} from '../../chat/profileCardMessage';

type Props = {
  message: ChatMessage;
};

export function ChatMessageContent({ message }: Props) {
  // Check for Instagram search results first
  const instagramSearchData = parseInstagramSearchResults(message.content);
  if (instagramSearchData) {
    return <InstagramSearchResults data={instagramSearchData} />;
  }

  // Then check for TikTok search results
  const tiktokSearchData = parseTikTokSearchResults(message.content);
  if (tiktokSearchData) {
    return <TikTokSearchResults data={tiktokSearchData} />;
  }

  // Then check for single profile cards
  const platform = detectPlatformFromMessage(
    message.content,
    message.detectedEndpoint,
  );

  if (platform) {
    const profileData = parseProfileCardData(message.content, platform);
    if (profileData) return <ProfileCard data={profileData} />;
  }

  return <>{message.content}</>;
}
