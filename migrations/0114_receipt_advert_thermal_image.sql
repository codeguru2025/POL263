-- Second, format-specific image on receipt_adverts: the existing image_url column is now the A4
-- (full-page) receipt image; this new column is the thermal-roll (48/58/80mm) image. The two
-- print formats draw the advert into differently-shaped boxes (A4: wide banner; thermal: less
-- elongated, near-full-width column), so one image sized for A4 looks wrong on a thermal receipt
-- and vice versa. Nullable and unset for every existing advert — server/receipt-pdf.ts falls back
-- to image_url when this is null, so no existing advert's thermal-receipt rendering changes until
-- an admin uploads a thermal-specific image via Settings.
ALTER TABLE receipt_adverts ADD COLUMN IF NOT EXISTS image_url_thermal text;
