import { Controller, Get } from '@nestjs/common';

import { StatusResponse } from '@libs/interfaces';

@Controller()
export class AppController {
  /**
   * Handles the HTTP GET request to check the status of the application.
   *
   * @returns {StatusResponse} An object containing a `status` property with the value 'OK' to indicate that the application is healthy.
   */
  @Get()
  public getStatus(): StatusResponse {
    return { status: 'OK' };
  }
}

