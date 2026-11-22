import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TrackService } from './track.service';
import { TrackEntity } from './track.entity';

@Processor('track-download-processor', { concurrency: 1 })
export class TrackDownloadProcessor extends WorkerHost {
  constructor(private readonly trackService: TrackService) {
    super();
  }

  async process(job: Job<TrackEntity, void, string>): Promise<void> {
    await this.trackService.downloadFromYoutube(job.data);
    // Pacing delay between downloads to prevent memory spikes on Render and YouTube rate limits
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
