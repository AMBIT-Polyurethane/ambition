-- =====================================================================
-- AMBIT Intelligence update 0059 - Academy in Spanish: eleven more lessons
-- * Spanish versions (with their own graded 5-question quizzes) of Moisture lesson 1 "El punto de rocío"
--   and the ten segment 1-2 lessons: Building science 3 to 8 and Moisture 2 to 5.
-- * Each one is linked to its English lesson (translation_of), so students get the English / Español switch.
-- * They start as drafts; each is switched to Live in Admin > Academy as soon as its Spanish video is uploaded.
-- Needs updates 0054 to 0057 first. Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

do $$
begin
  if to_regclass('public.academy_lessons') is null then
    raise exception 'Run update 0054 (Academy lessons) first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'academy_lessons' and column_name = 'translation_of') then
    raise exception 'Run update 0056 (Academy in Spanish) first.';
  end if;
end $$;

-- ---------- Moisture lesson 1 in Spanish: El punto de rocío ----------
do $$
declare
  en uuid := 'acade003-0000-4000-8000-000000000003';
  es uuid := 'acade003-e500-4000-8000-000000000003';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'El punto de rocío',
    'Qué es la humedad relativa y el punto de rocío, cómo leer el punto de rocío en la carta psicrométrica en tres movimientos, y por qué la celda abierta bajo un techo frío necesita un retardador de vapor en las zonas 5 a 8.',
    l.minutes, '¿Cuándo fue la última vez que un cliente culpó a la espuma en aerosol por la humedad alta, y cuál era el punto de rocío ese día?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'El punto de rocío es:',
      array['La temperatura de afuera en la noche', 'La temperatura a la que el aire está 100% lleno de vapor de agua, así que si se enfría más, el agua se condensa', 'La humedad relativa al mediodía', 'La temperatura del suelo'], 1,
      'La humedad relativa es qué tan lleno está el aire; en el punto de rocío está completamente lleno.'),
    (es, 2, 'En una carta psicrométrica ya encontraste la temperatura de bulbo seco y la curva de humedad relativa. Para leer el punto de rocío te mueves:',
      array['Derecho hacia arriba', 'Derecho a la derecha', 'Derecho a la izquierda hasta la curva del 100%', 'Derecho hacia abajo'], 2,
      'La curva del 100% es la escala del punto de rocío, así que derecho a la izquierda desde tu punto te da el punto de rocío.'),
    (es, 3, 'Hace 85°F con 65% de humedad relativa, y el punto de rocío es de unos 72°F. ¿Qué superficie se va a mojar?',
      array['Una pared a 80°F', 'Una línea del aire acondicionado a 60°F', 'Una cubierta de techo a 140°F', 'Una ventana a 75°F'], 1,
      'Solo una superficie más fría que el punto de rocío junta condensación, y 60°F está por debajo de 72°F.'),
    (es, 4, 'Adentro hay 70°F con 40% de humedad relativa (punto de rocío de unos 45°F). El techo de metal está a 10°F, con celda abierta por debajo y sin retardador de vapor. ¿Qué pasa?',
      array['El vapor atraviesa la espuma y se condensa en el metal frío', 'Nada, porque la espuma detiene el vapor', 'El metal se calienta a más de 45°F', 'Solo pasa en verano'], 0,
      'La celda abierta no es retardador de vapor, así que el vapor llega al metal, que está muy por debajo del punto de rocío.'),
    (es, 5, 'En las zonas climáticas 5 a 8, el IRC dice que el aislamiento impermeable al aire en un ático sin ventilación tiene que:',
      array['Tener por lo menos 6 pulgadas de espesor', 'Estar cubierto con tablaroca', 'Ser un retardador de vapor Clase II, o tener encima un recubrimiento retardador de vapor Clase II', 'Ser solo de celda cerrada'], 2,
      'IRC R806.5. La celda abierta lo cumple con un recubrimiento retardador de vapor Clase II.');
  end if;
end $$;

