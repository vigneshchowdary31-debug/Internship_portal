-- Records the provider's own classification of each asset, captured at upload.
--
-- Cloudinary's destroy endpoint is `/v1_1/<cloud>/<resource_type>/destroy` and
-- rejects the `auto` we use for uploads:
--   400 Invalid resource type 'auto'. Must be one of: image, javascript, css, video, raw.
-- Without these columns the correct delete URL cannot be constructed at all.
--
-- Nullable rather than defaulted: `format` is genuinely absent for `raw` assets,
-- and inventing a default for `resourceType` would reintroduce the guesswork
-- this replaces. Both are populated from the upload response going forward.
ALTER TABLE "MediaAsset" ADD COLUMN     "format" TEXT,
ADD COLUMN     "resourceType" TEXT;
