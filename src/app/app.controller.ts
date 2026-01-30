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

      // TikTok/Instagram CDNs often block requests without Referer and a browser User-Agent
      const isTiktokCdn = /tiktokcdn|tiktok\.com\/.*(?:cdn|avt|img)/i.test(
        imageUrl,
      );
      const isInstagramCdn = /cdninstagram\.com|fbcdn\.net/i.test(imageUrl);

      const requestHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      };
      if (isTiktokCdn) {
        requestHeaders['Referer'] = 'https://www.tiktok.com/';
        requestHeaders['Origin'] = 'https://www.tiktok.com';
      }
      if (isInstagramCdn) {
        requestHeaders['Referer'] = 'https://www.instagram.com/';
        requestHeaders['Origin'] = 'https://www.instagram.com';
      }

      const fetchImage = () =>
        axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 5,
          headers: requestHeaders,
          validateStatus: (status) => status >= 200 && status < 300,
        });

      // Fetch with one retry (CDN can be flaky)
      let response: Awaited<ReturnType<typeof fetchImage>>;
      try {
        response = await fetchImage();
      } catch {
        response = await fetchImage();
      }

      const contentType =
        (response.headers['content-type'] as string | undefined) || '';
      const isImage =
        /^image\//i.test(contentType) ||
        /\.(jpe?g|png|gif|webp|avif|svg)/i.test(imageUrl);
      if (!isImage && response.data?.byteLength > 0) {
        // CDN may return 200 with HTML error page; don't cache or serve as image
        throw new HttpException(
          'Response is not an image',
          HttpStatus.BAD_GATEWAY,
        );
      }

      res.setHeader('Content-Type', isImage ? contentType : 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');

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
