-- Words can be tried before guests see them.
--
-- A piece of site text gets a draft beside its published value, as pages
-- already have. A question can be kept back from guests while it is written.

ALTER TABLE site_text ADD COLUMN draft text;
ALTER TABLE questions ADD COLUMN shown boolean NOT NULL DEFAULT true;
