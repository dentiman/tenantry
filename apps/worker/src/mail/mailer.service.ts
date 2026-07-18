import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

/** Тонка обгортка над nodemailer; дефолти вказують на Mailpit з docker-compose (dev) */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(configService: ConfigService) {
    this.transporter = createTransport({
      host: configService.get<string>('SMTP_HOST', 'localhost'),
      port: configService.get<number>('SMTP_PORT', 1025),
      secure: false,
    });
    this.from = configService.get<string>(
      'SMTP_FROM',
      'SaaS Skeleton <noreply@saas-skeleton.local>',
    );
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to, subject, html });
    this.logger.log(`Email sent to ${to}: ${subject}`);
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
