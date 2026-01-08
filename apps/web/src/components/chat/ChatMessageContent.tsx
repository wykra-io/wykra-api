import { ProfileCard } from '../ProfileCard';
import type { ChatMessage } from '../../types';
import {
  detectPlatformFromMessage,
  parseProfileCardData,
} from '../../chat/profileCardMessage';

type Props = {
  message: ChatMessage;
};

export function ChatMessageContent({ message }: Props) {
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
