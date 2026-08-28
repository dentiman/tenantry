'use client';

import * as React from 'react';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру: inset separators малюються всередині комірок,
 * щоб фон рядка міг доходити до країв flush Card, а горизонтальна лінія — ні.
 * Біля selected-рядка власний і попередній separator-и стають full-width.
 * Рядки не змінюють фон на hover; checkbox-колонка має симетричний inset.
 * TableHead повторює 0.8rem typography sortable Button size="sm".
 */
function Table({
  className,
  separator = 'full',
  ...props
}: React.ComponentProps<'table'> & { separator?: 'full' | 'inset' }) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        data-separator={separator}
        className={cn(
          'w-full caption-bottom text-sm',
          separator === 'inset' &&
            "[&_tr]:border-0! [&_tr>*]:relative [&_tr>*]:after:pointer-events-none [&_tr>*]:after:absolute [&_tr>*]:after:inset-x-0 [&_tr>*]:after:bottom-0 [&_tr>*]:after:h-px [&_tr>*]:after:bg-border [&_tr>*]:after:content-[''] [&_tr>*:first-child]:after:left-3 [&_tr>*:last-child]:after:right-3 [&_tbody_tr:last-child>*]:after:hidden [&_tr[data-state=selected]>*:first-child]:after:left-0 [&_tr[data-state=selected]>*:last-child]:after:right-0 [&_tr:has(+tr[data-state=selected])>*:first-child]:after:left-0 [&_tr:has(+tr[data-state=selected])>*:last-child]:after:right-0 [&_thead:has(+_tbody>tr:first-child[data-state=selected])_tr>*:first-child]:after:left-0 [&_thead:has(+_tbody>tr:first-child[data-state=selected])_tr>*:last-child]:after:right-0",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-left align-middle text-[0.8rem] font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:px-3',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:px-3', className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
