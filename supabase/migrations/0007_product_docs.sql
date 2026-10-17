-- =====================================================================
-- AMBITION - product docs library
--  * more document types (code reports, warranties, certificates, SPFA library)
--  * a document can belong to several products (the A-side SDS covers 3)
--  * revision text, renewal date for code reports, library category
--  * loads the current AMBIT product docs and the SPFA library from ambitpu.com.
--    The rows start as links to the website; Admin > Docs > "Copy files into
--    the app" stores a copy of each file in the app's own storage.
-- Safe to run more than once.
-- =====================================================================

alter table public.documents drop constraint if exists documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check check (doc_type in
  ('TDS', 'SDS', 'ESR', 'CCRR', 'TSB', 'Guide', 'Warranty', 'Certificate',
   'Marketing', 'Training', 'Industry', 'Other'));

alter table public.documents add column if not exists products   text[] not null default '{}';
alter table public.documents add column if not exists category   text;   -- library shelf, e.g. 'Roofing'
alter table public.documents add column if not exists revision   text;   -- shown as-is, e.g. 'Rev. 10/01/2024'
alter table public.documents add column if not exists renewal_on date;   -- code reports: renewal / expiry date

-- the old single "product" column becomes the first entry of "products"
update public.documents set products = array[product]
 where product is not null and product <> '' and products = '{}';

-- the empty placeholders from the first setup are replaced by the real files below
delete from public.documents
 where url is null and storage_path is null and doc_type in ('TDS', 'SDS')
   and title in ('AMBI-SEAL Technical Data Sheet', 'AMBI-SEAL Safety Data Sheet',
                 'AMBI-TITE Technical Data Sheet', 'AMBI-TITE Safety Data Sheet');

-- ---------------------------------------------------------------- AMBIT product docs
insert into public.documents (title, doc_type, products, code, description, revision, renewal_on, url, audience, sort)
select v.title, v.doc_type, v.products, v.code, v.description, v.revision, v.renewal_on::date,
       'https://ambitpu.com/wp-content/uploads/' || v.file, 'all', v.sort
