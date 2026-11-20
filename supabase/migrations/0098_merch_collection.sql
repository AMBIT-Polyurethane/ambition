-- 0098: the AMBIT clothing line on the ADC Merch page (Coming soon). Run this AFTER the push that adds the photos.
-- Prices: T-shirts and the tank $39.99, hoodies, crews and the sweater $59.99, jackets $149.99, onesie $19.99, cap $39.99.
-- Safe to run again: an item that is already there (same name) is left as it is.

insert into public.merch_items (name, description, price, image_url, sizes, sort, active)
select v.name, v.description, v.price, v.image_url, v.sizes, v.sort, true
  from (values
  ('COMING SOON: AMBIT Signal Hoodie', 'AMBIT red fleece "AMBIT" Hooded Sweatshirt', 59.99, '/adc/merch/signal-hoodie.jpg', 'S, M, L, XL, 2XL', 20),
  ('COMING SOON: AMBIT Orbit Hoodie', 'Black heavyweight fleece Hooded Sweatshirt, the glowing AMBIT atom across the back', 59.99, '/adc/merch/orbit-hoodie.jpg', 'S, M, L, XL, 2XL', 30),
  ('COMING SOON: AMBIT Academy Hoodie', 'Black heavyweight fleece "AMBIT Academy" Hooded Sweatshirt', 59.99, '/adc/merch/academy-hoodie.jpg', 'S, M, L, XL, 2XL', 40),
  ('COMING SOON: AMBIT Academy Logo Hoodie', 'Black heavyweight fleece Hooded Sweatshirt, AMBIT Academy logo at the chest', 59.99, '/adc/merch/academy-logo-hoodie.jpg', 'S, M, L, XL, 2XL', 50),
  ('COMING SOON: AMBIT Intelligence Tee', 'Oversized "AMBIT Intelligence" atom T-Shirt', 39.99, '/adc/merch/intelligence-tee.jpg', 'S, M, L, XL, 2XL', 60),
  ('COMING SOON: AMBIT Kick A Foam Tee', 'Black "Kick A Foam" graphic T-Shirt', 39.99, '/adc/merch/kick-a-foam-tee.jpg', 'S, M, L, XL, 2XL', 70),
  ('COMING SOON: AMBIT Essential Tee', 'White heavyweight cotton "AMBIT" T-Shirt', 39.99, '/adc/merch/essential-tee.jpg', 'S, M, L, XL, 2XL', 80),
  ('COMING SOON: AMBITION Bomber', 'Hot pink satin "AMBITION" Bomber Jacket', 149.99, '/adc/merch/ambition-bomber.jpg', 'S, M, L, XL, 2XL', 90),
  ('COMING SOON: AMBIT Orbit Bomber', 'Black satin Bomber Jacket, all-over orbit print from the AMBIT atom', 149.99, '/adc/merch/orbit-bomber.jpg', 'S, M, L, XL, 2XL', 100),
  ('COMING SOON: AMBIT Academy Varsity', 'Bone and AMBIT red "AMBIT Academy" Varsity Jacket', 149.99, '/adc/merch/academy-varsity.jpg', 'S, M, L, XL, 2XL', 110),
  ('COMING SOON: AMBIT Cap', 'Black six-panel "AMBIT" Cap, red underbrim', 39.99, '/adc/merch/ambit-cap.jpg', 'One size (adjustable)', 120),
  ('COMING SOON: AMBIT Academy Crew', 'Bone brushed fleece "AMBIT Academy" Crewneck Sweatshirt', 59.99, '/adc/merch/academy-crew.jpg', 'S, M, L, XL, 2XL', 130),
  ('COMING SOON: AMBIT Academy Logo Crew', 'Bone brushed fleece Crewneck Sweatshirt, full AMBIT Academy logo', 59.99, '/adc/merch/academy-logo-crew.jpg', 'S, M, L, XL, 2XL', 140),
  ('COMING SOON: AMBITION Sweater', 'Pink fine-gauge knit "AMBITION" Sweater', 59.99, '/adc/merch/ambition-sweater.jpg', 'S, M, L, XL, 2XL', 150),
  ('COMING SOON: AMBIT Rib Tank', 'Black fitted rib "AMBITION" Tank Top', 39.99, '/adc/merch/rib-tank.jpg', 'S, M, L, XL, 2XL', 160),
  ('COMING SOON: AMBIT A-Side Tee', 'AMBIT red "A-Side" T-Shirt (family set, for Mom)', 39.99, '/adc/merch/a-side-tee.jpg', 'S, M, L, XL, 2XL', 170),
  ('COMING SOON: AMBIT B-Side Tee', 'Black "B-Side" T-Shirt (family set, for Dad)', 39.99, '/adc/merch/b-side-tee.jpg', 'S, M, L, XL, 2XL', 180),
  ('COMING SOON: AMBIT 1:1 Onesie', 'Red and black "1:1" Baby Onesie (family set)', 19.99, '/adc/merch/one-to-one-onesie.jpg', '0-3M, 3-6M, 6-12M, 12-18M', 190),
  ('COMING SOON: AMBIT Off-Ratio Tee', 'White "My Friends Say I''m a Little Off-Ratio" T-Shirt', 39.99, '/adc/merch/off-ratio-tee.jpg', 'S, M, L, XL, 2XL', 200),
  ('COMING SOON: AMBIT Spray and Pray Tee', 'Black "Spray and Pray" T-Shirt', 39.99, '/adc/merch/spray-and-pray-tee.jpg', 'S, M, L, XL, 2XL', 210),
  ('COMING SOON: AMBIT Spray Butter Tee', 'Butter yellow "My Mommy Says I Spray Butter" T-Shirt', 39.99, '/adc/merch/spray-butter-tee.jpg', 'S, M, L, XL, 2XL', 220),
  ('COMING SOON: AMBIT Foam Around and Find Out Tee', 'AMBIT red "Foam Around and Find Out" T-Shirt', 39.99, '/adc/merch/foam-around-tee.jpg', 'S, M, L, XL, 2XL', 230),
  ('COMING SOON: AMBIT Butter Not Bitter Tee', 'Bone "Butter Not Bitter" T-Shirt', 39.99, '/adc/merch/butter-not-bitter-tee.jpg', 'S, M, L, XL, 2XL', 240),
  ('COMING SOON: AMBIT Hose Heat Tee', 'Black "Hose Heat Before Ho''s Sheets" T-Shirt', 39.99, '/adc/merch/hose-heat-tee.jpg', 'S, M, L, XL, 2XL', 250),
  ('COMING SOON: AMBIT Triggering Ain''t Easy Tee', 'White "Triggering Ain''t Easy" T-Shirt', 39.99, '/adc/merch/triggering-tee.jpg', 'S, M, L, XL, 2XL', 260),
  ('COMING SOON: AMBIT E04 Tee', 'Black "E04" error code T-Shirt', 39.99, '/adc/merch/e04-tee.jpg', 'S, M, L, XL, 2XL', 270),
  ('COMING SOON: AMBIT 1:1 or None Tee', 'AMBIT red "1:1 or None" T-Shirt', 39.99, '/adc/merch/one-to-one-tee.jpg', 'S, M, L, XL, 2XL', 280),
  ('COMING SOON: AMBIT Canon Tip Captain Tee', 'Black "Canon Tip Captain" T-Shirt', 39.99, '/adc/merch/canon-tip-captain-tee.jpg', 'S, M, L, XL, 2XL', 290)
  ) as v(name, description, price, image_url, sizes, sort)
 where not exists (select 1 from public.merch_items m where m.name = v.name);

-- Check: how many merch items the store shows now (29 with your 2 Pound Hound Hoodie).
select count(*) as "Merch items on the store" from public.merch_items where active;
