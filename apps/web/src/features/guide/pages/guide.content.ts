import type { LucideIcon } from 'lucide-react';
import type guideEn from '../../../locales/en/guide.json';
import {
  Activity,
  Bell,
  BellRing,
  Bot,
  Boxes,
  Briefcase,
  Building2,
  CalendarDays,
  CircleAlert,
  Command,
  Compass,
  Container,
  CreditCard,
  Database,
  FileStack,
  Fingerprint,
  FlaskConical,
  GitBranch,
  Globe,
  HardDrive,
  Hash,
  History,
  KeyRound,
  Languages,
  Layers,
  LayoutPanelLeft,
  ListChecks,
  ListTodo,
  LockKeyhole,
  Mail,
  MessagesSquare,
  MonitorSmartphone,
  Network,
  Palette,
  PanelRight,
  Radio,
  Rocket,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareStack,
  Table2,
  TextCursorInput,
  Ticket,
  UserCog,
  UserRound,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';

/**
 * Структура путівника (area «Guide», `/guide`): параграфи, групи модулів,
 * модулі, підсистеми — з іконками, статусами й аудиторією. Тексту тут немає:
 * він у namespace `guide` (`locales/en/guide.json`), ключі будуються від `id`
 * (`modules.items.<id>.title`, `subsystems.<id>.business`). Тому `id` — не
 * косметика: перейменування ламає ключ перекладу, а для параграфа ще й якір.
 *
 * Статуси взяті з `docs/roadmap.md` і планів фаз, не з пам'яті — при зміні
 * роадмапу оновлювати тут.
 */

/**
 * Параграфи путівника — одна довга сторінка, а не роут на параграф. Той самий
 * список малює друга колонка шела (`areas/guide-sidebar.tsx`): пункт підсвічується
 * прокруткою і прокручує до параграфа кліком. `id` — це і `id` секції в DOM, і
 * ключ `sections.<id>` у перекладах.
 */
export const GUIDE_SECTIONS = [
  { id: 'overview', icon: Compass },
  { id: 'modules', icon: Boxes },
  { id: 'delivery', icon: Rocket },
  { id: 'architecture', icon: Network },
  { id: 'subsystems', icon: Layers },
] as const satisfies readonly { id: string; icon: LucideIcon }[];

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]['id'];

export const MODULE_STATUSES = ['done', 'partial', 'designed', 'planned'] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

/** Хто бачить модуль в інтерфейсі; без позначки — будь-який користувач тенанта. */
export type ModuleAudience = 'admin' | 'operator' | 'developer';

/**
 * Id виводяться з САМОГО словника: модуль без перекладу — помилка компіляції, а
 * не порожня картка з ключем замість тексту.
 */
export type ModuleId = keyof (typeof guideEn)['modules']['items'];
export type ModuleGroupId = keyof (typeof guideEn)['modules']['groups'];
export type SubsystemId = keyof (typeof guideEn)['subsystems']['items'];

export interface ProductModule {
  /** Ключ `modules.items.<id>` у перекладах */
  id: ModuleId;
  icon: LucideIcon;
  status: ModuleStatus;
  audience?: ModuleAudience;
}