-- ---------- Building science lesson 3 in Spanish: Valor R y ASTM C518 ----------
do $$
declare
  en uuid := 'acade103-0000-4000-8000-000000000103';
  es uuid := 'acade103-e500-4000-8000-000000000103';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Valor R y ASTM C518',
    'Qué mide el valor R, cómo lo mide la prueba ASTM C518 y por qué la temperatura, la humedad y la edad lo cambian.',
    l.minutes, '¿Has visto un aislamiento que no rindió como decía su etiqueta? ¿Qué crees que estaba pasando?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'El valor R mide:',
      array['Qué tan hermético es un material', 'Cuánta humedad bloquea un material', 'La resistencia al flujo de calor por conducción', 'Cuánto calor guarda un material'], 2,
      'El valor R es la resistencia al flujo de calor por conducción. Las fugas de aire y la humedad son otras propiedades.'),
    (es, 2, 'Dos pulgadas de un material de R-3.5 por pulgada dan más o menos:',
      array['R-3.5', 'R-7', 'R-12.25', 'R-1.75'], 1,
      'Los valores R se suman: 2 pulgadas × R-3.5 por pulgada = R-7.'),
    (es, 3, 'La ASTM C518 mide el valor R:',
      array['Poniendo la muestra entre una placa caliente y una fría y midiendo el calor que pasa', 'Soplando aire a través de la muestra', 'Remojando la muestra en agua', 'Quemando la muestra'], 0,
      'La C518 es la prueba con medidor de flujo de calor: placa caliente, placa fría y sensores que miden el calor que pasa.'),
    (es, 4, 'La espuma de celda cerrada se vende con un valor R "envejecido" porque:',
      array['Se hace más gruesa con el tiempo', 'Absorbe calor al envejecer', 'El código exige probar todos los productos después de diez años', 'El agente espumante de sus celdas poco a poco cambia de lugar con el aire, así que el valor R baja un poco y luego se estabiliza'], 3,
      'El agente espumante sale poco a poco y entra aire, así que el valor R se asienta en un valor envejecido más bajo y estable.'),
    (es, 5, '¿Qué NO toma en cuenta el valor R?',
      array['El espesor del material', 'El aire que se cuela a través y alrededor del aislamiento', 'La conducción a través del material', 'El tipo de material'], 1,
      'El valor R describe solo la conducción. Las fugas de aire y la estructura son la razón por la que las paredes reales no dan lo de la etiqueta.');
  end if;
end $$;

-- ---------- Building science lesson 4 in Spanish: Valor R ponderado y diseño del ensamble ----------
do $$
declare
  en uuid := 'acade104-0000-4000-8000-000000000104';
  es uuid := 'acade104-e500-4000-8000-000000000104';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Valor R ponderado y diseño del ensamble',
    'Cómo se suman las capas en serie, cómo la estructura crea un camino en paralelo y cómo sacar el valor R real de una pared completa.',
    l.minutes, 'Piensa en una pared que aislaste hace poco. ¿Qué estaba puenteando el aislamiento, y cómo se pudo diseñar mejor el ensamble?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'El calor que pasa derecho por las capas de una pared (tablaroca, aislamiento, revestimiento) encuentra resistencias que:',
      array['Se suman', 'Se multiplican', 'Se promedian', 'Solo cuenta la más grande'], 0,
      'Las capas en serie suman sus valores R.'),
    (es, 2, '¿Por qué una pared con colchonetas de R-13 da menos de R-13 en total?',
      array['La tablaroca anula parte de la colchoneta', 'Las colchonetas pierden la mitad de su valor R dentro de una pared', 'La estructura de madera conduce el calor más fácil que el aislamiento y crea caminos alrededor de él', 'Las películas de aire restan valor R'], 2,
      'Los montantes, las soleras y los cabezales son un puente térmico: un atajo para que el calor le dé la vuelta al aislamiento.'),
    (es, 3, 'Para combinar el camino por la cavidad y el camino por el montante:',
      array['Se promedian los valores R', 'Se promedian los factores U según el área, y luego se saca uno entre el resultado', 'Se suman los valores R', 'Se usa el valor R más alto'], 1,
      'Los caminos están en paralelo, así que se promedian los factores U por área y se voltea otra vez a R.'),
    (es, 4, 'En una pared típica de madera con 2x4, la estructura cubre más o menos:',
      array['El 5% de la pared', 'El 25% de la pared', 'El 50% de la pared', 'El 75% de la pared'], 1,
      'Más o menos una cuarta parte de una pared típica de madera es estructura.'),
    (es, 5, 'Una pulgada de aislamiento continuo de R-5 por fuera de los montantes:',
      array['Solo ayuda al camino por la cavidad', 'Baja el valor R de la pared', 'No hace nada en una pared con estructura', 'Suma su valor R tanto al camino por la cavidad como al camino por el montante'], 3,
      'Como pasa por encima de los montantes, se suma a los dos caminos, así que la pared completa gana casi R-6.');
  end if;