from (values
  ('AMBI-SEAL 5.0 Technical Data Sheet', 'TDS', array['AMBI-SEAL 5.0'], null, 'Open-cell spray foam', 'Rev. 10/01/2024', null,
   '2025/03/TDS-AMBI-SEAL-5.0-Revision-10-01-2024.pdf', 101),
  ('PMDI ISO (A-side) Safety Data Sheet', 'SDS', array['AMBI-SEAL 5.0', 'AMBI-TITE 204', 'AMBI-JACK 4.0'], null, 'A-component for AMBI-SEAL, AMBI-TITE and AMBI-JACK', 'Rev. 10/05/2024', null,
   '2025/03/SDS-AMBIT-PMDI-ISO-A-COMPONENT-10-2024.pdf', 102),
  ('AMBI-SEAL 5.0 B-side Safety Data Sheet', 'SDS', array['AMBI-SEAL 5.0'], null, 'B-component (resin)', 'Rev. 09/23/2020', null,
   '2025/03/SDS-AMBI-SEAL-5.0-Open-Cell-B-Component-2021-04-26.pdf', 103),
  ('AMBI-SEAL 5.0 Code Compliance Research Report', 'CCRR', array['AMBI-SEAL 5.0'], 'CCRR-0393', 'Intertek code compliance report', 'Rev. 11/21/2024', '2025-11-30',
   '2025/03/CCRR-0393-AMBI-SEAL-5.0-11-30-2025-1.pdf', 104),
  ('AMBI-SEAL 5.0 Product Application Guide', 'Guide', array['AMBI-SEAL 5.0'], null, null, '12/12/2022', null,
   '2025/03/Product-Application-Guide-AMBI-SEAL-5.0-2022-12-12.pdf', 105),
  ('AMBI-SEAL 5.0 Warranty & Registration Form', 'Warranty', array['AMBI-SEAL 5.0'], null, null, '06/14/2021', null,
   '2025/03/AMBI-SEAL-5.0-Warranty-and-Registration-Form-2021-06-14.pdf', 106),
  ('Insulation Certificate', 'Certificate', array['AMBI-SEAL 5.0', 'AMBI-JACK 4.0'], null, null, '04/26/2024', null,
   '2025/03/INSULATION-CERTIFICATES-04-26-2024.pdf', 107),
  ('Flame Control 60-60A Thermal Barrier Data Sheet', 'TDS', array['AMBI-SEAL 5.0', 'AMBI-JACK 4.0'], null, '15-minute thermal barrier coating over spray foam', null, null,
   '2025/05/Flame-Control-60-60A.pdf', 108),

  ('AMBI-TITE 204 HFO Technical Data Sheet', 'TDS', array['AMBI-TITE 204'], null, 'Closed-cell HFO spray foam', 'Rev. 05/07/2025', null,
   '2026/06/TDS-AMBI-TITE-204-HFO-05-07-June-2026.pdf', 201),
  ('AMBI-TITE 204 HFO B-side Safety Data Sheet', 'SDS', array['AMBI-TITE 204'], null, 'B-component (resin)', 'Rev. 09/01/2022', null,
   '2025/11/SAFETY-DATA-SHEET-AMBI-TITE-204-HFO-Closed-Cell-SPF-System-B-Component-2022-09-01.pdf', 203),
  ('AMBI-TITE 204 HFO ICC-ES Evaluation Report', 'ESR', array['AMBI-TITE 204'], 'ESR-4427', 'ICC-ES evaluation report (includes FL supplement)', 'Reissued May 2025', '2027-05-01',
   '2025/11/ESR-4427-AMBI-TITE-204-HFO-May-2025.pdf', 204),
  ('AMBI-TITE 204 HFO Product Application Guide', 'Guide', array['AMBI-TITE 204'], null, null, '01/21/2025', null,
   '2025/03/Product-Application-Guide-AMBI-TITE-204-HFO-01-21-2025-KIM-HIGHT.pdf', 205),
  ('AMBI-TITE 204 HFO Warranty & Registration Form', 'Warranty', array['AMBI-TITE 204'], null, null, null, null,
   '2025/03/AMBI-TITE-204-HFO-Warranty-and-Registration-Form.pdf', 206),
  ('AMBI-TITE 204 HFO Product Brochure', 'Marketing', array['AMBI-TITE 204'], null, null, '11/08/2023', null,
   '2025/03/AMBI-TITE-204-HFO-Product-Flyer-2023-11-08-1.pdf', 208),

  ('AMBI-JACK 4.0 Technical Data Sheet', 'TDS', array['AMBI-JACK 4.0'], null, 'Concrete lifting foam', 'Rev. 03/25/2025', null,
   '2025/03/TDS-AMBI-JACK-4.0-Revision-225-03-25-Belinda-Kemper.pdf', 301),
  ('AMBI-JACK 4.0 B-side Safety Data Sheet', 'SDS', array['AMBI-JACK 4.0'], null, 'B-component (resin)', 'Rev. 08/03/2021', null,
   '2025/03/SDS-AMBI-JACK-4.0-Concrete-Lifing-System-B-Component-2021-08-03.pdf', 303),
  ('AMBI-JACK 4.0 Product Brochure', 'Marketing', array['AMBI-JACK 4.0'], null, null, '11/12/2024', null,
   '2025/03/AMBI-JACK-4.0-Product-Flyer-11-12-2024.pdf', 308),

  ('AMBI-ROOF 2.8 HFO Technical Data Sheet', 'TDS', array['AMBI-ROOF 2.8'], null, 'Roofing foam', 'Rev. 08/29/2024', null,
   '2025/11/TDS-AMBI-ROOF-2.8-HFO-08-29-2024.pdf', 401),
  ('AMBI-ROOF 2.8 Roofing Foam System Safety Data Sheet', 'SDS', array['AMBI-ROOF 2.8'], null, null, '2025', null,
   '2025/09/SAFETY-DATA-SHEET-AMBI-ROOF-2.8-ROOFING-FOAM-SYSTEM-2025.docx.pdf', 402)
) as v(title, doc_type, products, code, description, revision, renewal_on, file, sort)
where not exists (select 1 from public.documents d where d.url = 'https://ambitpu.com/wp-content/uploads/' || v.file);

