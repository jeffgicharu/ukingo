-- Photographs staff have put up for a kind of room. Each kind of room shows
-- three: the main one, one inside and one detail. A place with no row here
-- shows the photograph the site was built with.

CREATE TABLE room_photos (
    room_type_id integer NOT NULL REFERENCES room_types (id),
    place text NOT NULL CHECK (place IN ('main', 'inside', 'detail')),
    -- The name its copies are saved under: <file>-<width>.<avif|webp|jpg>
    file text NOT NULL UNIQUE CHECK (file ~ '^[a-z0-9-]+$'),
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    widths integer[] NOT NULL,
    colour text NOT NULL CHECK (colour ~ '^#[0-9a-f]{6}$'),
    description text NOT NULL CHECK (length(description) BETWEEN 10 AND 200),
    added_by integer REFERENCES staff (id),
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_type_id, place)
);
