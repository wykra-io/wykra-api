export enum BrightdataDataset {
  INSTAGRAM = 'gd_l1vikfch901nx3by4',
  INSTAGRAM_POST_COMMENTS = 'gd_ltppn085pokosxh13',
  TIKTOK = 'gd_l1villgoiiidt09ci',
  TIKTOK_VIDEO_COMMENTS = 'gd_lkf2st302ap89utw5k',
  GOOGLE_SERP = 'gd_mfz5x93lmsjjjylob',
  GOOGLE_AI_SEARCH = 'gd_mcswdt6z2elth3zqr2',
  PERPLEXITY = 'gd_m7dhdot1vw9a7gc1n',
}

export const BrightdataDatasetInfo = {
  INSTAGRAM: {
    id: 'gd_l1vikfch901nx3by4',
    name: 'Instagram - Profiles',
    size: 620000000,
  },
  TIKTOK: {
    id: 'gd_l1villgoiiidt09ci',
    name: 'TikTok - Profiles',
    size: 152000000,
  },
} as const;
