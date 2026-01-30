import { SetMetadata } from '@nestjs/common';

import { SKIP_THROTTLE_KEY } from '../constants';

export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);
