import { Injectable, Logger } from '@nestjs/common';
import { TrackEntity } from '../track/track.entity';
import { EnvironmentEnum } from '../environmentEnum';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as ffmpeg from 'fluent-ffmpeg';
import * as yts from 'yt-search';
import * as ytdl from '@distube/ytdl-core';
import { Readable } from 'stream';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const META_DATA_TITLE = '-metadata';

enum StreamStates {
  Finish = 'finish',
  Error = 'error',
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private agent: any = undefined;

  constructor(private readonly configService: ConfigService) {
    this.initAgent();
  }

  private initAgent(): void {
    try {
      const cookiesEnv = process.env.YOUTUBE_COOKIES;
      const cookiesPath =
        process.env.COOKIES_PATH ||
        path.resolve(__dirname, '../../cookies.txt');

      if (cookiesEnv) {
        try {
          const parsed = JSON.parse(cookiesEnv);
          this.agent = ytdl.createAgent(parsed);
          this.logger.log('Loaded YouTube cookies from YOUTUBE_COOKIES env');
        } catch {
          this.logger.warn('YOUTUBE_COOKIES is not valid JSON, skipping agent');
        }
      } else if (fs.existsSync(cookiesPath)) {
        const content = fs.readFileSync(cookiesPath, 'utf8');
        try {
          const parsed = JSON.parse(content);
          this.agent = ytdl.createAgent(parsed);
          this.logger.log(`Loaded YouTube cookies from ${cookiesPath}`);
        } catch {
          this.logger.warn(`Cookies file at ${cookiesPath} is not valid JSON`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`Failed to initialize ytdl agent: ${e?.message || e}`);
    }
  }

  async findOnYoutubeOne(artist: string, name: string): Promise<string> {
    const query = `${artist} - ${name}`;
    this.logger.debug(`Searching "${query}" on YT`);
    const searchResult = await yts(query);
    const video = searchResult?.videos?.[0];
    if (!video || !video.url) {
      throw new Error(`No YouTube video found for "${query}"`);
    }
    this.logger.debug(`Found "${query}" -> ${video.url}`);
    return video.url;
  }

  async downloadAndFormat(track: TrackEntity, folderName: string): Promise<void> {
    this.logger.debug(
      `Downloading ${track.artist} - ${track.name} (${track.youtubeUrl})`,
    );

    // Try yt-dlp first (bypasses YouTube bot detection on cloud/datacenter IPs)
    const ytDlpSuccess = await this.tryYtDlpDownload(track, folderName);
    if (ytDlpSuccess) {
      this.logger.debug(`Successfully downloaded ${track.name} via yt-dlp`);
      return;
    }

    // Fallback to ytdl-core + ffmpeg
    this.logger.debug(`Falling back to ytdl-core for ${track.name}`);
    return this.downloadWithYtdlCore(track, folderName);
  }

  private async tryYtDlpDownload(track: TrackEntity, folderName: string): Promise<boolean> {
    try {
      const folderNoExt = folderName.replace(/\.[^/.]+$/, '');
      const format = this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
      const cookiesPath = process.env.COOKIES_PATH || path.resolve(__dirname, '../../cookies.txt');
      const cookiesArg = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';

      const cmd = `yt-dlp -x --audio-format ${format} --audio-quality 0 ` +
        `--extractor-args "youtube:player_client=android,web" ` +
        `--no-playlist --no-warnings ${cookiesArg} ` +
        `-o "${folderNoExt}.%(ext)s" "${track.youtubeUrl}"`;

      await execPromise(cmd, { timeout: 180000 });
      return fs.existsSync(folderName);
    } catch (e: any) {
      this.logger.warn(`yt-dlp attempt failed: ${e?.message || e}`);
      return false;
    }
  }

  private downloadWithYtdlCore(track: TrackEntity, folderName: string): Promise<void> {
    return new Promise((res, reject) => {
      let isSettled = false;
      const cleanupAndReject = (err: any) => {
        if (isSettled) return;
        isSettled = true;
        if (fs.existsSync(folderName)) {
          try {
            fs.unlinkSync(folderName);
          } catch {}
        }
        reject(err);
      };

      const outStream = fs.createWriteStream(folderName);
      outStream.on(StreamStates.Finish, () => {
        if (!isSettled) {
          isSettled = true;
          this.logger.debug(
            `Downloaded ${track.artist} - ${track.name} to ${folderName}`,
          );
          res();
        }
      });
      outStream.on(StreamStates.Error, (err) => cleanupAndReject(err));

      const audioStream = this.getYoutubeAudio(track.youtubeUrl, (err) =>
        cleanupAndReject(err),
      );

      ffmpeg(audioStream)
        .outputOptions(...this.getFfmpegOptions(track.name, track.artist))
        .format(this.configService.get<string>(EnvironmentEnum.FORMAT))
        .on(StreamStates.Error, (err) => cleanupAndReject(err))
        .pipe(outStream);
    });
  }

  private getFfmpegOptions(name: string, artist: string): string[] {
    return [
      META_DATA_TITLE,
      `title=${name}`,
      META_DATA_TITLE,
      `artist=${artist}`,
    ];
  }

  private getYoutubeAudio(
    youtubeUrl: string,
    reject: (reason: any) => void,
  ): Readable {
    const downloadOptions: ytdl.downloadOptions = {
      quality: 'highestaudio',
      filter: 'audioonly',
      highWaterMark: 1 << 25,
      requestOptions: {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      ...(this.agent ? { agent: this.agent } : {}),
    };
    return ytdl(youtubeUrl, downloadOptions).on(StreamStates.Error, (err) =>
      reject(err),
    );
  }
}
