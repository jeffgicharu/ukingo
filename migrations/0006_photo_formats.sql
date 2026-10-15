-- Photographs put up from the back office are made ready in the browser that
-- sends them. Every browser can save a JPEG, and most a WebP too, so each
-- photograph records the formats it was kept in.

ALTER TABLE room_photos
    ADD COLUMN formats text[] NOT NULL DEFAULT '{jpg}'
        CHECK (formats <@ ARRAY['webp', 'jpg']::text[] AND 'jpg' = ANY (formats));
