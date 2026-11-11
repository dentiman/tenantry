/**
 * Брендовий фон на все вікно: розмиті плями кольору бренду і точковий візерунок
 * лише в місцях плям.
 *
 * Рендериться шелом ПЕРШОЮ дитиною `SidebarProvider` і без `z-index`: так він
 * малюється під фіксованим контейнером сайдбара (`z-10`) і під `SidebarInset`
 * (`relative`, пізніше в DOM). Від'ємний `z-index` тут не годиться — фон
 * пішов би під непрозорий `body`.
 *
 * Варіант `auth` — для сторінок входу (`auth-shell.tsx`), див. §7 brand-backdrop.md.
 *
 * Сам по собі нічого не робить із шелом — поверхні стають склом від атрибута
 * `data-backdrop` на обгортці. Стилі й токени — `brand-backdrop.css`.
 */
export function BrandBackdrop({ variant = 'shell' }: { variant?: 'shell' | 'auth' }) {
  // `auth` — сторінки входу (`AuthShell`): ті самі три плями, але зібрані в одну ауру
  // по центру вікна і БЕЗ точок; геометрію й кольори дає модифікатор `--auth` у CSS
  const isAuth = variant === 'auth';

  return (
    <div aria-hidden className={isAuth ? 'brand-backdrop brand-backdrop--auth' : 'brand-backdrop'}>
      <div className="brand-backdrop__glow brand-backdrop__glow--1" />
      <div className="brand-backdrop__glow brand-backdrop__glow--2" />
      <div className="brand-backdrop__glow brand-backdrop__glow--3" />
      {!isAuth && <div className="brand-backdrop__dots" />}
    </div>
  );
}

/**
 * PLAYGROUND (не коміт): градієнтний фон (ауры в CSS) + «ореол» навколо картки входу:
 * розмиті плями з текстурою (зерно, ряб, штрих-кільця), крапки, кола — і зв'язки між
 * ними: плавні криві та «блискавки». Координати у viewBox 1600×900 (центр — картка),
 * `slice` — щоб кола не сплющувались, а ореол ішов за центром вікна.
 */
type P = readonly [number, number];

/** Детермінований ГПСЧ — візерунок однаковий між рендерами. */
function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/** Радіус планети відносно колишньої плями. */
const PLANET_K = 0.6;


