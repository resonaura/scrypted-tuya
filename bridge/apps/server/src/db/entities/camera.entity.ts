import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  BaseEntity,
} from "typeorm";

@Entity("cameras")
export class CameraEntity extends BaseEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "varchar", length: 64, unique: true })
  did!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  localKey!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  ip!: string;

  @Column({ type: "integer", default: 6668 })
  port!: number;

  @Column({ type: "varchar", length: 64, default: "" })
  p2pId!: string;

  @Column({ type: "varchar", length: 32, default: "sp" })
  category!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  productId!: string;

  @Column({ type: "varchar", length: 64, default: "" })
  uuid!: string;

  @Column({ type: "text", default: "" })
  skill!: string;

  @Column({ type: "text", default: "" })
  p2pConfig!: string;

  @Column({ type: "boolean", default: false })
  online!: boolean;

  @Column({ type: "integer", default: 8554 })
  rtspPort!: number;

  @Column({ type: "varchar", length: 128, default: "" })
  rtspPath!: string;

  @Column({ type: "varchar", length: 16, default: "hd" })
  quality!: string;

  @Column({ type: "boolean", default: true })
  audioEnabled!: boolean;

  @Column({ type: "datetime", nullable: true })
  lastSeen?: Date;

  @Column({ type: "text", nullable: true })
  snapshot?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
