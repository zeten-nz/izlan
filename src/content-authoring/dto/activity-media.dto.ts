import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { RevisionEditDto } from './common.dto';
import { MAX_ALT_TEXT_LEN } from '../../media/media.constants';

/**
 * POST /staff/content/activities/:activityId/media — attach a MediaAsset to a DRAFT-revision Activity.
 * altText belongs to THIS attachment (not the asset). Optional at the DTO level; the service REQUIRES it for images.
 */
export class AttachActivityMediaDto extends RevisionEditDto {
  @IsUUID(undefined, { message: 'mediaAssetId must be a valid id' })
  mediaAssetId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ALT_TEXT_LEN, { message: 'altText too long' })
  altText?: string;
}

/** DELETE /staff/content/activities/:activityId/media/:mediaAssetId — carries the revision token in the body. */
export class DetachActivityMediaDto extends RevisionEditDto {}
