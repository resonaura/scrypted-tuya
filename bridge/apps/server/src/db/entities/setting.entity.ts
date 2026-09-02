import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  BaseEntity,
} from "typeorm";

@Entity("settings")
export class SettingEntity extends BaseEntity {
  @PrimaryColumn({ type: "varchar", length: 128 })
  key!: string;

  @Column({ type: "text", default: "" })
  value!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
