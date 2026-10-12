-- The lodge: its rooms, what a night costs, and the rules a booking is made under.

-- Lets one constraint compare a room (equality) and a run of nights (overlap).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- One row, always. The lodge's details and the rules new bookings are made under.
CREATE TABLE settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),

    lodge_name text NOT NULL,
    place text NOT NULL,
    check_in_from text NOT NULL,
    check_out_by text NOT NULL,

    -- How long a room is kept for a guest who has started to pay.
    hold_minutes integer NOT NULL CHECK (hold_minutes BETWEEN 5 AND 120),
    -- How long a booking made by staff waits for its deposit.
    provisional_hours integer NOT NULL CHECK (provisional_hours BETWEEN 1 AND 168),
    deposit_percent integer NOT NULL CHECK (deposit_percent BETWEEN 1 AND 100),
    -- The balance is due this many days before arrival. A booking made inside
    -- that window is paid in full.
    balance_due_days integer NOT NULL CHECK (balance_due_days BETWEEN 0 AND 120),
    -- Dates can be changed until this many days before arrival.
    change_until_days integer NOT NULL CHECK (change_until_days BETWEEN 0 AND 120),
    -- [{"min_days": 30, "keep_percent": 0}, …] from the most notice to the least.
    -- keep_percent is the share of the booking's total the lodge keeps.
    cancellation_steps jsonb NOT NULL,

    booking_window_months integer NOT NULL CHECK (booking_window_months BETWEEN 1 AND 24),
    -- After this hour (East Africa Time) tonight can no longer be booked online.
    same_day_until_hour integer NOT NULL CHECK (same_day_until_hour BETWEEN 0 AND 23),
    max_nights integer NOT NULL CHECK (max_nights BETWEEN 1 AND 60),

    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_types (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL,
    tagline text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    sleeps integer NOT NULL CHECK (sleeps BETWEEN 1 AND 20),
    bedrooms integer NOT NULL DEFAULT 1 CHECK (bedrooms BETWEEN 1 AND 10),
    beds text NOT NULL DEFAULT '',
    size_sqm integer CHECK (size_sqm > 0),
    features jsonb NOT NULL DEFAULT '[]',
    position integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true
);

-- The rooms themselves. A booking is always for one of these, never for "a
-- room of this type".
CREATE TABLE rooms (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_type_id integer NOT NULL REFERENCES room_types,
    name text NOT NULL UNIQUE,
    position integer NOT NULL DEFAULT 0,
    -- A room taken out of use keeps its history and stops being offered.
    active boolean NOT NULL DEFAULT true
);

CREATE INDEX rooms_by_type ON rooms (room_type_id, position);

CREATE TABLE seasons (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE CHECK (code ~ '^[a-z]+$'),
    name text NOT NULL,
    -- The season of any night that no date range below names.
    is_default boolean NOT NULL DEFAULT false,
    position integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX seasons_one_default ON seasons (is_default) WHERE is_default;

CREATE TABLE season_dates (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    season_id integer NOT NULL REFERENCES seasons ON DELETE CASCADE,
    dates daterange NOT NULL CHECK (NOT isempty(dates) AND NOT lower_inf(dates) AND NOT upper_inf(dates)),
    label text NOT NULL DEFAULT '',
    -- A night belongs to one season only.
    CONSTRAINT season_dates_do_not_overlap EXCLUDE USING gist (dates WITH &&)
);

CREATE TABLE rates (
    room_type_id integer NOT NULL REFERENCES room_types ON DELETE CASCADE,
    season_id integer NOT NULL REFERENCES seasons ON DELETE CASCADE,
    -- Sunday to Thursday nights, and Friday and Saturday nights, in cents.
    weeknight_cents bigint NOT NULL CHECK (weeknight_cents > 0),
    weekend_cents bigint NOT NULL CHECK (weekend_cents > 0),
    PRIMARY KEY (room_type_id, season_id)
);

-- "At least two nights over the Christmas week."
CREATE TABLE stay_rules (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dates daterange NOT NULL CHECK (NOT isempty(dates) AND NOT lower_inf(dates) AND NOT upper_inf(dates)),
    min_nights integer NOT NULL CHECK (min_nights BETWEEN 2 AND 14),
    label text NOT NULL
);

CREATE TABLE meal_plans (
    code text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    -- Added to the room price, per person per night, in cents.
    adult_cents bigint NOT NULL CHECK (adult_cents >= 0),
    child_cents bigint NOT NULL CHECK (child_cents >= 0),
    position integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE extras (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    duration text NOT NULL DEFAULT '',
    price_cents bigint NOT NULL CHECK (price_cents > 0),
    charged text NOT NULL CHECK (charged IN ('per_person', 'per_booking')),
    position integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true
);

-- Staff.

CREATE TABLE staff (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'reservations', 'front_desk')),
    -- Someone who has left is switched off, never deleted, so history keeps their name.
    active boolean NOT NULL DEFAULT true,
    -- A training account works bookings on sample data and cannot change how
    -- the lodge is set up.
    training boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_sign_in_at timestamptz
);

