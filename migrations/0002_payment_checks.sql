-- When the site last asked M-Pesa what became of a prompt, so that it does
-- not ask again a second later.
ALTER TABLE payments ADD COLUMN checked_at timestamptz;
