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
      let imageUrl = url;
      if (/^https?%3A%2F%2F/i.test(imageUrl)) {
        try {
          imageUrl = decodeURIComponent(imageUrl);
        } catch {
          imageUrl = url;
        }
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

      const baseHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      };
      const requestHeaders: Record<string, string> = {
        ...baseHeaders,
        // Avoid compressed responses to reduce CDN quirks.
        'Accept-Encoding': 'identity',
      };
      if (isTiktokCdn) {
        requestHeaders['Referer'] = 'https://www.tiktok.com/';
        requestHeaders['Origin'] = 'https://www.tiktok.com';
      }
      if (isInstagramCdn) {
        requestHeaders['Referer'] = 'https://www.instagram.com/';
        requestHeaders['Origin'] = 'https://www.instagram.com';
      }

      const fetchImage = (headers: Record<string, string>) =>
        axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 5,
          decompress: true,
          headers,
          validateStatus: (status) => status >= 200 && status < 300,
        });

      const fetchWithRetry = async (headers: Record<string, string>) => {
        try {
          return await fetchImage(headers);
        } catch {
          return await fetchImage(headers);
        }
      };

      const toBuffer = (data: unknown) =>
        Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const detectType = (headers: Record<string, unknown>, buffer: Buffer) => {
        const contentTypeHeader =
          (headers['content-type'] as string | undefined) || '';
        const contentType = contentTypeHeader
          .split(';')[0]
          ?.trim()
          .toLowerCase();
        return (
          (contentType && contentType.startsWith('image/')
            ? contentType
            : null) ||
          detectImageTypeFromBuffer(buffer) ||
          detectImageTypeFromUrl(imageUrl)
        );
      };

      // Fetch with one retry (CDN can be flaky)
      let response = await fetchWithRetry(requestHeaders);
      let buffer = toBuffer(response.data);
      let detectedType = detectType(response.headers, buffer);

      if (!detectedType || buffer.length === 0) {
        const fallbackHeaders = {
          ...baseHeaders,
          'Accept-Encoding': 'gzip, deflate, br',
          ...(isTiktokCdn
            ? {
                Referer: 'https://www.tiktok.com/',
                Origin: 'https://www.tiktok.com',
              }
            : {}),
          ...(isInstagramCdn
            ? {
                Referer: 'https://www.instagram.com/',
                Origin: 'https://www.instagram.com',
              }
            : {}),
        };
        response = await fetchWithRetry(fallbackHeaders);
        buffer = toBuffer(response.data);
        detectedType = detectType(response.headers, buffer);
      }

      if (!detectedType || buffer.length === 0) {
        // CDN may return 200 with HTML/JSON error; don't cache or serve as image
        throw new HttpException(
          'Response is not an image',
          HttpStatus.BAD_GATEWAY,
        );
      }

      res.setHeader('Content-Type', detectedType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      res.send(buffer);
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

function detectImageTypeFromUrl(imageUrl: string): string | null {
  const match = imageUrl.match(
    /\.(avif|webp|png|jpe?g|gif|svg|image)(?:$|[?#])/i,
  );
  if (!match) return null;

  const ext = match[1].toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
    case 'image':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return null;
  }
}

function detectImageTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // JPEG magic: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  // GIF magic: GIF8
  if (buffer.slice(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  // WebP magic: RIFF....WEBP
  if (
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.length >= 12 &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // AVIF magic: ftypavif/avis in ISO BMFF
  if (buffer.length >= 12 && buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.slice(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif';
    }
  }
  // SVG: starts with <svg (allow BOM/whitespace)
  const head = buffer.slice(0, 200).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || head.includes('<svg')) {
    return 'image/svg+xml';
  }

  return null;
}
