import { Injectable, Logger } from '@nestjs/common';
const fetch = require('isomorphic-unfetch');
const { getDetails } = require('spotify-url-info')(fetch);

@Injectable()
export class SpotifyService {
  private readonly logger = new Logger(SpotifyService.name);

  async getPlaylistDetail(
    spotifyUrl: string,
  ): Promise<{ name: string; tracks: any[] }> {
    this.logger.debug(`Get playlist ${spotifyUrl} on Spotify`);
    const detail = await getDetails(spotifyUrl);
    return { name: detail.preview.title, tracks: detail?.tracks ?? [] };
  }

  async getPlaylistTracks(spotifyUrl: string): Promise<any[]> {
    this.logger.debug(`Get playlist ${spotifyUrl} on Spotify`);
    const detail = await getDetails(spotifyUrl);
    return detail?.tracks ?? [];
  }
}
