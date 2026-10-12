-- A guest may ask for their details to be deleted. The stays and payments
-- stay in the books, with no name and no number against them, so a phone
-- number may now be empty. Anything that is not empty is still held to the
-- one form every number is stored in.

ALTER TABLE guests
    DROP CONSTRAINT guests_phone_check,
    ADD CONSTRAINT guests_phone_check CHECK (phone = '' OR phone ~ '^\+254[17][0-9]{8}$');

ALTER TABLE bookings
    DROP CONSTRAINT bookings_guest_phone_check,
    ADD CONSTRAINT bookings_guest_phone_check CHECK (guest_phone = '' OR guest_phone ~ '^\+254[17][0-9]{8}$');
