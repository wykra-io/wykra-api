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
    const sendImageResponse = (
      buffer: Buffer,
      contentType: string,
      {
        status = HttpStatus.OK,
        cacheSeconds = DEFAULT_IMAGE_CACHE_SECONDS,
      }: { status?: number; cacheSeconds?: number } = {},
    ) => {
      res.status(status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Length', buffer.length.toString());
      res.send(buffer);
    };

    const sendFallbackImage = (status = HttpStatus.BAD_GATEWAY) => {
      sendImageResponse(FALLBACK_IMAGE_BUFFER, FALLBACK_IMAGE_TYPE, {
        status,
        cacheSeconds: ERROR_IMAGE_CACHE_SECONDS,
      });
    };

    if (!url) {
      sendFallbackImage(HttpStatus.BAD_REQUEST);
      return;
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
        sendFallbackImage(HttpStatus.BAD_REQUEST);
        return;
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
          validateStatus: () => true,
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
        const bufferType = detectImageTypeFromBuffer(buffer);
        if (bufferType) return bufferType;

        const isTextLike = looksLikeText(buffer);
        const contentTypeHeader =
          (headers['content-type'] as string | undefined) || '';
        const contentType = contentTypeHeader
          .split(';')[0]
          ?.trim()
          .toLowerCase();
        if (contentType && contentType.startsWith('image/') && !isTextLike) {
          return contentType;
        }

        if (!isTextLike) {
          return detectImageTypeFromUrl(imageUrl);
        }

        return null;
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
        // CDN may return HTML/JSON errors; respond with an image to avoid ORB.
        sendFallbackImage();
        return;
      }

      sendImageResponse(buffer, detectedType);
      return;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (!res.headersSent) {
        sendFallbackImage();
        return;
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

const DEFAULT_IMAGE_CACHE_SECONDS = 60 * 60 * 24;
const ERROR_IMAGE_CACHE_SECONDS = 60;
// 1x1 transparent GIF for error responses (prevents ORB on <img> loads)
const FALLBACK_IMAGE_BASE64 = 'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const FALLBACK_IMAGE_BUFFER = Buffer.from(FALLBACK_IMAGE_BASE64, 'base64');
const FALLBACK_IMAGE_TYPE = 'image/gif';

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
  const head = buffer.slice(0, 512).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<svg') || head.includes('<svg')) {
    return 'image/svg+xml';
  }

  return null;
}

function looksLikeText(buffer: Buffer): boolean {
  if (!buffer.length) return false;
  const sample = buffer.slice(0, 512);
  let printable = 0;
  for (const byte of sample) {
    if (
      byte === 9 || // \t
      byte === 10 || // \n
      byte === 13 || // \r
      (byte >= 32 && byte <= 126)
    ) {
      printable += 1;
    }
  }

  const printableRatio = printable / sample.length;
  const text = sample.toString('utf8').trim().toLowerCase();
  if (!text) return false;
  if (
    text.startsWith('<!doctype') ||
    text.startsWith('<html') ||
    text.startsWith('<head') ||
    text.startsWith('<body') ||
    text.startsWith('<script') ||
    text.startsWith('{') ||
    text.startsWith('[')
  ) {
    return true;
  }

  return printableRatio > 0.9;
}