CREATE TABLE staff_sessions (
    -- SHA-256 of the cookie's value. The value itself is never stored.
    id text PRIMARY KEY,
    staff_id integer NOT NULL REFERENCES staff ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    ip inet,
    user_agent text NOT NULL DEFAULT ''
);

CREATE INDEX staff_sessions_by_expiry ON staff_sessions (expires_at);

CREATE TABLE sign_in_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    ip inet,
    at timestamptz NOT NULL,
    succeeded boolean NOT NULL
);

CREATE INDEX sign_in_attempts_recent ON sign_in_attempts (at);

CREATE TABLE password_resets (
    token_hash text PRIMARY KEY,
    staff_id integer NOT NULL REFERENCES staff ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
);

-- Guests and their bookings.

CREATE TABLE guests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    -- +254 and nine digits.
    phone text NOT NULL CHECK (phone ~ '^\+254[17][0-9]{8}$'),
    email text CHECK (email = lower(email)),
    notes text NOT NULL DEFAULT '',
    -- Sample guests are invented. They are never emailed and their phones are never prompted.
    sample boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
);

CREATE INDEX guests_by_phone ON guests (phone);
CREATE INDEX guests_by_email ON guests (email) WHERE email IS NOT NULL;

CREATE TABLE bookings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- What the guest and the desk call the booking: UKG-7Q4MXR.
    reference text NOT NULL UNIQUE,
    -- Raised to make every private link issued for this booking stop working.
    link_version integer NOT NULL DEFAULT 1,
    -- Sent with the booking form, so the same form sent twice makes one booking.
    request_key text UNIQUE,

    guest_id bigint NOT NULL REFERENCES guests,
    -- The contact details given for this booking, as they were given.
    guest_name text NOT NULL,
    guest_phone text NOT NULL CHECK (guest_phone ~ '^\+254[17][0-9]{8}$'),
    guest_email text CHECK (guest_email = lower(guest_email)),

    room_type_id integer NOT NULL REFERENCES room_types,
    -- The room held, or the room last held once the booking no longer holds one.
    room_id integer NOT NULL REFERENCES rooms,
    stay daterange NOT NULL CHECK (NOT isempty(stay) AND NOT lower_inf(stay) AND NOT upper_inf(stay)),
    adults integer NOT NULL CHECK (adults >= 1),
    children integer NOT NULL DEFAULT 0 CHECK (children >= 0),
    meal_plan text NOT NULL REFERENCES meal_plans,
    arrival_time text NOT NULL DEFAULT '',
    requests text NOT NULL DEFAULT '',

    status text NOT NULL CHECK (status IN (
        'held',         -- the guest is paying; the room is kept for a few minutes
        'provisional',  -- made by staff; the room is kept until a deposit deadline
        'confirmed',
        'checked_in',
        'checked_out',
        'cancelled',
        'expired',      -- held or provisional, and never paid for
        'no_show'
    )),
    source text NOT NULL CHECK (source IN ('website', 'desk')),
    -- When a held or provisional booking lets its room go.
    hold_until timestamptz,

    -- Nights plus charges, in cents. Kept in step with those rows by the code
    -- that writes them, and checked nightly.
    total_cents bigint NOT NULL CHECK (total_cents >= 0),
    -- The rules as they stood when the booking was made, as dates and amounts.
    terms jsonb NOT NULL,

    created_by integer REFERENCES staff,
    created_at timestamptz NOT NULL,
    confirmed_at timestamptz,
    checked_in_at timestamptz,
    checked_out_at timestamptz,
    cancelled_at timestamptz,
    ended_reason text,

    origin_ip inet,
    sample boolean NOT NULL DEFAULT false,

    CHECK (upper(stay) - lower(stay) BETWEEN 1 AND 60),
    CHECK ((status IN ('held', 'provisional')) = (hold_until IS NOT NULL))
);