end $$;

-- ---------- Building science lesson 5 in Spanish: Infiltración y exfiltración ----------
do $$
declare
  en uuid := 'acade105-0000-4000-8000-000000000105';
  es uuid := 'acade105-e500-4000-8000-000000000105';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Infiltración y exfiltración',
    'Qué son la infiltración y la exfiltración, qué empuja el aire a través de un edificio, qué carga ese aire y cómo lo mide una blower door.',
    l.minutes, '¿Cuál es la fuga más grande que has encontrado en una casa, y cómo la sellaste?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'La exfiltración es:',
      array['El aire de afuera que se mete', 'El aire que mueve un ventilador de ventilación', 'El aire de adentro que se sale', 'El calor que pasa por una pared'], 2,
      'La exfiltración es el aire de adentro que se sale; la infiltración es el aire de afuera que se mete.'),
    (es, 2, 'El aire se fuga por un hueco del edificio solo cuando:',
      array['Hay una diferencia de presión entre los dos lados del hueco', 'El aislamiento está mojado', 'Hace más frío afuera', 'El sistema de aire está apagado'], 0,
      'Sin diferencia de presión, no hay flujo de aire. El viento, el efecto chimenea y los ventiladores la crean.'),
    (es, 3, '¿Cuál de estas cosas NO causa fugas de aire?',
      array['El viento', 'El efecto chimenea', 'Los extractores y las secadoras', 'El valor R del aislamiento'], 3,
      'El valor R tiene que ver con la conducción. Lo que causa las fugas es el viento, el efecto chimenea y los sistemas mecánicos.'),
    (es, 4, 'Las colchonetas de fibra de vidrio en la cavidad de una pared:',
      array['Detienen todas las fugas de aire', 'Hacen más lenta la conducción, pero el aire las atraviesa', 'Son un retardador de vapor Clase I', 'Dejan la pared hermética si se comprimen'], 1,
      'El aislamiento de fibra no es una barrera de aire. Para sellar el aire se necesita una barrera de aire continua.'),
    (es, 5, 'Según el IRC, una casa nueva en la zona climática 3 tiene que salir en la prueba con:',
      array['3 ACH50 o menos', '5 ACH50 o menos', '7 ACH50 o menos', '10 ACH50 o menos'], 0,
      'El límite del IRC es 3 ACH50 en las zonas climáticas 3 a 8, y 5 ACH50 en las zonas más calientes.');
  end if;
end $$;