/** Блискавка: ламана з поперечним зсувом, `fork` — коротка гілка з середини. */
function bolt(from: P, to: P, seed: number, amp = 14, fork = false): string {
  const rand = rng(seed);
  const n = 8;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const pts: P[] = [from];
  for (let i = 1; i < n; i++) {
    const off = (rand() - 0.5) * 2 * amp;
    pts.push([from[0] + (dx * i) / n + nx * off, from[1] + (dy * i) / n + ny * off]);
  }
  pts.push(to);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}` + pts.slice(1).map((q) => `L${f(q[0])} ${f(q[1])}`).join('');
  if (fork) {
    const m = pts[4];
    d += `M${f(m[0])} ${f(m[1])}L${f(m[0] + nx * 38 + dx * 0.05)} ${f(m[1] + ny * 38 + dy * 0.05)}L${f(m[0] + nx * 52 + dx * 0.1)} ${f(m[1] + ny * 52 + dy * 0.1)}`;
  }
  return d;
}

/** Плавна крива: квадратична, контрольна точка зсунута від середини. */
function curve(from: P, to: P, bend: number): string {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  return `M${from[0]} ${from[1]}Q${f(mx - (dy / len) * bend)} ${f(my + (dx / len) * bend)} ${to[0]} ${to[1]}`;
}

// плями: [x, y, r, opacity, колір]
const BLOBS: readonly [number, number, number, number, string][] = [
  [560, 270, 112, 0.22, 'var(--primary)'],
  [1044, 322, 70, 0.2, 'var(--circuit-accent)'],
  [1030, 596, 104, 0.2, 'var(--primary)'],
  [576, 592, 58, 0.18, 'var(--circuit-yellow)'],
  [900, 224, 84, 0.22, 'var(--primary)'],
];
const RINGS: readonly [number, number, number, number][] = [
  [596, 360, 9, 0.22], [1000, 262, 6, 0.22], [540, 452, 12, 0.18], [986, 520, 8, 0.22],
  [700, 156, 5, 0.2], [800, 705, 7, 0.18], [1130, 430, 14, 0.14], [470, 205, 6, 0.16],
];
const DISCS: readonly [number, number, number, number][] = [
  [592, 440, 5, 0.16], [1008, 400, 4, 0.16], [640, 690, 6, 0.14], [960, 700, 4, 0.16], [790, 205, 3.5, 0.18],
];

// планети й місяці: [x, y, радіус сітки] — звичайна кількість, трохи менші за попередні
const BODIES: readonly (readonly [number, number, number])[] = [
  [560, 270, 52], [1044, 322, 34], [1030, 596, 50], [576, 592, 30], [762, 128, 38],
  [548, 80, 46], [1196, 112, 64], [900, 224, 40],
];

function CircuitLayer() {
  const [a, b, c, d, e] = BLOBS.map((q) => [q[0], q[1]] as P);
  const [r1, r2, r3, r4, r5, r6, r7, r8] = RINGS.map((q) => [q[0], q[1]] as P);
  const [s1, s2, s3, s4, s5] = DISCS.map((q) => [q[0], q[1]] as P);

  // Планети й місяці — «сузір'я»: невеликі крапки на неідеальному колі (радіус «гуляє»),
  // всередині — ще крапки, і всі сусідні з'єднані тонкими лініями, тож виходить сітка, що
  // лише нагадує круг. Колір — свій у кожної, світліший/виразніший зі сторони світла.
  type Dot = { k: string; x: number; y: number; r: number; o: number; c: string; lx: number; ly: number };
  type Mesh = { k: string; dots: Dot[]; lines: { d: string; o: number; c: string }[] };
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const mesh = (key: string, cx: number, cy: number, rad: number, seed: number, inner: number, base: string, second: string, lightDeg: number, ring: boolean): Mesh => {
    const rand = rng(seed);
    const la = (lightDeg * Math.PI) / 180;
    const lx = Math.cos(la);
    const ly = Math.sin(la);
    const litAt = (nx: number, ny: number) => clamp01(nx * lx + ny * ly + 0.55);
    const tone = (lit: number, mixed: boolean, over?: string) => {
      const hue = over ?? (mixed ? second : base);
      return lit > 0.5 ? `color-mix(in oklab, ${hue} ${100 - Math.round((lit - 0.5) * 20)}%, var(--ghost-hi))` : `color-mix(in oklab, ${hue} ${92 - Math.round((0.5 - lit) * 30)}%, var(--ghost-lo))`;
    };
    // точки: край (з коливанням радіуса) + внутрішні з мінімальною відстанню
    const pts: { x: number; y: number; nx: number; ny: number; rim: boolean; lit: number }[] = [];
    // освітленість точки на кулі: нормаль (nx, ny, nz) проти напряму світла + трохи «з-за спини» камери
    const litS = (nx: number, ny: number, nz: number) => clamp01(0.9 * (nx * lx + ny * ly) + 0.5 * nz + 0.04);
    // 1) край: майже ідеальне коло з крапок (як обрис кулі)
    const rimN = Math.max(24, Math.round(rad / 1.5));
    for (let i = 0; i < rimN; i++) {
      const ang = ((i + (rand() - 0.5) * 0.1) / rimN) * Math.PI * 2;
      const k = 1 + (rand() - 0.5) * 0.006;
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      pts.push({ x: cx + nx * rad * k, y: cy + ny * rad * k, nx, ny, rim: true, lit: litS(nx, ny, 0) });
    }
    // 2) поверхня: точки на сфері (спіраль Фібоначчі), видима півкуля, нахил осі ~20°
    const total = Math.round((rad * rad) / 4.5);
    const tilt = 0.35;
    for (let i = 0; i < total; i++) {
      const yy = 1 - (2 * (i + 0.5)) / total;
      const rr = Math.sqrt(1 - yy * yy);
      const th = i * 2.399963 + rand() * 0.08;
      const gx = Math.cos(th) * rr;
      const gz = Math.sin(th) * rr;
      const ny = yy * Math.cos(tilt) - gz * Math.sin(tilt);
      const nz = yy * Math.sin(tilt) + gz * Math.cos(tilt);
      if (nz < 0.05) continue;
      const nx = gx;
      pts.push({ x: cx + nx * rad * 0.97, y: cy + ny * rad * 0.97, nx, ny, rim: false, lit: litS(nx, ny, nz) });
    }
    // точка тим яскравіша й крупніша, чим краще освітлена; темний бік майже зникає
    const dots: Dot[] = pts.map((q, i) => {
      const lit = q.lit;
      const star = rand() < 0.14 && lit > 0.3;
      return {
        k: `${key}d${i}`,
        x: q.x,
        y: q.y,
        r: 0.4 + lit * 0.7 + (star ? 0.4 : 0),
        o: (star ? 0.9 + rand() * 0.1 : 0.2 + lit ** 1.2 * 0.8) * (0.5 + rand() * 0.5),
        c: tone(star ? 0.62 : Math.min(lit, 0.82), rand() < 0.45, undefined),
        lx,
        ly,
      };
    });
    // лінії: край замкнено, кожна точка — до двох найближчих; групуємо за освітленістю
    const seen = new Set<string>();
    const buckets: string[][] = [[], [], []];
    const link = (i: number, j: number) => {
      const id = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (i === j || seen.has(id)) return;
      seen.add(id);
      const m = litAt((pts[i]!.nx + pts[j]!.nx) / 2, (pts[i]!.ny + pts[j]!.ny) / 2);
      buckets[m < 0.4 ? 0 : m < 0.7 ? 1 : 2]!.push(`M${f(pts[i]!.x)} ${f(pts[i]!.y)}L${f(pts[j]!.x)} ${f(pts[j]!.y)}`);
    };
    for (let i = 0; i < rimN; i++) link(i, (i + 1) % rimN);
    pts.forEach((q, i) => {
      pts
        .map((o, j) => [j, Math.hypot(o.x - q.x, o.y - q.y)] as const)
        .filter(([j]) => j !== i)
        .sort((u, v) => u[1] - v[1])
        .slice(0, 3)
        .forEach(([j]) => link(i, j));
    });
    const lines = buckets.map((arr, bi) => ({ d: arr.join(''), o: [0.28, 0.45, 0.7][bi]!, c: tone([0.2, 0.55, 0.9][bi]!, false) })).filter((l) => l.d);
    if (ring) {
      // кільце: розірване коло з крапок, з'єднаних між собою
      const rot = (-18 * Math.PI) / 180;
      const n = 22;
      const rp = Array.from({ length: n }, (_, i) => {
        const t = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.12;
        const k = 1.75 + (rand() - 0.5) * 0.12;
        const ex = Math.cos(t) * rad * k;
        const ey = Math.sin(t) * rad * 0.34 * k;
        return { x: cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: cy + ex * Math.sin(rot) + ey * Math.cos(rot) };
      });
      const d = rp.map((q, i) => (i % 5 === 4 ? '' : `M${f(q.x)} ${f(q.y)}L${f(rp[(i + 1) % n]!.x)} ${f(rp[(i + 1) % n]!.y)}`)).join('');
      lines.push({ d, o: 0.16, c: tone(0.5, true) });
      rp.forEach((q, i) => dots.push({ k: `${key}r${i}`, x: q.x, y: q.y, r: 0.5 + rand() * 0.6, o: 0.2, c: tone(0.5, true), lx, ly }));
    }
    return { k: key, dots, lines };
  };
  // [напрям світла (°; 180 = зліва, 270 = зверху), кільце]
  const LOOKS: readonly (readonly [number, boolean])[] = [
    [222, true],
    [238, false],
    [205, false],
    [256, true],
    [232, false],
  ];
  // кожна планета свого кольору (основний + супутній відтінок, яким забарвлено ~третину крапок)
  const COLORS: readonly (readonly [string, string])[] = [
    ['oklch(0.66 0.2 258)', 'oklch(0.66 0.2 258)'], // синя
    ['oklch(0.7 0.22 28)', 'oklch(0.7 0.22 28)'], // червона
    ['oklch(0.62 0.25 305)', 'oklch(0.62 0.25 305)'], // фіолетова
    ['oklch(0.88 0.18 100)', 'oklch(0.88 0.18 100)'], // жовта
    ['oklch(0.66 0.2 258)', 'oklch(0.66 0.2 258)'], // синя (за логотипом)
    ['oklch(0.74 0.2 145)', 'oklch(0.74 0.2 145)'], // зелена
    ['oklch(0.68 0.23 18)', 'oklch(0.68 0.23 18)'], // червона
    ['oklch(0.88 0.18 100)', 'oklch(0.88 0.18 100)'], // жовта
  ];
  const meshes: Mesh[] = BODIES.map(([bx, by, br], i) => {
    const [light, ring] = LOOKS[i % LOOKS.length]!;
    const [c1, c2] = COLORS[i % COLORS.length]!;
    return mesh(`b${i}`, bx, by, br, 300 + i * 13, Math.round(br * 1.1), c1, c2, light, ring && br > 34);
  });
  const lit = meshes.map((m) => ({ ...m, gain: 1 }));

  // вузли-фігури замість кіл: малі багатокутники (3–6 кутів) із крапок у вершинах
  const shapes = RINGS.map(([x, y, r, o], i) => {
    const n = 3 + (i % 4);
    const rot = i * 0.9;
    const v = Array.from({ length: n }, (_, k) => {
      const t = rot + (k / n) * Math.PI * 2;
      const rr = r * (0.9 + 0.2 * ((i * 7 + k * 3) % 5) / 4);
      return [x + Math.cos(t) * rr, y + Math.sin(t) * rr] as P;
    });
    return { k: `sh${i}`, o, v, d: `M${v.map((q) => `${f(q[0])} ${f(q[1])}`).join('L')}Z` };
  });

  const smooth: [P, P, number, number][] = [
    // основні (тихіші, ніж раніше)
    [a, e, -90, 0.2], [e, b, -70, 0.18], [b, r7, 40, 0.18], [r7, c, 60, 0.18],
    [c, r6, 50, 0.2], [d, r3, -25, 0.18], [a, r1, 18, 0.22], [d, r6, 130, 0.14],
    // додаткові: дрібна «сітка» зв'язків між вузлами
    [a, r8, 30, 0.12], [r8, r3, -60, 0.1], [r1, d, 40, 0.12], [r1, s1, 12, 0.14],
    [r3, s1, -20, 0.1], [e, r5, 22, 0.14], [r5, a, -50, 0.1], [e, r2, 35, 0.1],
    [r2, b, 15, 0.14], [r2, s2, 18, 0.12], [s2, r7, -30, 0.1], [b, r4, 80, 0.1],
    [r7, r4, -40, 0.12], [r4, c, 22, 0.14], [c, s4, -26, 0.12], [s4, r6, 24, 0.1],
    [d, s3, 20, 0.12], [s3, r6, 70, 0.08], [e, s5, 14, 0.12], [s5, b, -60, 0.08],
    [a, b, -170, 0.07], [d, c, 150, 0.06], [r3, r1, 30, 0.1], [r8, e, -110, 0.07],
  ];
  const bolts: [P, P, number, boolean][] = [
    [a, r8, 7, false], [e, r5, 21, true], [b, r2, 33, false], [c, r4, 45, true], [d, r1, 58, false],
    [r7, s2, 71, false], [r6, s4, 84, true], [r3, s1, 97, false],
  ];

  return (
    <svg
      aria-hidden
      className="brand-backdrop__circuit"
      width="100%"
      height="100%"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
    >

      {/* планети й місяці: сітка крапок і ліній, що ледь нагадує круг */}
      <g className="ghosts">
        {lit.map((m) => (
          <g key={m.k}>
            <g className="fill" style={{ stroke: 'none' }}>
              {m.dots.map((g) => (
                <circle key={g.k} cx={f(g.x)} cy={f(g.y)} r={g.r.toFixed(2)} opacity={Math.min(g.o * m.gain, 1).toFixed(2)} style={{ fill: g.c }} />
              ))}
            </g>
          </g>
        ))}
      </g>


      {/* зв'язки: плавні */}
      {smooth.map(([from, to, bend, o], i) => (
        <path key={`s${i}`} d={curve(from, to, bend)} opacity={o} className={i % 3 === 1 ? 'link dashed' : 'link'} />
      ))}
      {/* зв'язки: блискавки (широкий слабкий шар = «світіння» + тонкий яскравий) */}
      {bolts.map(([from, to, seed, fork], i) => {
        const dd = bolt(from, to, seed, 13, fork);
        return (
          <g key={`b${i}`} className="accent">
            <path d={dd} opacity={0.05} className="glow" />
            <path d={dd} opacity={i < 5 ? 0.24 : 0.14} className="link" />
          </g>
        );
      })}

      {/* вузли поверх зв'язків */}
      {shapes.map((sh) => (
        <g key={sh.k} opacity={sh.o * 1.4}>
          <path d={sh.d} className="mesh-line" />
          <g className="fill" style={{ stroke: 'none' }}>
            {sh.v.map((q, i) => (
              <circle key={i} cx={f(q[0])} cy={f(q[1])} r={0.9} />
            ))}
          </g>
        </g>
      ))}
      {DISCS.map(([x, y, r, o], i) => (
        <circle key={`d${i}`} cx={x} cy={y} r={r} opacity={o} className="fill" />
      ))}
    </svg>
  );
}
