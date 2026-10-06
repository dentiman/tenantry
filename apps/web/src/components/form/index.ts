/**
 * Фасад форм застосунку: спільні обгортки приходять із @saas-skeleton/ui, локальними
 * лишаються два поля, які не переюзати в platform-web. Телефонне тягне
 * libphonenumber-js і country-flag-icons, потрібні поки що одному застосунку
 * (docs/frontend/ui-stack.md §2; вага цих двох залежностей — відкрите питання №2 в
 * docs/frontend/README.md). Вибір юзера ходить по orval-хуках ЦЬОГО застосунку, а в
 * control plane юзерів тенанта немає взагалі (там окрема identity platform_users) —
 * у libs/ui він поїхав би лише через інверсію залежності, тобто рівно тією
 * розтягнутою абстракцією, від якої компонент має захищати.
 */
export {
  FormTextField,
  FormPasswordField,
  FormSelect,
  FormDateField,
  FormTextareaField,
  applyServerError,
} from '@saas-skeleton/ui/components/form';
export type { FormSelectOption } from '@saas-skeleton/ui/components/form';
export { FormPhoneField } from './form-phone-field';
export { FormUserSelect } from '../../features/users/components/form-user-select';