-- ---------- Building science lesson 6 in Spanish: Efecto chimenea y plano de presión neutra ----------
do $$
declare
  en uuid := 'acade106-0000-4000-8000-000000000106';
  es uuid := 'acade106-e500-4000-8000-000000000106';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Efecto chimenea y plano de presión neutra',
    'Cómo el aire caliente que sube causa fugas de aire, dónde queda el plano de presión neutra y por qué se mueve, y qué fugas sellar primero.',
    l.minutes, '¿Dónde has visto el efecto chimenea en una obra: escarcha en el ático, manchas, o un segundo piso muy caliente?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'En invierno, el efecto chimenea empuja el aire:',
      array['Hacia afuera cerca de la parte de arriba de la casa y hacia adentro cerca de la parte de abajo', 'Hacia adentro arriba y hacia afuera abajo', 'Solo por las ventanas', 'Solo cuando sopla el viento'], 0,
      'El aire caliente sube, empuja hacia afuera por arriba y jala aire frío por abajo.'),
    (es, 2, 'El plano de presión neutra es:',
      array['El piso del ático', 'El nivel del suelo de la casa', 'La altura donde la presión del aire de adentro y la de afuera son iguales', 'Donde está el termostato'], 2,
      'Arriba de él, la casa empuja hacia afuera; abajo de él, la casa jala hacia adentro.'),
    (es, 3, 'El efecto chimenea se hace más fuerte cuando:',
      array['El aislamiento es más grueso', 'El edificio es más alto o la diferencia de temperatura es mayor', 'La casa está pintada de un color más oscuro', 'Llueve'], 1,
      'La presión del efecto chimenea crece con la altura arriba o abajo del plano neutro y con la diferencia de temperatura.'),
    (es, 4, 'Si casi todas las fugas de una casa están arriba, en el piso del ático, el plano de presión neutra:',
      array['Baja', 'Se queda exactamente a la mitad', 'Desaparece', 'Sube hacia las fugas'], 3,
      'El plano neutro se mueve hacia las fugas más grandes, así que más parte de la casa jala aire de afuera.'),
    (es, 5, 'En verano, con el aire acondicionado funcionando, el efecto chimenea:',
      array['Se hace mucho más fuerte que en invierno', 'Se detiene por completo', 'Se invierte: el aire fresco se sale por abajo y el aire caliente se mete por arriba', 'Solo afecta el sótano'], 2,
      'Se invierte, y es más débil porque la diferencia de temperatura es más chica.');
  end if;
end $$;

-- ---------- Building science lesson 7 in Spanish: Zonas climáticas (térmicas y de humedad) ----------
do $$
declare
  en uuid := 'acade107-0000-4000-8000-000000000107';
  es uuid := 'acade107-e500-4000-8000-000000000107';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Zonas climáticas (térmicas y de humedad)',
    'Cómo funcionan los números y las letras de las zonas climáticas, qué controla la zona en el código y dónde buscar la tuya.',
    l.minutes, '¿En qué zona climática trabajas más, y qué cambia en tus recomendaciones cuando pasas a la siguiente?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'El número de una zona climática te dice sobre todo:',
      array['Qué tan caliente o frío es el clima', 'Cuánto llueve', 'La edición del código local', 'El tipo de suelo'], 0,
      'Los números van de caliente a frío, según la calefacción y el enfriamiento que se necesitan cada año.'),
    (es, 2, 'La letra después del número (A, B o C) significa:',
      array['Altitud, tipo de edificio, costa', 'Ático, sótano, espacio bajo el piso', 'Aire, barrera, techo', 'Húmeda, seca, marina'], 3,
      'La A es húmeda, la B es seca y la C es marina.'),
    (es, 3, 'Oklahoma City está en la zona climática:',
      array['1A', '3A', '5B', '7'], 1,
      'El condado de Oklahoma es zona 3A.'),
    (es, 4, 'Según el IRC, las paredes con estructura necesitan un retardador de vapor Clase I o II por dentro en:',
      array['Las zonas 1 a 3', 'Las zonas 5 a 8 y Marina 4', 'Todas las zonas', 'Solo la zona 8'], 1,
      'IRC R702.7: zonas 5, 6, 7, 8 y Marina 4, a menos que la pared cumpla una de las alternativas del código.'),
    (es, 5, '¿Dónde buscas la zona climática de un condado?',
      array['IRC Tabla N1101.7 (IECC Tabla R301.1)', 'La placa de datos del aire acondicionado', 'ASTM C518', 'La hoja técnica de la espuma'], 0,
      'La Tabla N1101.7 del IRC y la Tabla R301.1 del IECC tienen la zona de cada condado.');
  end if;
end $$;

