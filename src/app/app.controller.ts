import {
  Controller,
  Get,
  Query,
  Res,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Response } from 'express';
import axios from 'axios';

import { IS_PUBLIC_KEY } from '../auth/constants';
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

  /**
   * Proxies external images to bypass CORS restrictions.
   *
   * @param {string} url - The URL of the image to proxy (must be URL encoded).
   * @param {Response} res - Express response object.
   */
  @SetMetadata(IS_PUBLIC_KEY, true)
  @Get('proxy-image')
  public async proxyImage(
    @Query('url') url: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!url) {
      throw new HttpException(
        'URL parameter is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Decode the URL if it's encoded
      let imageUrl: string;
      try {
        imageUrl = decodeURIComponent(url);
      } catch {
        // If decoding fails, use the original URL
        imageUrl = url;
      }

      // Validate that it's an image URL (basic check)
      if (!imageUrl.match(/^https?:\/\//i)) {
        throw new HttpException('Invalid URL format', HttpStatus.BAD_REQUEST);
      }

      // Fetch the image
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'image/*',
        },
        validateStatus: (status) => status === 200,
      });

      // Set appropriate headers
      const contentType =
        (response.headers['content-type'] as string | undefined) ||
        'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');

      // Send the image data
      res.send(Buffer.from(response.data));
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Log the actual error for debugging
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new HttpException(
        `Failed to fetch image: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
