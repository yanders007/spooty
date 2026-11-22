import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackEntity, TrackStatusEnum } from './track.entity';
import { PlaylistEntity } from '../playlist/playlist.entity';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import * as path from 'path';
import * as fs from 'fs';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { EnvironmentEnum } from '../environmentEnum';
import { UtilsService } from '../shared/utils.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { YoutubeService } from '../shared/youtube.service';

enum WsTrackOperation {
  New = 'trackNew',
  Update = 'trackUpdate',
  Delete = 'trackDelete',
}

@WebSocketGateway()
@Injectable()
export class TrackService {
  @WebSocketServer() io: Server;
  private readonly logger = new Logger(TrackService.name);

  constructor(
    @InjectRepository(TrackEntity)
    private repository: Repository<TrackEntity>,
    @InjectQueue('track-download-processor') private trackDownloadQueue: Queue,
    @InjectQueue('track-search-processor') private trackSearchQueue: Queue,
    private readonly configService: ConfigService,
    private readonly utilsService: UtilsService,
    private readonly youtubeService: YoutubeService,
  ) {}

  getAll(
    where?: { [key: string]: any },
    relations: Record<string, boolean> = {},
  ): Promise<TrackEntity[]> {
    return this.repository.find({ where, relations });
  }

  getAllByPlaylist(id: number): Promise<TrackEntity[]> {
    return this.repository.find({ where: { playlist: { id } } });
  }

  get(id: number): Promise<TrackEntity | null> {
    return this.repository.findOne({ where: { id }, relations: ['playlist'] });
  }

  async remove(id: number): Promise<void> {
    await this.repository.delete(id);
    this.io.emit(WsTrackOperation.Delete, { id });
  }

  async create(track: TrackEntity, playlist?: PlaylistEntity): Promise<void> {
    const savedTrack = await this.repository.save({
      ...track,
      createdAt: track.createdAt || Date.now(),
      playlist,
    });
    await this.trackSearchQueue.add('', savedTrack, {
      jobId: `id-${savedTrack.id}`,
    });
    this.io.emit(WsTrackOperation.New, {
      track: savedTrack,
      playlistId: playlist.id,
    });
  }

  async update(id: number, track: Partial<TrackEntity>): Promise<void> {
    await this.repository.update(id, track);
    this.io.emit(WsTrackOperation.Update, track);
  }

  async retry(id: number): Promise<void> {
    const track = await this.get(id);
    await this.trackSearchQueue.add('', track, { jobId: `id-${id}` });
    await this.update(id, { ...track, status: TrackStatusEnum.New });
  }

  async findOnYoutube(track: TrackEntity): Promise<void> {
    const currentTrack = await this.get(track.id);
    if (!currentTrack) {
      return;
    }
    await this.update(currentTrack.id, {
      status: TrackStatusEnum.Searching,
    });
    try {
      const youtubeUrl = await this.youtubeService.findOnYoutubeOne(
        currentTrack.artist,
        currentTrack.name,
      );
      const updatedTrack: Partial<TrackEntity> = {
        youtubeUrl,
        status: TrackStatusEnum.Queued,
        error: undefined,
      };
      await this.update(currentTrack.id, updatedTrack);
      // ONLY add to download queue when search succeeded
      await this.trackDownloadQueue.add('', { ...currentTrack, ...updatedTrack }, {
        jobId: `dl-${currentTrack.id}`,
      });
    } catch (err: any) {
      this.logger.error(
        `Search error for ${currentTrack.artist} - ${currentTrack.name}: ${err?.message || err}`,
      );
      await this.update(currentTrack.id, {
        error: String(err?.message || err),
        status: TrackStatusEnum.Error,
      });
    }
  }

  async downloadFromYoutube(track: TrackEntity): Promise<void> {
    const currentTrack = await this.get(track.id);
    if (!currentTrack) {
      return;
    }
    if (!currentTrack.youtubeUrl) {
      this.logger.warn(
        `Track ${currentTrack.id} missing YouTube URL, skipping download`,
      );
      await this.update(currentTrack.id, {
        status: TrackStatusEnum.Error,
        error: 'Missing YouTube URL',
      });
      return;
    }
    await this.update(currentTrack.id, {
      status: TrackStatusEnum.Downloading,
    });
    let error: string | undefined;
    try {
      const playlist = currentTrack.playlist || track.playlist;
      const folderName = this.getFolderName(currentTrack, playlist);
      const dir = path.dirname(folderName);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await this.youtubeService.downloadAndFormat(currentTrack, folderName);
    } catch (err: any) {
      this.logger.error(
        `Download error for track ${currentTrack.id}: ${err?.message || err}`,
      );
      error = String(err?.message || err);
    }
    const updatedTrack: Partial<TrackEntity> = {
      status: error ? TrackStatusEnum.Error : TrackStatusEnum.Completed,
      ...(error ? { error } : { error: undefined }),
    };
    await this.update(currentTrack.id, updatedTrack);
  }

  getTrackFileName(track: TrackEntity): string {
    const fileName = `${track.artist} - ${track.name.replace('/', '')}`;
    return `${this.utilsService.stripFileIllegalChars(fileName)}.${this.configService.get<string>(EnvironmentEnum.FORMAT)}`;
  }

  getFolderName(track: TrackEntity, playlist?: PlaylistEntity): string {
    const playlistName = playlist?.name || 'default';
    return resolve(
      this.utilsService.getPlaylistFolderPath(playlistName),
      this.getTrackFileName(track),
    );
  }
}