-- ---------- Building science lesson 8 in Spanish: Carga latente y carga sensible ----------
do $$
declare
  en uuid := 'acade108-0000-4000-8000-000000000108';
  es uuid := 'acade108-e500-4000-8000-000000000108';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Carga latente y carga sensible',
    'La diferencia entre carga sensible y carga latente, por qué las casas con espuma pueden sentirse pegajosas y cómo hacer que el sistema de aire corresponda a la casa.',
    l.minutes, '¿Te han llamado por humedad después de un trabajo de espuma? ¿De qué tamaño era el aire acondicionado, y qué lo arregló?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'El calor sensible es el calor que:',
      array['Está escondido en el vapor de agua', 'Solo viene de las personas', 'Cambia la temperatura del aire y se ve en un termómetro', 'Un aire acondicionado no puede quitar'], 2,
      'El calor sensible cambia la temperatura. El calor latente es la energía que hay en el vapor de agua.'),
    (es, 2, 'El calor latente es:',
      array['El calor del sol', 'El calor que está en el vapor de agua; quitarlo seca el aire sin cambiar su temperatura', 'El calor que pasa por las paredes', 'El calor de las luces'], 1,
      'Quitar calor latente quiere decir condensar el agua que hay en el aire.'),
    (es, 3, 'Condensar una libra de agua del aire quita más o menos:',
      array['1 BTU', '100 BTU', '1,060 BTU', '10,000 BTU'], 2,
      'El calor latente del agua es un poco más de 1,000 BTU por libra.'),
    (es, 4, 'Después de ponerle espuma a una casa, el aire acondicionado hace ciclos cortos y la humedad sube. La razón más probable es:',
      array['La espuma está soltando humedad', 'El termostato está descompuesto', 'La carga latente desapareció', 'La carga sensible bajó, así que el aire llega al termostato antes de sacar suficiente agua'], 3,
      'La espuma baja la carga sensible; la latente se queda, así que un aire acondicionado sobrado trabaja muy poco tiempo para deshumidificar.'),
    (es, 5, '¿Qué se usa para calcular el equipo de enfriamiento según las cargas de la casa?',
      array['ASTM C518', 'IRC R806.5', 'Manual J y Manual S de ACCA', 'ASTM E96'], 2,
      'El Manual J calcula las cargas; el Manual S escoge el equipo que les corresponde.');
  end if;
end $$;

-- ---------- Moisture lesson 2 in Spanish: Barreras de aire, de humedad y de vapor ----------
do $$
declare
  en uuid := 'acade202-0000-4000-8000-000000000202';
  es uuid := 'acade202-e500-4000-8000-000000000202';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Barreras de aire, de humedad y de vapor',
    'Qué hace cada una: la barrera resistente al agua, la barrera de aire y el retardador de vapor; las tres clases de retardador de vapor; y qué trabajos hacen la espuma de celda abierta y la de celda cerrada.',
    l.minutes, '¿Dónde has visto fallar una pared porque se usó la barrera equivocada, o porque faltaba una?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'La envoltura de casa detrás del recubrimiento exterior es sobre todo:',
      array['Una barrera resistente al agua que desvía el agua líquida pero deja pasar el vapor', 'Un retardador de vapor Clase I', 'Aislamiento térmico', 'Una barrera radiante'], 0,
      'Una barrera resistente al agua detiene la lluvia, pero casi siempre deja pasar el vapor para que la pared se pueda secar.'),
    (es, 2, 'Para funcionar, una barrera de aire tiene que ser:',
      array['De por lo menos 6 milésimas de espesor', 'Pintada', 'Instalada solo en el ático', 'Continua alrededor de todo el edificio, sellada en cada unión y cada hueco'], 3,
      'Con un solo hueco sin sellar, el aire lo encuentra.'),
    (es, 3, 'Según el IRC, un retardador de vapor Clase II es de:',
      array['0.1 perm o menos', 'Más de 0.1 hasta 1.0 perm', 'Más de 1 hasta 10 perms', 'Más de 10 perms'], 1,
      'Clase I ≤ 0.1, Clase II > 0.1 a 1.0, Clase III > 1.0 a 10 perms.'),
    (es, 4, 'Las colchonetas con cara de papel kraft son un ejemplo de:',
      array['Retardador de vapor Clase I', 'Retardador de vapor Clase II', 'Retardador de vapor Clase III', 'Barrera resistente al agua'], 1,
      'El IRC pone las colchonetas de fibra de vidrio con cara de papel kraft como Clase II.'),
    (es, 5, 'La espuma de celda abierta con su espesor completo es:',
      array['Barrera de aire y retardador de vapor Clase I', 'Barrera de aire, pero el vapor pasa a través de ella', 'Ni barrera de aire ni retardador de vapor', 'Una barrera resistente al agua'], 1,
      'La celda abierta detiene el aire pero deja pasar el vapor; la celda cerrada a unas 2 pulgadas casi siempre llega a Clase II.');
  end if;
