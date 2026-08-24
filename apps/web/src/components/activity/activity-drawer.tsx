import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@saas-skeleton/ui/components/ui/sheet';
import { useTranslation } from 'react-i18next';
import { ActivityFeed } from './activity-feed';

interface ActivityDrawerProps {
  entityType: string;
  /** null — драйвер закрито (controlled ззовні, як ChangeAvatarModal) */
  entityId: string | null;
  /** Заголовок драйвера (напр. email юзера) */
  subtitle?: string;
  onClose: () => void;
}

/**
 * Швидкий перегляд стрічки подій зі списку. Сама стрічка — спільний `ActivityFeed`
 * (той самий компонент рендериться у вкладці Activity на сторінці юзера); драйвер
 * лишає собі тільки оболонку і керування видимістю.
 */
export function ActivityDrawer({ entityType, entityId, subtitle, onClose }: ActivityDrawerProps) {
  const { t } = useTranslation('activities');
  const isOpen = entityId !== null;

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          {subtitle && <SheetDescription className="truncate">{subtitle}</SheetDescription>}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-4">
            <ActivityFeed entityType={entityType} entityId={entityId} isEnabled={isOpen} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
