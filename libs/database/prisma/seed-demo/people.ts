import { PhoneNumberSchema } from '../../../contracts/src';
import type { Rng } from './util';

type Region = 'west' | 'nordic' | 'east' | 'south' | 'anglo';

const REGION_OF: Record<string, Region> = {
  NL: 'west', DE: 'west', BE: 'west', AT: 'west', CH: 'west', FR: 'west', LU: 'west',
  SE: 'nordic', NO: 'nordic', DK: 'nordic', FI: 'nordic', LV: 'nordic', EE: 'nordic',
  PL: 'east', CZ: 'east', HU: 'east', RO: 'east', BG: 'east', UA: 'east',
  ES: 'south', PT: 'south', IT: 'south', GR: 'south',
  GB: 'anglo', IE: 'anglo', US: 'anglo', CA: 'anglo', AU: 'anglo',
};

// Невеликі пули: у справжній міжнародній базі імена теж повторюються, а читається це природніше
// за комбінаторику з сотень рядків. Пара «ім'я + прізвище» береться з одного регіону
const FIRST: Record<Region, string[]> = {
  west: ['Jan', 'Anke', 'Lukas', 'Sophie', 'Matthias', 'Camille', 'Pieter', 'Elise', 'Florian', 'Marie', 'Daan', 'Lotte'],
  nordic: ['Erik', 'Astrid', 'Mikael', 'Ingrid', 'Henrik', 'Sanna', 'Lars', 'Freja', 'Anders', 'Maja', 'Jonas', 'Elin'],
  east: ['Piotr', 'Katarzyna', 'Tomasz', 'Eszter', 'Marek', 'Ioana', 'Jakub', 'Zsofia', 'Andrei', 'Magda', 'Pavel', 'Irina'],
  south: ['Javier', 'Beatriz', 'Marco', 'Giulia', 'Tiago', 'Ines', 'Luca', 'Elena', 'Nuno', 'Carla', 'Andrea', 'Sofia'],
  anglo: ['James', 'Emily', 'Oliver', 'Hannah', 'Ryan', 'Charlotte', 'Daniel', 'Megan', 'Connor', 'Natalie', 'Liam', 'Grace'],
};
const LAST: Record<Region, string[]> = {
  west: ['de Vries', 'Janssen', 'Schneider', 'Weber', 'Dubois', 'Peeters', 'Fischer', 'Bauer', 'Martin', 'Visser', 'Hoffmann', 'Lambert'],
  nordic: ['Andersson', 'Johansen', 'Nielsen', 'Lindberg', 'Hansen', 'Virtanen', 'Berg', 'Eriksson', 'Larsen', 'Olsen', 'Dahl', 'Strand'],
  east: ['Kowalski', 'Nowak', 'Horvath', 'Popescu', 'Novak', 'Kovacs', 'Dvorak', 'Ionescu', 'Wisniewski', 'Szabo', 'Marek', 'Petrov'],
  south: ['Garcia', 'Silva', 'Rossi', 'Ferreira', 'Romano', 'Santos', 'Esposito', 'Costa', 'Moreno', 'Pereira', 'Conti', 'Alves'],
  anglo: ['Turner', 'Walker', 'Hughes', 'Patel', 'Murphy', 'Cooper', 'Reid', 'Bennett', 'Foster', 'Morgan', 'Hayes', 'Ward'],
};

export function personName(country: string, rng: Rng): { first: string; last: string } {
  const region = REGION_OF[country] ?? 'anglo';
  return { first: rng.pick(FIRST[region]), last: rng.pick(LAST[region]) };
}

/** `Rotterdam Fresh Foods` → `rotterdamfresh.example` (зарезервований TLD `.example`: жоден лист нікуди не піде) */
export function domainOf(companyName: string): string {
  const words = companyName
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  return `${words.slice(0, 2).join('')}.example`;
}

export function slugOfName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

const digits = (rng: Rng, count: number, first?: [number, number]): string => {
  let out = first ? String(rng.int(first[0], first[1])) : '';
  while (out.length < count) out += String(rng.int(0, 9));
  return out;
};

// Шаблони міських номерів: код країни + код міста + абонентська частина. Чинність кожного
// згенерованого номера перевіряє той самий PhoneNumberSchema, що й API; невдалі кидаємо
const PHONE_TEMPLATES: Record<string, (rng: Rng) => string> = {
  NL: (r) => `+31${r.pick(['10', '20', '30', '70'])}${digits(r, 7, [2, 9])}`,
  DE: (r) => `+49${r.pick(['30', '40', '69', '89'])}${digits(r, 8, [2, 9])}`,
  BE: (r) => `+323${digits(r, 7, [2, 9])}`,
  AT: (r) => `+431${digits(r, 7, [2, 9])}`,
  CH: (r) => `+4144${digits(r, 7, [2, 9])}`,
  FR: (r) => `+331${digits(r, 8, [4, 5])}`,
  SE: (r) => `+468${digits(r, 7, [2, 9])}`,
  NO: (r) => `+4722${digits(r, 6, [2, 9])}`,
  DK: (r) => `+4533${digits(r, 6, [2, 9])}`,
  FI: (r) => `+3589${digits(r, 7, [2, 9])}`,
  LV: (r) => `+3716${digits(r, 7, [0, 9])}`,
  EE: (r) => `+3726${digits(r, 6, [0, 9])}`,
  PL: (r) => `+4822${digits(r, 7, [2, 9])}`,
  CZ: (r) => `+4202${digits(r, 8, [0, 9])}`,
  HU: (r) => `+361${digits(r, 7, [2, 9])}`,
  RO: (r) => `+4021${digits(r, 7, [2, 9])}`,
  BG: (r) => `+3592${digits(r, 7, [2, 9])}`,
  ES: (r) => `+3491${digits(r, 7, [2, 9])}`,
  PT: (r) => `+35121${digits(r, 7, [2, 9])}`,
  IT: (r) => `+3902${digits(r, 8, [2, 9])}`,
  GR: (r) => `+30210${digits(r, 7, [2, 9])}`,
  GB: (r) => r.pick([`+44207${digits(r, 7, [0, 9])}`, `+44161${digits(r, 7, [2, 9])}`]),
  IE: (r) => `+3531${digits(r, 7, [2, 9])}`,
  US: (r) => `+1${r.pick(['212', '312', '415', '617', '206', '512', '404'])}${digits(r, 7, [2, 9])}`,
  CA: (r) => `+1${r.pick(['416', '604', '514'])}${digits(r, 7, [2, 9])}`,
  AU: (r) => `+612${digits(r, 8, [5, 9])}`,
};

/** Чинний E.164-номер для країни; `null`, якщо за 40 спроб шаблон не дав чинного (рядок просто без телефону) */
export function phoneFor(country: string, rng: Rng): string | null {
  const template = PHONE_TEMPLATES[country];
  if (!template) return null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = template(rng);
    if (PhoneNumberSchema.safeParse(candidate).success) return candidate;
  }
  return null;
}
