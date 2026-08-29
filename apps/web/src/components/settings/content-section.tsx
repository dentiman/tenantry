import { Separator } from '@saas-skeleton/ui/components/ui/separator';

/**
 * Секція сторінки налаштувань: заголовок, опис, лінійка, вміст. Форма шаблону
 * satnaing/shadcn-admin (`content-section.tsx`) — плоска, без `Card`: картка
 * всередині двоколонкової розкладки давала б рамку в рамці.
 */
export function ContentSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex w-full max-w-2xl flex-col">
      <div className="flex-none">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Separator className="my-4 flex-none" />
      <div className="-mx-1 flex-1 px-1 py-1 lg:max-w-xl">{children}</div>
    </section>
  );
}
