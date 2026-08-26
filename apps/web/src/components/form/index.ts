/**
 * Фасад форм застосунку: спільні обгортки приходять із @saas-skeleton/ui, локальним
 * лишається лише телефонне поле — воно тягне libphonenumber-js і country-flag-icons,
 * потрібні поки що одному застосунку (docs/frontend/ui-stack.md §2; вага цих двох
 * залежностей — відкрите питання №2 в docs/frontend/README.md).
 */
export {
  FormTextField,
  FormPasswordField,
  FormSelect,
  applyServerError,
} from '@saas-skeleton/ui/components/form';
export type { FormSelectOption } from '@saas-skeleton/ui/components/form';
export { FormPhoneField } from './form-phone-field';
