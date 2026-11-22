import { Injectable, Logger } from '@nestjs/common';
import { TrackEntity } from '../track/track.entity';
import { EnvironmentEnum } from '../environmentEnum';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as ffmpeg from 'fluent-ffmpeg';
import * as yts from 'yt-search';
import * as ytdl from '@distube/ytdl-core';
import { Readable } from 'stream';

const META_DATA_TITLE = '-metadata';
const YT_SETTINGS: ytdl.downloadOptions = {
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
};

enum StreamStates {
  Finish = 'finish',
  Error = 'error',
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  constructor(private readonly configService: ConfigService) {}

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

  downloadAndFormat(track: TrackEntity, folderName: string): Promise<void> {
    this.logger.debug(
      `Downloading ${track.artist} - ${track.name} (${track.youtubeUrl}) from YT`,
    );
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
    return ytdl(youtubeUrl, YT_SETTINGS).on(StreamStates.Error, (err) =>
      reject(err),
    );
  }
}