end $$;

-- ---------- Moisture lesson 3 in Spanish: Difusión y ASTM E96 ----------
do $$
declare
  en uuid := 'acade203-0000-4000-8000-000000000203';
  es uuid := 'acade203-e500-4000-8000-000000000203';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Difusión y ASTM E96',
    'Cómo se difunde el vapor a través de los materiales, qué mide un perm, cómo funciona la prueba de la taza ASTM E96 y por qué importa el espesor.',
    l.minutes, 'Escoge una espuma que aplicas: ¿cuántos perms tiene con tu espesor de siempre, y qué clase de retardador de vapor la hace eso?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'La difusión de vapor mueve el vapor de agua:',
      array['A través de materiales sólidos, de presión de vapor más alta a más baja', 'Solo por huecos y grietas', 'Solo hacia arriba', 'Solo cuando llueve'], 0,
      'La difusión pasa derecho a través de los materiales, de donde hay más vapor a donde hay menos.'),
    (es, 2, 'Que un material tenga menos perms quiere decir que:',
      array['Deja pasar más vapor', 'Tiene más valor R', 'Bloquea mejor el vapor', 'Es mejor barrera de aire'], 2,
      'Menos perms, más cerrado al vapor.'),
    (es, 3, 'La ASTM E96 mide los perms:',
      array['Calentando un lado de la muestra', 'Sellando una muestra sobre una taza y pesando cuánto vapor pasa con el tiempo', 'Presurizando una casa', 'Remojando la muestra en agua'], 1,
      'La taza tiene un desecante (taza seca) o agua (taza húmeda); el cambio de peso muestra el vapor que pasó.'),
    (es, 4, 'Si duplicas el espesor de un material uniforme, sus perms:',
      array['Se duplican', 'Se quedan igual', 'Bajan a cero', 'Bajan más o menos a la mitad'], 3,
      'La permeancia es inversamente proporcional al espesor.'),
    (es, 5, '¿En qué método de la ASTM E96 se basan las clases de retardador de vapor del IRC?',
      array['Cualquiera de los dos', 'El de taza húmeda (agua)', 'El de taza seca (desecante)', 'Ninguno; usan la ASTM C518'], 2,
      'Las clases se basan en el método de taza seca.');
  end if;
end $$;

-- ---------- Moisture lesson 4 in Spanish: Empuje del vapor y condensación (clima frío) ----------
do $$
declare
  en uuid := 'acade204-0000-4000-8000-000000000204';
  es uuid := 'acade204-e500-4000-8000-000000000204';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Empuje del vapor y condensación (clima frío)',
    'Por qué el vapor empuja hacia afuera en invierno, dónde se condensa en paredes y techos, y las tres formas de evitarlo.',
    l.minutes, 'En tu zona, ¿cuál es la superficie más fría de una pared típica en enero, y qué la mantiene sin humedad?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'En el invierno de un clima frío, el vapor empuja:',
      array['De adentro hacia afuera', 'De afuera hacia adentro', 'Solo hacia abajo', 'A ningún lado; el aire frío no tiene vapor'], 0,
      'El aire caliente de adentro tiene más vapor, así que la presión de vapor es más alta adentro.'),
    (es, 2, 'El aire de adentro a 70°F y 35% de humedad relativa tiene un punto de rocío de más o menos:',
      array['20°F', '41°F', '55°F', '70°F'], 1,
      '70°F con 35% HR tiene un punto de rocío de unos 41°F.'),
    (es, 3, 'En una pared de clima frío, la condensación casi siempre se forma primero en:',
      array['La parte de atrás de la tablaroca', 'El recubrimiento exterior', 'La cara del aislamiento', 'La parte de atrás del revestimiento exterior'], 3,
      'Es la primera superficie que encuentra el vapor que está por debajo del punto de rocío de adentro.'),
    (es, 4, 'Casi toda la humedad que llega a la cavidad fría de una pared llega por:',
      array['Difusión a través de la tablaroca', 'Fugas de aire', 'La lluvia', 'El aire acondicionado'], 1,
      'Las fugas de aire cargan mucha más humedad que la difusión, así que primero sella el aire.'),
    (es, 5, 'La espuma de celda cerrada aplicada contra el revestimiento ayuda porque:',
      array['Mantiene más caliente el revestimiento y frena el vapor', 'Hace que la pared deje pasar el vapor', 'Le agrega humedad a la pared', 'Solo funciona en verano'], 0,
      'Calienta la superficie donde se condensaría y funciona como retardador de vapor.');
  end if;