export interface ModuleGroup {
  /** Ключ `modules.groups.<id>` у перекладах */
  id: ModuleGroupId;
  icon: LucideIcon;
  modules: ProductModule[];
}

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: 'workspace',
    icon: Briefcase,
    modules: [
      { id: 'customers', icon: Building2, status: 'done' },
      { id: 'calendar', icon: CalendarDays, status: 'done' },
      { id: 'users', icon: Users, status: 'done', audience: 'admin' },
      { id: 'tickets', icon: Ticket, status: 'planned' },
      { id: 'billing', icon: CreditCard, status: 'planned' },
      { id: 'bulkOperations', icon: ListChecks, status: 'designed' },
    ],
  },
  {
    id: 'communication',
    icon: MessagesSquare,
    modules: [
      { id: 'chat', icon: MessagesSquare, status: 'partial' },
      { id: 'notifications', icon: Bell, status: 'done' },
      { id: 'reminders', icon: BellRing, status: 'done' },
      { id: 'activityFeed', icon: History, status: 'done' },
      { id: 'presence', icon: Radio, status: 'done' },
      { id: 'email', icon: Mail, status: 'done' },
    ],
  },
  {
    id: 'ai',
    icon: Sparkles,
    modules: [
      { id: 'assistant', icon: Bot, status: 'partial' },
      { id: 'aiProviders', icon: Workflow, status: 'designed' },
    ],
  },
  {
    id: 'access',
    icon: ShieldCheck,
    modules: [
      { id: 'signIn', icon: KeyRound, status: 'done' },
      { id: 'devices', icon: MonitorSmartphone, status: 'done' },
      { id: 'accessRecovery', icon: LockKeyhole, status: 'done' },
      { id: 'abuseProtection', icon: ShieldCheck, status: 'done' },
      { id: 'roles', icon: UserCog, status: 'partial' },
      { id: 'twoFactor', icon: Fingerprint, status: 'designed' },
    ],
  },
  {
    id: 'settings',
    icon: Settings,
    modules: [
      { id: 'orgSettings', icon: Building2, status: 'done', audience: 'admin' },
      { id: 'personalSettings', icon: UserRound, status: 'done' },
      { id: 'languages', icon: Languages, status: 'partial' },
    ],
  },
  {
    id: 'platform',
    icon: Server,
    modules: [
      { id: 'tenants', icon: Building2, status: 'done', audience: 'operator' },
      { id: 'backgroundJobs', icon: ListTodo, status: 'done', audience: 'operator' },
      { id: 'operatorSignIn', icon: KeyRound, status: 'done', audience: 'operator' },
      { id: 'failureTriage', icon: CircleAlert, status: 'designed', audience: 'operator' },
      { id: 'subdomains', icon: Globe, status: 'designed', audience: 'operator' },
    ],
  },
  {
    id: 'services',
    icon: Layers,
    modules: [
      { id: 'files', icon: FileStack, status: 'done' },
      { id: 'events', icon: Workflow, status: 'done' },
      { id: 'numbering', icon: Hash, status: 'done' },
      { id: 'liveUpdates', icon: Activity, status: 'done' },
      { id: 'errorHandling', icon: CircleAlert, status: 'done' },
      { id: 'commandPalette', icon: Command, status: 'planned' },
    ],
  },
  {
    id: 'interface',
    icon: LayoutPanelLeft,
    modules: [
      { id: 'shell', icon: LayoutPanelLeft, status: 'done' },
      { id: 'tables', icon: Table2, status: 'done' },
      { id: 'forms', icon: TextCursorInput, status: 'done' },
      { id: 'contextPanel', icon: PanelRight, status: 'done' },
      { id: 'themes', icon: Palette, status: 'done' },
      { id: 'playground', icon: FlaskConical, status: 'done', audience: 'developer' },
    ],
  },
];

/** Параграф «Розробка й деплой» — ті самі картки модулів, але окремим блоком. */
export const DELIVERY_MODULES: ProductModule[] = [
  { id: 'workspaceSlots', icon: SquareStack, status: 'done', audience: 'developer' },
  { id: 'deploy', icon: Rocket, status: 'done', audience: 'developer' },
  { id: 'changePlanning', icon: GitBranch, status: 'done', audience: 'developer' },
  { id: 'observability', icon: Activity, status: 'planned', audience: 'developer' },
];

/**
 * Картки підсистем перенесено з `public/diagrams/architecture.html` (блок `cards`
 * під схемою Archify). Два останні блоки звідти — «Delivered features» і
 * «Roadmap» — не перенесено: їх повністю покриває карта модулів зі статусами.
 * Картку Auth оновлено під AUTH-2/AUTH-3 (refresh у httpOnly cookie, відновлення
 * пароля), бо в схемі вона відстала від роадмапу.
 */
export const SUBSYSTEMS: { id: SubsystemId; icon: LucideIcon }[] = [
  { id: 'multitenancy', icon: Building2 },
  { id: 'messaging', icon: Workflow },
  { id: 'realtime', icon: Zap },
  { id: 'auth', icon: KeyRound },
  { id: 'files', icon: HardDrive },
  { id: 'valkey', icon: Database },
  { id: 'i18n', icon: Languages },
  { id: 'infrastructure', icon: Container },
];