CREATE INDEX bookings_by_guest ON bookings (guest_id);
CREATE INDEX bookings_by_arrival ON bookings (lower(stay));
CREATE INDEX bookings_by_status ON bookings (status, hold_until);
CREATE INDEX bookings_by_stay ON bookings USING gist (stay);

-- Who has which room on which nights. A row here is the only thing that
-- takes a room off sale: a live booking has one, and so does a room blocked
-- for repairs. The constraint is the guarantee the rest of the system leans
-- on. Two rows for one room can never share a night, whatever the application
-- asks for and however many people ask at once.
CREATE TABLE allocations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id integer NOT NULL REFERENCES rooms,
    stay daterange NOT NULL CHECK (NOT isempty(stay) AND NOT lower_inf(stay) AND NOT upper_inf(stay)),
    booking_id bigint UNIQUE REFERENCES bookings ON DELETE CASCADE,
    -- Set when the room is blocked rather than booked.
    block_reason text,
    created_by integer REFERENCES staff,
    created_at timestamptz NOT NULL,

    CHECK ((booking_id IS NULL) <> (block_reason IS NULL)),
    CONSTRAINT one_stay_per_room_per_night EXCLUDE USING gist (room_id WITH =, stay WITH &&)
);

-- What each night cost when the booking was made.
CREATE TABLE booking_nights (
    booking_id bigint NOT NULL REFERENCES bookings ON DELETE CASCADE,
    night date NOT NULL,
    cents bigint NOT NULL CHECK (cents >= 0),
    season text NOT NULL,
    PRIMARY KEY (booking_id, night)
);

-- Everything on the bill that is not a night: meals, extras, and changes staff make.
CREATE TABLE booking_charges (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL REFERENCES bookings ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('meals', 'extra', 'adjustment')),
    label text NOT NULL,
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    unit_cents bigint NOT NULL,
    cents bigint NOT NULL,
    extra_id integer REFERENCES extras,
    created_by integer REFERENCES staff,
    created_at timestamptz NOT NULL
);

CREATE INDEX booking_charges_by_booking ON booking_charges (booking_id);

CREATE TABLE payments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL REFERENCES bookings,
    method text NOT NULL CHECK (method IN ('mpesa_prompt', 'test', 'mpesa_desk', 'cash', 'bank')),
    -- What the payment counts as against the booking, in cents.
    cents bigint NOT NULL CHECK (cents > 0),
    -- What the phone was actually asked for, when that differs.
    prompt_cents bigint CHECK (prompt_cents > 0),
    phone text,
    status text NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
    failure text CHECK (failure IN ('cancelled', 'timeout', 'wrong_pin', 'insufficient_funds', 'unreachable', 'limit', 'other')),
    failure_detail text,

    -- Safaricom's names for one prompt.
    checkout_request_id text UNIQUE,
    merchant_request_id text,
    -- Part of the address Safaricom answers on, different for every prompt.
    callback_key text,
    -- The M-Pesa receipt number, or the reference staff typed at the desk.
    receipt text,

    requested_at timestamptz NOT NULL,
    settled_at timestamptz,
    status_checks integer NOT NULL DEFAULT 0,
    recorded_by integer REFERENCES staff,
    origin_ip inet,

    CHECK ((status = 'pending') = (settled_at IS NULL))
);