-- ---------------------------------------------------------------- SPFA technical library
insert into public.documents (title, doc_type, code, category, url, audience, sort)
select v.title, 'Industry', v.code, v.category, 'https://ambitpu.com/wp-content/uploads/2025/10/' || v.file, 'all', v.sort
from (values
  ('SPFA-102', 'Roofing',    'A Guide for Selection of Elastomeric Protective Coatings Over Exterior SPF Applications', 'SPFA-102_010121.pdf', 1102),
  ('SPFA-103', 'Specialty',  'SPF Insulation Systems for Metal Service Vessels (-30°F to 200°F)', 'SPFA-103_010121.pdf', 1103),
  ('SPFA-104', 'Roofing',    'SPF Systems for New and Remedial Roofing', 'SPFA104_013123.pdf', 1104),
  ('SPFA-107', 'Roofing',    'SPF Roofing Blisters: Causes, Types, Prevention and Repair', 'SPFA-107_012725.pdf', 1107),
  ('SPFA-110', 'Roofing',    'SPF Aggregate Systems for New and Remedial Roofing', 'SPFA-110_012725.pdf', 1110),
  ('SPFA-111', 'Specialty',  'SPF Systems for Cold Storage Facilities (-40°F to +50°F)', 'SPFA-111_010121.pdf', 1111),
  ('SPFA-112', 'Insulation', 'SPF for Residential Building Envelope Insulation and Air Seal', 'SPFA-112_011021.pdf', 1112),
  ('SPFA-118', 'General',    'Moisture Management (Moisture Vapor Transmission)', 'SPFA-118-Moisture-Vapor-Transmission.pdf', 1118),
  ('SPFA-119', 'General',    'Glossary of Terms', 'SPFA-119_050223.pdf', 1119),
  ('SPFA-121', 'General',    'SPF Estimating Guide', 'SPFA-121_011021.pdf', 1121),
  ('SPFA-122', 'Roofing',    'Renewal of Foam and Coatings for SPF Roof Systems', 'SPFA-122_012725.pdf', 1122),
  ('SPFA-126', 'Insulation', 'Thermal and Ignition Barriers for SPF Insulation', 'SPFA-126_101222.pdf', 1126),
  ('SPFA-127', 'Roofing',    'SPF Roof Systems Maintenance Manual', 'SPFA-127_011021.pdf', 1127),
  ('SPFA-130', 'Roofing',    'SPF Roofing: The High-Performance, Weather-Resistant Solution (brochure)', 'SPFA-130-Spray-Polyurethane-Foam-Roofing.pdf', 1130),
  ('SPFA-134', 'Insulation', 'SPF Insulation for Metal Buildings', 'SPFA-134_-022825.pdf', 1134),
  ('SPFA-137', 'General',    'High-Pressure Spray Foam Equipment Guidelines', 'SPFA-137-122321.pdf', 1137),
  ('SPFA-138', 'Roofing',    'Evaluation of Roof Assembly for SPF Roof Systems', 'SPFA-138_011021.pdf', 1138),
  ('SPFA-139', 'Roofing',    'Repair of SPF Roof Systems Due to Hail and Wind-Driven Damage', 'SPFA-139_011021.pdf', 1139),
  ('SPFA-140', 'Insulation', 'SPF Insulation for the Exterior of Foundation Walls', 'SPFA-140_011021.pdf', 1140),
  ('SPFA-141', 'Insulation', 'SPF Insulation for Unvented (Conditioned) Attics and Cathedralized Ceilings', 'SPFA-141_010121.pdf', 1141),
  ('SPFA-142', 'Roofing',    'Securing Roof Components with SPF Adhesives', 'SPFA-142_012725.pdf', 1142),
  ('SPFA-143', 'General',    'Primers for SPF Insulation and Roofing Systems', 'SPFA-143_011021.pdf', 1143),
  ('SPFA-144', 'General',    'Coating Equipment Guidelines', 'SPFA-144_011021.pdf', 1144),
  ('SPFA-145', 'Insulation', 'Surface Texture of SPF', 'SPFA-145_011021.pdf', 1145),
  ('SPFA-146', 'Insulation', 'SPF for Hybrid Insulation Systems, Part 1: Warm Climates', 'SPFA-146_011021.pdf', 1146),
  ('SPFA-147', 'Insulation', 'SPF for Hybrid Insulation Systems, Part 2: Cold Climates', 'SPFA-147_011021.pdf', 1147),
  ('SPFA-150', 'Roofing',    'Photovoltaic (PV) Systems and SPF Roof Systems', 'SPFA-150_011021.pdf', 1150),
  ('SPFA-152', 'Insulation', 'SPF Insulation for the Interior of Basement and Crawlspace Walls', 'SPFA-152-011021.pdf', 1152),
  ('SPFA-153', 'Insulation', 'SPF Insulation Below Concrete Slabs', 'SPFA-153_011021.pdf', 1153),
  ('SPFA-154', 'Insulation', 'A Homeowner''s Guide to SPF Insulation (brochure)', 'SPFA-154-Insulation-Marketing-Brochure.pdf', 1154),
  ('SPFA-155', 'General',    'SPF Low-Pressure Equipment Guidelines', 'SPFA-155-021022.pdf', 1155),
  ('SPFA-157', 'Specialty',  'Polyurethane Foam for Concrete Lifting (Slab Jacking)', 'SPFA-157-Concrete-Lifting-050123.pdf', 1157),
  ('SPFA-158', 'Specialty',  'Polyurethane Foam for Concrete Repair (brochure)', 'SPFA-158-Concrete-Lifting-Brochure.pdf', 1158),
  ('SPFA TT-I4', 'General',  'Tech Tip: SPF and CPVC Piping', 'SPFA-TT-I4-SPF-and-CPVC-Piping-2021.pdf', 1199)
) as v(code, category, title, file, sort)
where not exists (select 1 from public.documents d where d.url = 'https://ambitpu.com/wp-content/uploads/2025/10/' || v.file);
