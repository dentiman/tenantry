import type { ReactNode } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';

interface ShowcaseCardProps {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}

/**
 * Каркас одного стенда. Витягнутий зі сторінки кнопок, коли стендів стало
 * чотири: інакше кожна нова сторінка приносила б власну копію картки і вони
 * почали б розходитись у дрібницях.
 */
export function ShowcaseCard({ children, description, id, title }: ShowcaseCardProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Card>
        <CardHeader className="border-b border-border/70">
          <CardTitle>
            <h2 id={`${id}-title`}>{title}</h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

interface ExampleTileProps {
  children: ReactNode;
  code: string;
  description?: string;
}

export function ExampleTile({ children, code, description }: ExampleTileProps) {
  return (
    <div className="flex min-h-40 flex-col rounded-xl bg-muted/50 p-4">
      <div className="flex min-h-16 flex-1 items-center justify-center">{children}</div>
      <Separator className="my-4 bg-border/70" />
      <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
        {code}
      </code>
      {description ? <p className="mt-2 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** Значення форми як їх бачить submit — головний спосіб «прощупати» поле */
export function ValueReadout({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl bg-muted/50 p-4">
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre className="overflow-x-auto font-mono text-xs leading-6 text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