CREATE INDEX payments_by_booking ON payments (booking_id);
CREATE INDEX payments_pending ON payments (requested_at) WHERE status = 'pending';
-- One M-Pesa receipt is one payment, however many times it is reported.
CREATE UNIQUE INDEX payments_one_per_receipt ON payments (receipt) WHERE method = 'mpesa_prompt' AND receipt IS NOT NULL;

-- Money owed back to a guest. Worked out by the system, sent by hand, recorded here.
CREATE TABLE refunds (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL REFERENCES bookings,
    cents bigint NOT NULL CHECK (cents > 0),
    reason text NOT NULL,
    status text NOT NULL CHECK (status IN ('owed', 'sent')),
    created_at timestamptz NOT NULL,
    sent_at timestamptz,
    sent_by integer REFERENCES staff,
    reference text,
    CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

CREATE INDEX refunds_by_booking ON refunds (booking_id);
CREATE INDEX refunds_owed ON refunds (created_at) WHERE status = 'owed';

-- What happened to a booking, in order, and who did it.
CREATE TABLE booking_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL REFERENCES bookings ON DELETE CASCADE,
    at timestamptz NOT NULL,
    actor text NOT NULL CHECK (actor IN ('guest', 'staff', 'system')),
    staff_id integer REFERENCES staff,
    kind text NOT NULL,
    summary text NOT NULL,
    detail jsonb
);

CREATE INDEX booking_events_by_booking ON booking_events (booking_id, at);

CREATE TABLE booking_notes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL REFERENCES bookings ON DELETE CASCADE,
    staff_id integer NOT NULL REFERENCES staff,
    body text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE INDEX booking_notes_by_booking ON booking_notes (booking_id, created_at);

-- Every email and text message, written here before anything is sent.
CREATE TABLE messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint REFERENCES bookings ON DELETE CASCADE,
    guest_id bigint REFERENCES guests ON DELETE SET NULL,
    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    kind text NOT NULL,
    recipient text NOT NULL,
    subject text,
    -- As the guest received it, except that private links are replaced by a stand-in.
    html text,
    body text NOT NULL,
    status text NOT NULL CHECK (status IN (
        'queued',
        'sent',
        'failed',
        'not_sent'  -- written and kept, deliberately not sent; status_reason says why
    )),
    status_reason text,
    -- The same message is never written twice: "balance-due:42:2026-10-27".
    once_key text UNIQUE,
    provider_id text,
    origin_ip inet,
    created_at timestamptz NOT NULL,
    sent_at timestamptz
);

CREATE INDEX messages_by_booking ON messages (booking_id, created_at);
CREATE INDEX messages_by_day ON messages (created_at);
CREATE INDEX messages_queued ON messages (created_at) WHERE status = 'queued';

-- The words on the site that staff can change.

CREATE TABLE pages (
    slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text NOT NULL,
    summary text NOT NULL DEFAULT '',
    body text NOT NULL,
    -- An edit waits here until it is published.
    draft_title text,
    draft_summary text,
    draft_body text,
    position integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by integer REFERENCES staff
);

CREATE TABLE questions (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic text NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    position integer NOT NULL DEFAULT 0
);

-- Short pieces of text placed on the home page: headline, introduction and so on.
CREATE TABLE site_text (
    key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
    label text NOT NULL,
    value text NOT NULL,
    position integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Housekeeping for the system itself.

-- When each kind of trouble was last reported, so one fault does not send a flood of email.
CREATE TABLE alerts (
    key text PRIMARY KEY,
    last_sent_at timestamptz NOT NULL,
    times integer NOT NULL DEFAULT 1
);

-- Moves on whenever something the front desk is looking at changes. Staff
-- screens watch it and refresh themselves.
CREATE SEQUENCE desk_pulse;
