import WebApp from '@twa-dev/sdk';

export const isTelegramMiniApp = () => {
  return !!WebApp.initData;
};

export const getTelegramAuthData = () => {
  if (!isTelegramMiniApp()) {
    return null;
  }
  return {
    provider: 'telegram' as const,
    code: WebApp.initData,
  };
};

export const prepareTelegramMiniAppUi = () => {
  if (!isTelegramMiniApp()) return;
  WebApp.ready();
  WebApp.expand();
  WebApp.disableVerticalSwipes();
};


