-- =====================================================================
-- AMBITION - starter data. Safe to edit later in the app (Admin) or in
-- Supabase > Table Editor. Sample products are replaced when you import
-- your product list (Admin > Products > Import CSV).
-- =====================================================================

insert into public.branches (id, name, state, sort) values
  ('okc', 'Oklahoma City', 'OK', 1),
  ('arl', 'Arlington',     'TX', 2),
  ('smt', 'San Marcos',    'TX', 3),
  ('jax', 'Jacksonville',  'FL', 4),
  ('mob', 'Mobile',        'AL', 5)
on conflict (id) do nothing;

insert into public.categories (id, name, customer_priced, sort) values
  ('spray-foam', 'Spray foam',   true,  1),
  ('fiberglass', 'Fiberglass',   true,  2),
  ('guns-parts', 'Guns & parts', false, 3),
  ('ppe',        'PPE & safety', false, 4),
  ('supplies',   'Supplies',     false, 5)
on conflict (id) do nothing;

insert into public.products (sku, name, description, category_id, unit, list_price, sort) values
  ('SAMPLE-SEAL',   'AMBI-SEAL Open Cell (sample)',        'Set · A + B drums',        'spray-foam', 'set',  null, 1),
  ('SAMPLE-TITE',   'AMBI-TITE Closed Cell (sample)',      'Set · A + B drums',        'spray-foam', 'set',  null, 2),
  ('SAMPLE-ROOF',   'AMBI-ROOF Roofing Foam (sample)',     'Set · A + B drums',        'spray-foam', 'set',  null, 3),
  ('SAMPLE-BATT',   'Fiberglass Batt R-13 Unfaced (sample)', '15 in × 93 in · bag',    'fiberglass', 'bag',  null, 4),
  ('SAMPLE-BLOW',   'Fiberglass Blowing Wool (sample)',    'Bag',                      'fiberglass', 'bag',  null, 5),
  ('SAMPLE-CHMBR',  'Mix Chamber (sample)',                'For AP-style guns',        'guns-parts', 'each', null, 6),
  ('SAMPLE-GREASE', 'Gun Grease Cartridge (sample)',       '14 oz',                    'guns-parts', 'each', null, 7),
  ('SAMPLE-SUITS',  'Disposable Coveralls (sample)',       'Case of 25 · XL',          'ppe',        'case', null, 8),
  ('SAMPLE-GLOVES', 'Nitrile Gloves (sample)',             'Box of 100 · L',           'ppe',        'box', null, 9),
  ('SAMPLE-CART',   'Respirator Cartridges (sample)',      'Organic vapor · pair',     'ppe',        'pair', null, 10),
  ('SAMPLE-STAPLE', 'Insulation Staples (sample)',         '9/16 in · box',            'supplies',   'box', null, 11),
  ('SAMPLE-POLY',   'Poly Sheeting 6 mil (sample)',        '10 ft × 100 ft roll',      'supplies',   'roll', null, 12)
on conflict (sku) do nothing;

-- Home-screen forms and tiles. Paste the real links in Admin > Links.
insert into public.links (title, subtitle, url, icon, section, audience, open_in_app, sort) values
  ('Price request',      'Quote pricing for a customer',  null, 'tag',       'forms',     'employee', true,  1),
  ('Travel request',     'Trips, mileage, lodging',       null, 'plane',     'forms',     'employee', true,  2),
  ('Customer complaint', 'Product quality report',        null, 'alert',     'forms',     'employee', true,  3),
  ('Spray job data log', 'Field conditions & settings',   null, 'clipboard', 'forms',     'all',      true,  4),
  ('Marketing kit',      'Co-branded material',           null, 'megaphone', 'resources', 'customer', false, 10),
  ('Marketing content',  'Co-branded material',           null, 'megaphone', 'resources', 'employee', false, 10),
  ('Training videos',    'Watch on the job',              null, 'play',      'resources', 'all',      false, 11),
  ('Training manuals',   'Building science',              null, 'book',      'resources', 'employee', false, 12),
  ('Tech support',       'Call or email AMBIT',           'mailto:orders@ambitpu.com', 'headset', 'resources', 'customer', false, 13);

insert into public.documents (title, doc_type, product, code, description, audience, sort) values
  ('AMBI-SEAL Technical Data Sheet', 'TDS', 'AMBI-SEAL', null, 'Add the PDF in Admin > Docs', 'all', 1),
  ('AMBI-SEAL Safety Data Sheet',    'SDS', 'AMBI-SEAL', null, 'Add the PDF in Admin > Docs', 'all', 2),
  ('AMBI-TITE Technical Data Sheet', 'TDS', 'AMBI-TITE', null, 'Add the PDF in Admin > Docs', 'all', 3),
  ('AMBI-TITE Safety Data Sheet',    'SDS', 'AMBI-TITE', null, 'Add the PDF in Admin > Docs', 'all', 4),
  ('Combustion safety',              'TSB', null, 'TSB-013', 'Technical service bulletin', 'all', 10),
  ('Minor open-cell separation',     'TSB', null, 'TSB-014', 'Technical service bulletin', 'all', 11),
  ('HVAC & the building envelope',   'TSB', null, 'TSB-015', 'Technical service bulletin', 'all', 12);

insert into public.courses (title, subtitle, lessons, minutes, sort) values
  ('Building science fundamentals',        'Heat, air and moisture movement',     6, 45, 1),
  ('Spray foam application',               'Set-up, technique and yield',         8, 60, 2),
  ('Moisture, dew point & substrate prep', 'Reading conditions before you spray', 4, 30, 3),
  ('HVAC & the building envelope',         'Sizing and ventilation after foam',   5, 40, 4),
  ('Combustion safety',                    'Appliances in sealed homes',          4, 30, 5);