end $$;

-- ---------- Moisture lesson 5 in Spanish: Empuje del vapor y condensación (clima caliente) ----------
do $$
declare
  en uuid := 'acade205-0000-4000-8000-000000000205';
  es uuid := 'acade205-e500-4000-8000-000000000205';
begin
  if not exists (select 1 from public.academy_lessons where id = en) then return; end if;

  insert into public.academy_lessons (id, course_id, number, title, summary, minutes, discussion, lang, translation_of, pass_pct)
  select es, l.course_id, l.number, 'Empuje del vapor y condensación (clima caliente)',
    'Por qué el vapor empuja hacia adentro en clima caliente y húmedo, dónde se forma la condensación de verano y cómo la evitan la espuma y las decisiones del sistema de aire.',
    l.minutes, '¿Has visto ductos sudando, o moho detrás del papel tapiz de vinil? ¿Qué lo arregló?', 'es', en, l.pass_pct
  from public.academy_lessons l where l.id = en
  on conflict (id) do nothing;

  if not exists (select 1 from public.academy_questions where lesson_id = es) then
    insert into public.academy_questions (lesson_id, sort, prompt, choices, answer, explain) values
    (es, 1, 'En un verano caliente y húmedo, con el aire acondicionado funcionando, el vapor empuja:',
      array['De adentro hacia afuera', 'Solo hacia arriba', 'De afuera hacia adentro', 'A ningún lado'], 2,
      'El aire caliente y húmedo de afuera tiene más vapor que el aire fresco de adentro.'),
    (es, 2, 'El aire de afuera a 90°F y 60% de humedad relativa tiene un punto de rocío de más o menos:',
      array['55°F', '60°F', '74°F', '90°F'], 2,
      '90°F con 60% HR tiene un punto de rocío de unos 74°F.'),
    (es, 3, '¿Por qué el papel tapiz de vinil en una pared exterior con aire acondicionado es un problema en climas calientes y húmedos?',
      array['Le agrega valor R', 'Atrapa el vapor que viene hacia adentro contra la pared fría, donde se puede condensar y crecer moho', 'Hace que la pared se seque demasiado rápido', 'Hace que el aire acondicionado deje de funcionar'], 1,
      'Una capa de pocos perms por dentro atrapa el vapor del lado frío.'),
    (es, 4, 'Un ducto que lleva aire a 55°F por un ático ventilado lleno de aire con punto de rocío de 74°F va a:',
      array['Quedarse seco', 'Congelarse', 'Calentar el ático', 'Sudar'], 3,
      'Cualquier superficie por debajo del punto de rocío junta condensación.'),
    (es, 5, 'Según el IRC, los retardadores de vapor por dentro de las paredes con estructura se piden en:',
      array['Todas las zonas climáticas', 'Las zonas 1 a 3', 'Solo las zonas 5 a 8 y Marina 4', 'Solo las zonas cálidas y húmedas'], 2,
      'Solo se piden en las zonas frías; en las zonas cálidas y húmedas hay que evitarlos.');
  end if;
end $$;

select 'Update 0059 done: eleven Spanish Academy lessons added as drafts with their quizzes (switch each to Live once its video is up).' as status;
