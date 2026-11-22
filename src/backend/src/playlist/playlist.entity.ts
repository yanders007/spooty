import { Entity, Column, PrimaryGeneratedColumn, OneToMany, BeforeInsert } from 'typeorm';
import { TrackEntity } from '../track/track.entity';

@Entity()
export class PlaylistEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  name?: string;

  @Column()
  spotifyUrl: string;

  @Column({ nullable: true })
  error?: string;

  @Column({ default: false })
  active?: boolean;

  @Column({ type: 'bigint', nullable: true })
  createdAt?: number;

  @BeforeInsert()
  setCreatedAt() {
    this.createdAt = Date.now();
  }

  @OneToMany(() => TrackEntity, (track) => track.playlist)
  tracks?: TrackEntity[];
}
