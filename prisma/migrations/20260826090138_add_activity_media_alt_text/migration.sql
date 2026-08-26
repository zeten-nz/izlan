-- Alt text is contextual to how an asset is used in a specific activity, so it lives on the
-- attachment relation (activity_media), not on the reusable MediaAsset. Nullable at the DB level
-- (migration compatibility + AUDIO has no required alt); the IMAGE "non-empty" rule is enforced in
-- the domain/service layer, not by a NOT NULL constraint.
ALTER TABLE "activity_media" ADD COLUMN "alt_text" TEXT;
